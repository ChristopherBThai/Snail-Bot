# Architecture

This document describes the runtime shape for Snail.

## Runtime Model

Snail is an interaction-first Discord app composed from feature packages. A feature is the unit of product ownership: it declares identity, route contributions, lifecycle hooks, admin pages, state export, and health/diagnostic behavior when needed.

The primary source folders are:

- `runtime/`: runtime composition, feature setup, registries, command sync planning, and startup ordering.
- `discord/`: Discord REST, gateway setup, interaction routing, command sync, component builders, and Discord payload normalization.
- `config/`: runtime config loading and config catalog.
- `logging/`: logger creation, log levels, and log export support.
- `data/`: database code, saved Snail records, and OwO database clients.
- `features/`: user-facing, staff-facing, and admin feature packages such as Quest List, Ticket Market, Tags, Message Builder, Logs, the shared admin UI, Echo, Edit, Nick, and Snail.
- `util/`: small general utilities that do not deserve a runtime service or feature-local home.

Features may be tiny. A single-command feature still uses the feature contribution model; it just contributes fewer things.

Only add source folders and shared service categories for current features or clearly identified planned features. Do not keep generic buckets for unspecified future work.

## Runtime Flow

`src/index.js` should stay a thin runtime entry point. Startup should compose the runtime in a predictable order:

1. Load configuration.
2. Create runtime logging.
3. Connect required databases and external services.
4. Create runtime services such as Discord REST, route registry, logger registry, and feature state storage.
5. Load feature definitions.
6. Set up features with an app context.
7. Load saved feature runtime state such as enablement and log levels.
8. Enable features that should run on startup.
9. Collect feature route contributions.
10. Sync application commands.
11. Start the Discord gateway.

Startup should make runtime failures observable. The bot has known runtime infrastructure and composes it directly. If required config, databases, or services are unavailable, startup should fail before command sync or gateway start.

## Feature Definitions

Feature packages export a definition through a small helper such as `defineFeature(...)`. The helper should validate shape and preserve plain JavaScript ergonomics; it should not create a deep class hierarchy.

Example feature definition:

```js
export default defineFeature({
    id: 'ticket_market',
    name: 'Ticket Market',
    description: 'Manages Ticket Market access, seller ads, and trading availability.',
    toggleable: true,
    setup(context) {
        const service = createTicketMarketService(context);

        return {
            routes: [
                ...ticketMarketCommandRoutes(service),
                ...ticketMarketComponentRoutes(service),
                ...ticketMarketModalRoutes(service)
            ],
            events: ticketMarketEvents(service),
            admin: ticketMarketAdmin(service),
            state: () => service.exportState(),
            health: () => service.health()
        };
    }
});
```

The contribution returned by `setup()` may include:

- `routes`: application command, context command, autocomplete, component, and modal routes.
- `events`: gateway event handlers.
- `admin`: optional Admin Console panel contribution.
- `state`: optional structured state export.
- `health`: optional operational health summary.
- `services`: named services for other features to consume, such as Message Builder.
- `lifecycle`: optional hooks such as `onEnable`, `onDisable`, `onReady`, and `onShutdown`.

Feature IDs should be stable, lowercase, and use underscores when multiple words are needed. Route IDs should include the owning feature prefix, such as `ticket_market:set_control_channel`.

## Feature Registry

The feature registry is the source of truth for installed features and their contributions. It should:

- reject duplicate feature IDs
- expose sorted feature lists for admin UI and diagnostics
- expose route contributions for the route registry
- expose admin-capable features to the Admin Console
- expose state, health, logger source, and enablement metadata
- provide feature lookup by ID

The registry should not know feature-specific settings or rules. It stores contracts and delegates behavior to the owning feature contribution.

## Route Registry

Discord routing should be unified. The router should not have separate paths for module routes, command routes, and system routes.

Every route contribution should carry enough metadata for generic routing:

```js
{
    owner: 'quest_list',
    kind: 'component',
    id: 'quest_list:add_quests',
    auth,
    cooldown,
    allowWhenDisabled,
    handle
}
```

The router owns:

- command lookup
- custom ID exact and prefix lookup
- autocomplete dispatch
- auth checks
- cooldown checks
- disabled-feature rejection
- interaction context creation
- generic error responses and logging

