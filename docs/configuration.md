# Configuration

This document describes Snail's runtime config loader, normal/debug config files, and ignored `.env` values.

## Config Files and Local Values

Snail starts from `src/config/index.js`, which builds the final runtime config.

The config files are useful for:

- setting guild IDs and other public Discord IDs
- setting role/user/channel IDs
- choosing public or safe local service defaults
- enabling optional integrations for local development or testing
- documenting non-secret defaults

Secrets and private machine-specific values live in `.env` and are read by `src/config/index.js` through `process.env`. Local toggles such as `DEBUG` also live in `.env`.

Never commit `.env` files, `src/config/config.debug.js`, real tokens, API keys, database credentials, socket tokens, or production-only secrets. Do commit `src/config/config.js` when it contains only public config shape and safe defaults.

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

## Config Catalog

This table is the source of truth for supported config options.

| Name | Required In | Source | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `debug` | optional | `.env` | Enables local diagnostics and selects debug config | Not a secret, but keep it in `.env` with other machine-local values. Read as `DEBUG` and parse as a boolean. |
| `token` | runtime | `.env` | Discord bot token | Secret. Never commit real `.env` files. Read as `BOT_TOKEN` and normalize away a leading `Bot` prefix. |

## Environment Values

Use this as a copy/paste starting point for ignored `.env`:

```sh
DEBUG=false

BOT_TOKEN=
```
