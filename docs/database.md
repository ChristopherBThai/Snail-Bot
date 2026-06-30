# Database

This document describes Snail and OwO data boundaries.

## Ownership

Snail owns its own persistence for feature state, configuration, tags, channels, Snail-owned user state, Snail-owned quest state, module state, and operational behavior.

OwO data is external integration data. Snail may read OwO data through explicit database or API boundaries, but Snail must not change OwO data except through named services that exist specifically for that integration.

## Boundaries

`src/database/` owns connections, schemas/models, raw database clients, and persistence-specific helpers.

The top-level `src/database/index.js` composes raw database groups only. Individual database folders own their connection setup and schema/model registration. Database constructors throw when required connection config is missing or the connection fails; returned handles are assumed connected.

- `src/database/snail/`: Snail Mongo connection, Snail-owned models, and shared Snail config helpers.
- `src/database/owo/`: OwO Mongo model registration and OwO Redis client setup.

The runtime database object is grouped by data owner first, then store type:

- `database.snail.mongo`
- `database.owo.mongo`
- `database.owo.redis`

Modules, command files, and command packages should not casually reach through multiple persistence layers. If a feature needs data from Snail and OwO sources, create a focused feature-local data boundary that names the integration and documents any write behavior.

Module-local data boundaries are optional, not automatic. Use them when they make feature logic easier to understand, test, or maintain, especially for multi-query, multi-database, or feature-vocabulary access. Avoid creating stores or repositories for every collection by default.

Commands, interactions, and event handlers should not directly query databases. They should parse input, authorize, call the owning module or system method, and return output.

Database code should handle persistence mechanics: connecting, modeling, clients, indexes, and persistence-specific translation. Feature rules and feature-shaped data access belong in the owning module, command file, command package, or local service unless the rule is truly about persistence.

Feature-specific data requirements belong in the owning module or substantial command package README when one exists. This document defines cross-cutting persistence boundaries, not every feature's schema.

## Connected Databases

A reference for the databases Snail connects to, why each connection exists, whether Snail reads or writes it, and which modules, command files, or command packages use it.

| Connection | Read/Write | Used By | Purpose |
| --- | --- | --- | --- |
| Snail Mongo | read/write | Global runtime, Quest List, Tags, Message Builder | Required startup dependency. Exposes Snail-owned `Config`, `Quest`, `Tag`, `Channel`, and Message Builder draft models. Shared config helpers read/write `Config`; module infrastructure adapts those helpers for module enablement persistence; Quest List owns module-local data access for queued quests; Tags owns command-package-local access for tag records and tag channel policy; Message Builder owns per-user current drafts. |
| OwO Mongo | read-only | Quest List | Exposes the OwO `UserQuest` model. Quest List owns the module-local data access that queries active V2 quest documents. |
| OwO Redis | read-only | Quest List | Exposes the OwO Redis client. Quest List owns the module-local data access that reads `user_stats:{userId}` hashes. |

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
