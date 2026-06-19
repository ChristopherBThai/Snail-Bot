# Database

This document describes Snail and OwO data boundaries.

## Ownership

Snail owns its own persistence for feature state, configuration, tags, channels, Snail-owned user state, Snail-owned quest state, module state, and operational behavior.

OwO data is external integration data. Snail may read OwO data through explicit database or API boundaries, but Snail must not change OwO data except through named services that exist specifically for that integration.

## Boundaries

`src/database/` owns connections, schemas, repositories, and persistence-specific helpers.

Modules and command packages should not casually reach through multiple persistence layers. If a feature needs data from Snail and OwO sources, add a focused database or service boundary that names the integration and documents any write behavior.

Database code should handle persistence mechanics: connecting, modeling, loading, saving, querying, transactions, indexes, and persistence-specific translation. Feature rules belong in the owning module, command package, or local service unless the rule is truly about persistence.

Feature-specific data requirements belong in the owning module or command package README. This document defines cross-cutting persistence boundaries, not every feature's schema.

## Connected Databases

A reference for the databases Snail connects to, why each connection exists, whether Snail reads or writes it, and which modules or command packages use it.

## Cross-Database Safety

Cross-database flows need explicit failure handling. Do not hide partial commits, optimistic fire-and-forget writes, or best-effort repair behavior in unrelated command or renderer code.

When a feature crosses Snail and OwO boundaries, document:

- which system owns each record
- whether the flow reads or writes
- which named service performs any OwO write
- how failures are surfaced
- what can be retried safely
- what must never be mutated directly
