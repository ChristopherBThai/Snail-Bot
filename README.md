# Snail Bot

Snail Bot helps run and support the OwO Bot Support server. It handles utility, staff, and community workflows that keep the server easier to manage.

## Project Shape

Snail is an interaction-first Discord app built from feature packages.

The source shape is:

```text
src/
  index.js          runtime entry point
  runtime/          composition, feature setup, registries, startup ordering
  discord/          REST, gateway, routing, command sync, component helpers
  config/           runtime config loading and config catalog
  logging/          logger creation, log levels, log export support
  data/             Snail databases, OwO database clients, and saved records
  features/         user-facing, staff-facing, and admin feature packages
  util/             small general utilities
```

Feature details live close to the code that owns them. Substantial feature packages should have local READMEs that describe purpose, workflows, routes, admin pages, state, data access, failure modes, and tests.

## Quick Start

Expected commands:

```sh
npm install
npm test
npm start
```

Additional checks:

```sh
npm run check
npm run format
```

Formatting and check fixes:

```sh
npm run check:fix
npm run format:fix
```

## Documentation

- [Agent guide](AGENTS.md): repo-wide operating rules for AI agents
- [Architecture](docs/architecture.md): feature runtime, source layout, startup flow, and route/admin contribution model
- [Code standards](docs/code-standards.md): coding conventions and review rubric
- [Configuration](docs/configuration.md): runtime config files, environment values, and config shape tests
- [Database](docs/database.md): Snail/OwO databases, saved records, and ownership rules
- [Feature README template](docs/feature-readme-template.md): standard local feature contract format
- [ADRs](docs/adr/README.md): architecture decision records

Local folder docs may live under `src/features/**/README.md` and should be read before changing that feature when present.

## Core Direction

- Interaction-first UI: application commands, context commands, components, and modals instead of prefix commands.
- No new privileged-message-content features unless explicitly approved.
- Components V2 by default for bot-authored Discord messages.
- Features own product behavior, user workflows, staff/admin pages, route contributions, state, and feature policy.
- Runtime, Discord, config, logging, and data folders own reusable infrastructure.
- `data/` contains database code, saved Snail records, and OwO database clients.
- Snail must not change OwO data except through named services.
- Add folders, fields, services, and extension points for current features or clearly identified planned features. Do not add generic buckets for unspecified future work.