The owning feature owns product decisions and user-facing workflow behavior.

## Shared Admin UI

The shared admin UI reads admin contributions from the feature registry. The current command is `/module`, but that name still reflects the old module model; a clearer command name should be chosen when this feature is implemented.

The shared `/module` layout owns:

- feature overview
- feature selection/autocomplete
- enable/disable controls for toggleable features
- log level controls
- log export
- state export
- health and runtime status display
- page navigation

Features optionally contribute feature-specific admin pages:

```js
admin: {
    defaultPage: 'overview',
    summary: (context) => ({
        label: 'Open',
        detail: '2 active ads',
        tone: 'success'
    }),
    pages: [
        {
            id: 'channels',
            label: 'Channels',
            auth: auth.manager,
            render: (context) => renderTicketMarketChannels(context, service)
        }
    ]
}
```

Admin page renderers should be functions so they can read current state when a panel opens or refreshes. The shared `/module` layout discovers and frames pages; it must not understand feature-specific settings.

Feature-specific controls rendered inside admin pages remain normal feature-owned routes. They change feature state and then ask the shared admin UI or interaction context to redraw the relevant page.

## Feature Package Shape

Substantial feature packages should use a consistent local shape when it helps clarity:

```text
src/features/<feature-id>/
  index.js          feature definition and composition
  service.js        workflows, state owner, lifecycle behavior
  routes.js         Discord route adapters
  admin.js          Admin Console page contribution
  render.js         Discord output builders
  repository.js     database queries
  rules.js          pure feature decisions
  README.md         feature contract
```

Not every feature needs every file. Tiny features may keep their implementation in `index.js` until they grow real behavior.

## Runtime Infrastructure

Runtime infrastructure is how Snail talks to Discord, config, logs, databases, and other reusable services. These folders should not contain feature-specific policy.

Runtime infrastructure areas include:

- `discord/`: REST wrapper, gateway setup, interaction router, command sync, component builders, Discord payload normalization.
- `config/`: runtime config loading and config catalog.
- `logging/`: logger creation, log level storage, log export behavior.
- `data/snail/`: Snail database connections, shared models, and saved records.
- `data/owo/`: OwO Mongo, Redis, MySQL clients, and named OwO write services.
- runtime auth helpers for owner, manager, helper, staff, and guild-user checks.

Message Builder is a feature that also exposes a service for other features.

## Database Code

`data/` contains database code. Keep Snail-owned records and OwO-owned records separate. Snail can write Snail records. Snail must only write OwO records through named OwO services.

Database code should expose explicit clients, shared models, or narrow services, such as:

- `data/snail/mongo`
- `data/owo/mongo`
- `data/owo/redis`
- `data/owo/mysql`

Feature-specific database queries belong in that feature's `repository.js`. Feature rules should not live in shared data modules.

## Interaction-First Architecture

Snail uses application commands, context commands, buttons, selects, and modals as the primary interface.

Prefix commands and new message-content-dependent features are not part of the default architecture. Features that would require privileged message content need explicit maintainer approval and should document the tradeoff.

Command sync happens on production startup. Treat command definition changes as production-visible behavior.

Guild command sync is authoritative: Snail should sync the guild command list that the current code defines. Syncing an empty guild command list is valid and intentionally removes registered guild commands for the configured guild. Command scope should be declared by the route that owns the command. Guild scope is the default; global commands must opt in explicitly.

Interaction create events do not require gateway intents. Do not add gateway intents for interaction routing unless another current gateway event requires them.

## Discord REST And Gateway

Snail uses Discordeno standalone packages with a local REST wrapper.

The REST wrapper isolates Discord API and library quirks, centralizes message normalization, and lets the project work around missing or newly released Discord fields. Discord REST calls should go through the wrapper or interaction context where possible.

Use raw gateway payloads when Discordeno helpers do not expose newer Discord API fields. Keep raw payload handling close to Discord infrastructure code so feature packages do not each invent their own Discord compatibility layer.

Discord gateway setup lives under `discord/`. It owns Discordeno gateway manager creation, gateway intents, ready logging, and forwarding raw gateway payloads to the interaction/event router.
