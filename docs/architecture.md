# Architecture

This document describes the runtime shape for Snail.

## Runtime Flow

`src/index.js` should compose the runtime in a predictable order:

1. Load configuration.
2. Connect required databases and external services.
3. Create the module registry.
4. Initialize modules.
5. Create Discord REST/gateway infrastructure.
6. Create the adapter and interaction router.
7. Start optional systems such as the socket bridge.
8. Run module ready hooks.
9. Sync application commands.
10. Spawn gateway shards.

Startup should make dependency failures observable. Required services may fail startup; optional integrations should log clearly and degrade when that is safe.

## Boundaries

- `systems/` owns reusable infrastructure such as Discord adapters, interaction routing, socket handling, components, and message building.
- `modules/` owns event/lifecycle-driven runtime features: gateway event handling, startup/ready behavior, background state, logs, admin panel output, and module route registration.
- `commands/` owns command packages: command-only features, command definitions, Discord-facing adaptation, and delegation to services/systems when needed.
- `database/` owns connections, schemas, repositories, and persistence-specific helpers.

Commands, components, modals, socket handlers, and gateway event handlers should route to the owning module, command package, or system. Thin Discord handlers should not become the place where feature rules live long term.

## Feature Specs

Local READMEs are the source of truth for feature-level requirements. Runtime modules use `docs/module-readme-template.md`; command packages use `docs/command-package-readme-template.md`.

Global architecture docs define shared constraints. Local READMEs define the feature contract within those constraints.

## Interaction-First Architecture

Snail uses application commands, context commands, buttons, selects, and modals as the primary interface.

Prefix commands and new message-content-dependent features are not part of the default architecture. Features that would require privileged message content need explicit maintainer approval and should document the tradeoff.

Command sync happens on production startup. Treat command definition changes as production-visible behavior.

## Discordeno and Adapter Layer

Snail uses Discordeno standalone packages with a local adapter layer.

The adapter isolates Discord API and library quirks, centralizes message normalization, and lets the project work around missing or newly released Discord fields. Discord API calls should go through the adapter or interaction context where possible.

Use raw gateway payloads when Discordeno helpers do not expose newer Discord API fields. Keep raw payload handling close to shared systems so feature modules do not each invent their own Discord compatibility layer.

## Command Registration Direction

Module-owned commands should be registered by their owning module when practical. Command-only features should live in command packages such as `src/commands/tags/`.

The final command package registration model is a pending architecture decision and should become an ADR once chosen.
