# ADR 4: Dotenv For Local Environment Loading

## Context

Snail currently reads secrets and machine-local toggles from `.env`. The reference implementation used `dotenv` to load `.env` before normalizing runtime config.

## Decision

Snail will use `dotenv` inside `src/config/index.js` to load `.env` values.

Only the config boundary should read `.env` or `process.env`; the rest of the app should use normalized config exports.

## Alternatives Considered

| Alternative | Summary | Rejected Because |
| --- | --- | --- |
| Local env parser | Parse `.env` manually in `src/config/index.js`. | Maintaining parser behavior is unnecessary when `dotenv` already handles the expected `.env` format and was used by the reference implementation. |
| Node `--env-file` | Use Node runtime flags to load env files before startup. | This would move required startup behavior out of the app and into every local, test, and production command that starts Snail. |

## Pros

- Reuses familiar behavior from the reference implementation.
- Avoids maintaining a custom `.env` parser.
- Keeps env loading centralized in the config boundary.

## Cons

- Adds a runtime dependency.
- Still requires discipline to keep `process.env` reads out of feature code.

## Consequences

- `dotenv` is a runtime dependency in `package.json`.
- Config tests should focus on Snail's normalization rules, not re-testing `dotenv` parsing.
- Future config options must be added to `docs/configuration.md`.

## Links

- Related docs: [Configuration](../configuration.md)
