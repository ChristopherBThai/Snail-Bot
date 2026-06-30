# Snail Bot

Snail Bot helps run and support the OwO Bot Support server. It handles utility, staff, and community workflows that keep the server easier to manage.

## Project Shape

Source lives under `src/`, project-wide docs live in `docs/`, and local README files inside source folders describe subsystem-specific expectations.

Feature details live close to the code that owns them. Runtime modules and substantial command packages should have local READMEs that describe purpose, workflows, state, and tests.

## Quick Start

Expected commands:

```sh
npm install
npm test
npm start
```

Additional check/format scripts may exist when useful for the active tooling.

## Documentation

The docs are designed to keep implementation work understandable across planning, review, and future maintenance.

- [Agent guide](AGENTS.md): repo-wide operating rules for humans and coding agents
- [Architecture](docs/architecture.md): runtime shape, module lifecycle, and interaction flow
- [Code standards](docs/code-standards.md): coding conventions and review rubric
- [Configuration](docs/configuration.md): runtime config files and local `.env` values
- [Database](docs/database.md): Snail/OwO data boundaries and persistence guidance
- [Development expectations](docs/development-workflow.md): how to add features and verify work
- [Module README template](docs/module-readme-template.md): standard feature-spec format for runtime modules
- [Command package README template](docs/command-package-readme-template.md): standard feature-spec format for command packages
- [ADRs](docs/adr/README.md): architecture decision records

Local folder docs may live under `src/**/README.md` and should be read before changing that area when present.

## Core Direction

- Interaction-first UI: application commands, context commands, components, and modals instead of prefix commands.
- No new privileged-message-content features unless explicitly approved.
- Components V2 by default for bot-authored Discord messages.
- Modules own event/lifecycle-driven runtime behavior, state, logs, panel UI, and routes.
- Command files and command packages own command-only features and keep Discord handlers thin. Simple commands can stay as files; substantial command-only features can become packages.
- Snail must not change OwO data except through named services.
