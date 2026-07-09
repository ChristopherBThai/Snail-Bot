# Database

This document describes Snail and OwO data boundaries.

## Ownership

Snail owns its own persistence for feature state, configuration, tags, channels, Snail-owned user state, Snail-owned quest state, module state, and operational behavior.

OwO data is external integration data. Snail may read OwO data through explicit database or API boundaries, but Snail must not change OwO data except through named services that exist specifically for that integration.

## Boundaries

`src/database/` owns shared connections, shared schemas/models, raw database clients, and persistence-specific helpers.

The top-level `src/database/index.js` composes raw database groups only. Individual database folders own their connection setup and schema/model registration. Database constructors throw when required connection config is missing or the connection fails; returned handles are assumed connected.

- `src/database/snail/`: Snail Mongo connection, shared Snail-owned models, and shared Snail config helpers.
- `src/database/owo/`: OwO Mongo model registration, OwO Redis client setup, and read-only OwO MySQL helpers.

The runtime database object is grouped by data owner first, then store type:

- `database.snail.mongo`
- `database.owo.mongo`
- `database.owo.redis`
- `database.owo.mysql`

Modules, command files, and command packages should not casually reach through multiple persistence layers. If a feature needs data from Snail and OwO sources, create a focused feature-local data boundary that names the integration and documents any write behavior.

Module-local data boundaries are optional, not automatic. Use them when they make feature logic easier to understand, test, or maintain, especially for multi-query, multi-database, or feature-vocabulary access. Module-specific schemas and models should live with that module's data boundary instead of shared database index files. Cross-feature records, such as Snail-owned user state and user logs, belong in shared database models with feature state isolated in named subdocuments. Avoid creating stores or repositories for every collection by default.

Database connection modules should expose connected clients, pools, connections, and shared models only. They should not expose feature-specific query helpers such as "get this module's count" or "load this feature's data." Those helpers belong in the owning module, command package, or local data boundary.

Use the module `getConfig` and `setConfig` helpers for module settings unless a feature has a concrete need to query, index, or relate settings as first-class records. Do not add a dedicated settings collection or packed settings document just because a settings group has several fields.

Use shared `User` records for cross-feature user state. Store only current state needed for fast checks on the user document, with feature state isolated in a named subdocument such as `ticketMarket`. Store repeated user-directed action history in `UserLog`, not in arrays or repeated actor/reason fields on `User`.

Choose field types by meaning. Use `Date` for points in time, such as `createdAt`, `deletedAt`, `bannedAt`, and agreement timestamps. Use `Number` for durations and counts, such as cooldown milliseconds, ticket counts, and prices.

Add indexes only for known query patterns. When adding an index, be able to name the read path it supports. Prefer removing speculative indexes until an admin view, runtime path, or report actually needs them.

Commands, interactions, and event handlers should not directly query databases. They should parse input, authorize, call the owning module or system method, and return output.

Database code should handle persistence mechanics: connecting, modeling, clients, indexes, and persistence-specific translation. Feature rules and feature-shaped data access belong in the owning module, command file, command package, or local service unless the rule is truly about persistence.

Feature-specific data requirements belong in the owning module or substantial command package README when one exists. This document defines cross-cutting persistence boundaries, not every feature's schema.

## Connected Databases

A reference for the databases Snail connects to, why each connection exists, whether Snail reads or writes it, and which modules, command files, or command packages use it.

| Connection | Read/Write | Used By | Purpose |
| --- | --- | --- | --- |
| Snail Mongo | read/write | Global runtime, Quest List, Tags, Message Builder, Ticket Market | Required startup dependency. Exposes the shared Snail Mongo connection plus shared `Config`, `Quest`, `Tag`, `Channel`, `User`, `UserLog`, and Message Builder draft models. Module config helpers read/write individual `Config` keys; Quest List owns module-local data access for queued quests; Tags owns command-package-local access for tag records and tag channel policy; Message Builder owns per-user current drafts; Ticket Market stores settings through module config helpers, stores user-level state under `User.ticketMarket`, writes durable action history to `UserLog`, and owns its module-local ad schema. |
| OwO Mongo | read-only | Quest List | Exposes the OwO `UserQuest` model. Quest List owns the module-local data access that queries active V2 quest documents. |
| OwO Redis | read-only | Quest List | Exposes the OwO Redis client. Quest List owns the module-local data access that reads `user_stats:{userId}` hashes. |
| OwO MySQL | read-only | Ticket Market | Exposes Wrapped Ticket inventory from the OwO `owo` database. Ticket Market reads `user.id`, `user.uid`, and `user_item` rows where `name = 'common_tickets'` to verify sellers have enough Wrapped Tickets before posting ads. |

## User Logs

`UserLog` is the shared append-only history collection for user-directed actions from modules, moderation tools, automod, and future systems.

Fields:

- `userID`: target Discord user ID.
- `actorID`: user, staff member, bot, or system actor that caused the event when known.
- `source`: owning system, such as `ticket_market`, `moderation`, or `automod`.
- `kind`: stable action name used for filtering, such as `ad.posted` or `market.banned`.
- `summary`: optional human-entered context.
- `metadata`: structured action-specific details.
- `createdAt`: event timestamp.

Use `kind`, `source`, IDs, and structured `metadata` for filtering. Do not require staff to maintain separate free-form reason and note fields.

## Cross-Database Safety

Cross-database flows need explicit failure handling. Do not hide partial commits, optimistic fire-and-forget writes, or best-effort repair behavior in unrelated command or renderer code.

When an installed runtime module cannot safely operate without a database dependency, database startup should fail instead of registering a partially working module. Disabled modules do not run event handlers or normal work, but their routes remain registered so stale Discord components can return a clear disabled message.

When a feature crosses Snail and OwO boundaries, document:

- which system owns each record
- whether the flow reads or writes
- which named service performs any OwO write
- how failures are surfaced
- what can be retried safely
- what must never be mutated directly
