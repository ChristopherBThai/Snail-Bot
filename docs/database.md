# Database

This document describes Snail and OwO databases, saved records, and ownership rules.

## Ownership

Snail owns its own saved records for feature state, configuration, tags, channels, user state, quest state, feature runtime state, and operational behavior.

OwO owns OwO records. Snail may read OwO records through OwO database clients, but Snail must not change OwO records except through named OwO services.

## Database Code

Shared connection setup, cross-feature models, and OwO database clients belong under `src/data/`. Feature-specific database queries belong with the owning feature.

Expected folders:

- `data/snail/`: Snail database connections, shared models, saved settings, saved feature state, and cross-feature records such as users and user logs.
- `data/owo/`: OwO Mongo model registration, OwO Redis client setup, read-only OwO MySQL access, and named OwO write services when explicitly approved.
- `features/<feature-id>/repository.js`: feature-specific database queries and saved-record vocabulary.

The runtime database object should be grouped by data owner first, then database type or service:

- `databases.snail.mongo`
- `databases.owo.mongo`
- `databases.owo.redis`
- `databases.owo.mysql`

Features should not casually reach through multiple database clients. If a feature needs both Snail records and OwO records, create a focused feature repository and document any OwO write behavior.

Feature-local repositories are optional, not automatic. Use them when they make feature logic easier to understand, test, or maintain, especially for multi-query, multi-database, or feature-vocabulary access. Feature-specific schemas and models should live with that feature's repository instead of shared Snail data files.

Cross-feature records, such as Snail user state and user logs, belong in shared data models with feature state isolated in named subdocuments. Current per-user state belongs under the shared `User` record when there is one current value or state bundle per user, such as `User.messageBuilder.draft` or `User.ticketMarket.marketAgreedAt`. Use a separate collection when the records are repeated history, many-per-user, queried independently from the user, or belong to a non-user concept. Avoid creating models or repositories for every collection by default.

Connection modules should expose connected clients, pools, connections, and shared models only. They should not expose feature-specific query helpers such as "get this feature's count" or "load this feature's data." Those helpers belong in the owning feature repository.

Use feature state/config helpers for individual feature settings unless a feature has a concrete need to query, index, or relate settings as first-class records. Do not add a dedicated settings collection or packed settings document just because a settings group has several fields.

Shared Snail models should separate current state from history. Use current-state records for fast runtime checks and append-only history records for audit trails. Document shared model fields near the model code, and document feature-specific subdocuments or log kinds in the owning feature README.

Choose field types by meaning. Use `Date` for points in time, such as `createdAt`, `deletedAt`, `bannedAt`, and agreement timestamps. Use `Number` for durations and counts, such as cooldown milliseconds, ticket counts, and prices.

Add indexes only for known query patterns. When adding an index, be able to name the read path it supports. Prefer removing speculative indexes until an admin view, runtime path, or report actually needs them.

Routes and gateway event handlers should not directly query databases. They should parse input, authorize, call the owning feature service, and return output.

Database and repository code should handle connecting, modeling, clients, indexes, queries, and database-specific translation. Feature rules belong in the owning feature service or pure rules file unless the rule is directly about a database read or write.

Feature-specific data requirements belong in the owning feature README. This document defines shared database rules, not every feature's schema.

## Connected Databases

A reference for the databases Snail connects to, why each connection exists, whether Snail reads or writes it, and which features use it.

| Connection | Read/Write | Used By | Purpose |
| --- | --- | --- | --- |
| Snail Mongo | read/write | Global runtime, Message Builder, Quest List, Tags, Ticket Market, Admin Console, Logs | Required for Snail config, persisted user-scoped Message Builder drafts, feature runtime state, logs metadata where saved, tags, quest-list queue rows, ticket-market user/ad state, and user logs. |
| OwO Mongo | read-only | Quest List | Exposes OwO active quest documents. Quest List owns the feature-local repository code that queries and translates them. |
| OwO Redis | read-only | Quest List | Exposes OwO lifetime stat hashes such as `user_stats:{userId}`. Quest List owns the feature-local repository code that reads and translates them. |
| OwO MySQL | read-only | Ticket Market | Exposes Wrapped Ticket inventory from the OwO `owo` database. Ticket Market reads inventory to verify sellers have enough Wrapped Tickets before posting ads. |

## Cross-Database Safety

Cross-database flows need explicit failure handling. Do not hide partial commits, optimistic fire-and-forget writes, or best-effort repair behavior in unrelated route or renderer code.

When a required database connection is unavailable, startup should fail before command sync or gateway start. Disabled features do not run event handlers or normal work, but their routes remain registered when needed so stale Discord components can return a clear disabled message.

When a feature uses both Snail records and OwO records, document:

- which system owns each record
- whether the flow reads or writes
- which named service performs any OwO write
- how failures are surfaced
- what can be retried safely
- what must never be mutated directly
