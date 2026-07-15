# Configuration

This document describes Snail runtime configuration.

## Goals

Configuration should make production-sensitive values explicit, keep secrets out of source, and make the bot's required startup values easy to review.

Runtime config is loaded once during startup and passed through the app context to runtime services and features. Because Snail uses static exported config plus environment values, config shape should be checked by tests instead of a separate runtime validation layer.

## Sources

Snail uses two categories of config:

- Source-controlled config files for non-secret, environment-specific values that the current runtime or features consume.
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
        manager: ['...'],
        admin: ['...']
    },
    users: {
        owner: '...'
    }
};
```

Do not add config groups before the code needs them. Add role IDs, user IDs, colors, feature defaults, and similar groups with the runtime service or feature that consumes them.

Debug/local variants may exist outside version control, but the active selection must be obvious during startup. Committed tests should not depend on private local config contents. Avoid broad runtime mode switches that hide production behavior.

## Config Shape Tests

Static config should have focused tests that assert required groups and values exist. Do not mirror every literal from a source config file into a test. Assert the contract Snail depends on, such as presence, value shape, and normalization behavior.

Config tests should cover:

- required Discord IDs as valid Discord ID strings
- required environment value mapping by destination config group
- required source config groups consumed by implemented runtime services or features
- expected value types for numbers, booleans, arrays, and IDs that are currently part of the config shape
- normalization behavior for values Snail accepts in more than one form, such as `BOT_TOKEN`

These tests catch accidental removal, renaming, or blanking of required config without adding runtime ceremony.

Feature settings that staff change at runtime should be saved as Snail data, not source-controlled config files.

## Discord Config

`discord.applicationId`, `discord.guildId`, and `BOT_TOKEN` are required before command sync can run.

Command sync is authoritative. If the running code provides an empty guild or global command list, Snail should sync that empty list and remove registered commands for that sync target.

## Staff Auth Config

`users.owner`, `roles.admin`, and `roles.manager` are source-controlled Discord IDs used by staff-only route authorization. Routes that need manager access should use `hasManagerAccess` as their `authorize` function.

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
