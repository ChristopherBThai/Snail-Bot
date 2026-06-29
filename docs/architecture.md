# Architecture

This document describes the runtime shape for Snail.

## Runtime Flow

`src/index.js` should compose the runtime in a predictable order:

1. Load configuration.
2. Create runtime logging.
3. Connect required databases and external services.
4. Load persisted non-module logger levels.
5. Create command packages and the module registry.
6. Initialize modules.
7. Create Discord REST/gateway infrastructure.
8. Sync application commands.
9. Spawn gateway shards.

Startup should make dependency failures observable. Database startup should fail when a required service for the installed runtime is missing. Snail Mongo is required because shared module configuration, including persisted enablement, depends on it. Quest List also requires OwO Mongo and OwO Redis while it is part of the installed runtime.

Modules track intentional enablement. Toggleable module enablement is persisted through Snail config. Disabled modules should stay registered enough to show panel state and answer stale buttons, selects, modals, or commands with a clear disabled reason, while their event handlers and normal work stay inactive. The shared module panel exposes enable/disable controls and recent module logs. Modules can implement enable/disable lifecycle hooks for graceful resume or shutdown work.

Runtime modules may receive the runtime `config` and `databases` objects directly when those are stable dependencies. This keeps `src/index.js` explicit without creating extra stores, factories, or setter-style injection just to pass common runtime services around. Constructor arguments should make stable dependencies visible where the module is created.

Module construction should register commands, components, modals, and event handlers. Startup calls `init()` to load generic persisted module state such as enabled status and log level, log startup state, and call `onEnable()` for modules that are enabled. Enabling a module at runtime persists the enabled state and calls the same `onEnable(context)` hook. `onEnable()` should be safe to run on startup or after runtime enable; `onDisable()` should clean up runtime-only state such as timers.

## Boundaries

- `systems/` owns reusable infrastructure such as Discord REST helpers, interaction routing, socket handling, components, and message building.
- `modules/` owns event/lifecycle-driven runtime features: gateway event handling, startup/ready behavior, background state, logs, admin panel output, and module route registration.
- `commands/` owns command packages: command-only features, command definitions, Discord-facing adaptation, and delegation to services/systems when needed.
- `database/` owns connections, schemas, repositories, and persistence-specific helpers.

Commands, components, modals, socket handlers, and gateway event handlers should route to the owning module, command package, or system. Thin Discord handlers should not become the place where feature rules live long term.

Discord gateway setup lives in `systems/discord/gateway.js`. It owns Discordeno gateway manager creation, gateway intents, ready logging, and forwarding raw gateway payloads to the Discord event router. `src/index.js` remains the runtime composition root. Add stores, repositories, factories, or adapters only when they remove meaningful complexity, protect ownership boundaries, or isolate an unstable integration.

## Feature Specs

Local READMEs are the source of truth for feature-level requirements. Runtime modules use `docs/module-readme-template.md`; command packages use `docs/command-package-readme-template.md`.

Global architecture docs define shared constraints. Local READMEs define the feature contract within those constraints.

## Interaction-First Architecture

Snail uses application commands, context commands, buttons, selects, and modals as the primary interface.

Prefix commands and new message-content-dependent features are not part of the default architecture. Features that would require privileged message content need explicit maintainer approval and should document the tradeoff.

Command sync happens on production startup. Treat command definition changes as production-visible behavior.

Guild command sync is authoritative: Snail should sync the guild command list that the current code defines. Syncing an empty guild command list is valid and intentionally removes registered guild commands for the configured guild. Global command exceptions should be handled explicitly by the code that owns them, not through a generic command scope setting.

Commands can set `staff: true` to add Discord's `Bypass Slowmode` default member permission during command sync. This only controls Discord-side command visibility; runtime `auth` remains the source of truth for permission checks. Commands can set `cooldown` when the router should throttle repeated use per user.

Interaction create events do not require gateway intents. Do not add gateway intents for interaction routing unless another current gateway event requires them.

## Discordeno and REST Layer

Snail uses Discordeno standalone packages with a local REST wrapper.

The REST wrapper isolates Discord API and library quirks, centralizes message normalization, and lets the project work around missing or newly released Discord fields. Discord REST calls should go through the wrapper or interaction context where possible.

Use raw gateway payloads when Discordeno helpers do not expose newer Discord API fields. Keep raw payload handling close to shared systems so feature modules do not each invent their own Discord compatibility layer.

## Command Registration Direction

Module-owned commands should be registered by their owning module when practical. Command-only features should live in command packages such as `src/commands/tags/`.

The final command package registration model is a pending architecture decision and should become an ADR once chosen.
