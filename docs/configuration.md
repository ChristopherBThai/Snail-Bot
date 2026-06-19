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

Most public config values should not need parsing or normalization because they are maintained as JavaScript values in config files. Environment values may need normalization when they come from text input; the bot token is normalized to remove a leading `Bot` prefix.

## Config Catalog

This table is the source of truth for supported config options.

| Name | Required In | Source | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `debug` | optional | `.env` | Enables local diagnostics | Not a secret, but keep it in `.env` with other machine-local values. Read as `DEBUG`; only `true` enables debug mode. |
| `applicationId` | runtime | `config.js` / `config.debug.js` | Discord application ID | Not a secret. Read from `discord.applicationId` in the selected config file. |
| `guildId` | runtime | `config.js` / `config.debug.js` | Discord guild ID for normal command sync | Not a secret. Read from `discord.guildId` in the selected config file. |
| `token` | runtime | `.env` | Discord bot token | Secret. Never commit real `.env` files. Read as `BOT_TOKEN` and normalize away a leading `Bot` prefix. |

## Environment Values

Use this as a copy/paste starting point for ignored `.env`:

```sh
DEBUG=false

BOT_TOKEN=
```
