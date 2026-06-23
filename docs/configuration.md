# Configuration

This document describes Snail's runtime config loader and ignored `.env` values.

## Local Values

Snail starts from `src/config/index.js`, which builds the final runtime config from `.env` and the selected public config file.

Secrets and private machine-specific values live in `.env` and are read by `src/config/index.js` through `process.env`. Local toggles such as `DEBUG` also live in `.env`.

Public Discord IDs live in `src/config/config.js` or ignored local debug config.

Never commit `.env` files, real tokens, API keys, database credentials, socket tokens, or production-only secrets.

## Runtime Config

Snail uses one committed runtime config loader and one selected public config file.

Expected files:

```text
src/config/index.js          Runtime config loader and normalizer. Committed.
src/config/config.js         Normal public config values. Committed.
src/config/config.debug.js   Debug/local public config values. Always ignored.
.env                         Secrets and local toggles. Always ignored.
```

Use the Config Catalog below as the source of truth when creating or updating `src/config/config.js`, `src/config/config.debug.js`, and `.env`.

Startup should load `.env` before reading env-derived values so `process.env` is available. Only `src/config/index.js` should read `.env` or `process.env`; the rest of the app should use exported config values.

If `DEBUG=true`, use `src/config/config.debug.js`; otherwise use `src/config/config.js`. The normal and debug config files are alternatives, not overlays.

Most public config values should not need parsing or normalization because they are maintained as JavaScript values in config files. Private connection strings are read directly from `.env`; the bot token is normalized to remove a leading `Bot` prefix.

## Config Catalog

This table is the source of truth for supported config options.

| Name | Required In | Source | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `debug` | optional | `.env` | Enables local diagnostics | Not a secret, but keep it in `.env` with other machine-local values. Read as `DEBUG`; only `true` enables debug mode. |
| `applicationId` | runtime | `config.js` | Discord application ID | Not a secret. Read from `discord.applicationId` in the selected config file. |
| `guildId` | runtime | `config.js` | Discord guild ID for normal command sync | Not a secret. Read from `discord.guildId` in the selected config file. |
| `token` | runtime | `.env` | Discord bot token | Secret. Never commit real `.env` files. Read as `BOT_TOKEN` and normalize away a leading `Bot` prefix. |
| `snailMongoUri` | runtime | `.env` | Snail-owned Mongo persistence | Secret/private connection string. Read as `SNAIL_MONGO_URI`. Required for startup because shared module config and module enablement are persisted there. |
| `owoMongoUri` | Quest List runtime | `.env` | Read-only OwO quest document access | Secret/private connection string. Read as `OWO_MONGO_URI`. Quest List reads active V2 quest docs only. |
| `owoRedisUrl` | Quest List runtime | `.env` | Read-only OwO user stat access | Secret/private connection string. Read as `OWO_REDIS_URL`. Quest List reads `user_stats:{userId}` hashes only. |
| `modules.defaultLogsLimit` | runtime | `config.js` | Default number of recent log entries retained per module | Public operational setting. Individual modules may override this when they need a different in-memory log limit. |
| `colors.primary` | runtime | `config.js` | Primary UI accent color | Public Discord component color as a number literal. Used for generic admin and overview surfaces. |
| `colors.success` | runtime | `config.js` | Success UI accent color | Public Discord component color as a number literal. Used for active or healthy states. |
| `colors.warning` | runtime | `config.js` | Warning UI accent color | Public Discord component color as a number literal. Reserved for degraded or waiting states. |
| `colors.danger` | runtime | `config.js` | Danger UI accent color | Public Discord component color as a number literal. Used for error or destructive states. |
| `colors.neutral` | runtime | `config.js` | Neutral UI accent color | Public Discord component color as a number literal. Used for disabled or inactive states. |
| `colors.red` | runtime | `config.js` | Red UI accent color | Public Discord component color as a number literal. Part of the shared rainbow palette. |
| `colors.orange` | runtime | `config.js` | Orange UI accent color | Public Discord component color as a number literal. Part of the shared rainbow palette. |
| `colors.yellow` | runtime | `config.js` | Yellow UI accent color | Public Discord component color as a number literal. Part of the shared rainbow palette; used by Quest List. |
| `colors.green` | runtime | `config.js` | Green UI accent color | Public Discord component color as a number literal. Part of the shared rainbow palette. |
| `colors.blue` | runtime | `config.js` | Blue UI accent color | Public Discord component color as a number literal. Part of the shared rainbow palette. |
| `colors.purple` | runtime | `config.js` | Purple UI accent color | Public Discord component color as a number literal. Part of the shared rainbow palette. |
| `colors.pastel.red` | runtime | `config.js` | Pastel red UI accent color | Public Discord component color as a number literal. Part of the shared pastel rainbow palette. |
| `colors.pastel.orange` | runtime | `config.js` | Pastel orange UI accent color | Public Discord component color as a number literal. Part of the shared pastel rainbow palette. |
| `colors.pastel.yellow` | runtime | `config.js` | Pastel yellow UI accent color | Public Discord component color as a number literal. Part of the shared pastel rainbow palette. |
| `colors.pastel.green` | runtime | `config.js` | Pastel green UI accent color | Public Discord component color as a number literal. Part of the shared pastel rainbow palette. |
| `colors.pastel.blue` | runtime | `config.js` | Pastel blue UI accent color | Public Discord component color as a number literal. Part of the shared pastel rainbow palette. |
| `colors.pastel.purple` | runtime | `config.js` | Pastel purple UI accent color | Public Discord component color as a number literal. Part of the shared pastel rainbow palette. |
| `roles.helper` | staff features | `config.js` | Discord helper role IDs | Public Discord IDs. Grants helper/staff-level access. |
| `roles.manager` | staff features | `config.js` | Discord manager role IDs | Public Discord IDs. Grants manager-level access, including Quest List settings/actions. |
| `roles.admin` | staff features | `config.js` | Discord admin role IDs | Public Discord IDs. Grants admin-level access and includes manager-level permissions. |
| `users.owner` | staff features | `config.js` | Discord user ID with owner override | Public Discord ID. Owner can use staff controls even without a staff role. |

Staff authorization is hierarchical: owner includes admin, manager, and helper permissions; admin includes manager and helper permissions; manager includes helper permissions.

## Environment Values

Use this as a copy/paste starting point for ignored `.env`:

```sh
DEBUG=false

BOT_TOKEN=

SNAIL_MONGO_URI=
OWO_MONGO_URI=
OWO_REDIS_URL=
```
