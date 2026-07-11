# Configuration

This document describes Snail runtime configuration.

## Goals

Configuration should make production-sensitive values explicit, keep secrets out of source, and make the bot's required startup values easy to review.

Runtime config is loaded once during startup and passed through the app context to runtime services and features. Because Snail uses static exported config plus environment values, config shape should be checked by tests instead of a separate runtime validation layer.

## Sources

Snail uses two categories of config:

- Source-controlled config files for non-secret, environment-specific defaults such as guild IDs, role IDs, user IDs, colors, and feature defaults.
- Local environment values for secrets and connection strings, loaded from `.env` during local development.

Do not commit real tokens, database credentials, socket tokens, or production-only private config.

## Environment Values

These values are secrets or deployment-local connection strings and should come from the environment:

| Value | Purpose |
| --- | --- |
| `BOT_TOKEN` | Discord REST and gateway authentication. |
| `SNAIL_MONGO_URI` | Snail-owned Mongo data. |
| `OWO_MONGO_URI` | Read-only OwO quest documents. |
| `OWO_REDIS_URL` | Read-only OwO stat hashes. |
| `OWO_MYSQL_URI` | Read-only Wrapped Ticket inventory. |

`BOT_TOKEN` may be supplied with or without the `Bot ` prefix. The config loader should normalize it before Discord REST/gateway setup.

## Config Files

The config loader lives under `src/config/`.

Non-secret config should be explicit and grouped by purpose:

```js
export default {
    discord: {
        applicationId: '...',
        guildId: '...'
    },
    roles: {
        manager: [],
        helper: []
    },
    users: {
        owner: '...'
    },
    colors: {
        primary: 0x5865f2
    },
    features: {
        defaultLogsLimit: 50000
    }
};
```

Debug/local variants may exist, but the active selection must be obvious during startup. Avoid broad runtime mode switches that hide production behavior.

## Config Shape Tests

Static config should have focused tests that assert required groups and values exist.

Config tests should cover:

- required Discord IDs and token mapping
- required database connection values
- required auth roles and owner IDs
- required color and feature-default groups
- expected value types for numbers, booleans, arrays, and IDs

These tests catch accidental removal, renaming, or blanking of required config without adding runtime ceremony.

Feature settings that staff change at runtime should be saved as Snail data, not source-controlled config files.

## Discord Config

`discord.applicationId`, `discord.guildId`, and `BOT_TOKEN` are required before command sync can run.

Guild command sync is authoritative. If the running code provides an empty guild command list, Snail should sync that empty list and remove registered guild commands for the configured guild.

## Auth Config

Role and owner config supports runtime authorization helpers. Discord-side command visibility is not a substitute for runtime authorization checks.

Feature routes that require staff access should use shared runtime auth helpers and should re-check authorization on every interaction.

## Feature Runtime Config

Feature runtime settings include values such as enabled state, log level, Quest List channel, Ticket Market rules channel, market access role, timing, copy, and similar staff-managed settings.

These settings should be persisted under Snail-owned storage and scoped by feature ID. Use individual settings unless the feature has a concrete reason to query or relate a settings document as a first-class record.

## Documentation Updates

Update this document when:

- a required environment value is added or removed
- a source-controlled config group is added or removed
- the config loader behavior changes
- config shape test expectations change
- command sync requirements change
- auth config expectations change
