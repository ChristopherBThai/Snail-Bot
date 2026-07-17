# Architecture

This document describes the runtime shape for Snail.

## Runtime Model

Snail is an interaction-first Discord app composed from registered package contributions. A registered package may contribute routes, services, lifecycle hooks, admin pages, state export, or feature metadata. A feature is the product/admin-visible subset of those contributions, not every command or shared service.

The primary source folders are:

- `runtime/`: runtime composition, package registry setup, route indexes, command sync planning, and startup ordering.
- `discord/`: Discord REST, gateway setup, interaction routing, route authorization, command sync, component builders, and Discord payload normalization.
- `config/`: runtime config loading and config catalog.
- `logging/`: logger creation, log levels, and log export support.
- `data/`: database code, saved Snail records, and OwO database clients.
- `features/`: user-facing, staff-facing, and admin feature packages such as Quest List, Ticket Market, Tags, Message Builder, Logs, the shared admin UI, Echo, Edit, Nick, and Snail.
- `util/`: small general utilities that do not deserve a runtime service or feature-local home.

Small commands may be route-only contributions. They do not need fake feature identity unless they own product/admin-visible behavior.

Only add source folders and shared service categories for current features or concrete planned features. Concrete planned features are named product behavior, route kinds, databases, admin surfaces, or runtime capabilities already described by project docs. Do not keep generic buckets for unspecified future work.

## Runtime Flow

`src/index.js` should stay a thin runtime entry point. Startup should compose the runtime in a predictable order:

1. Load configuration.
2. Create runtime logging.
3. Connect required databases and external services.
4. Create runtime services such as Discord REST, the contribution registry, logger registry, and feature state storage.
5. Load registered packages.
6. Set up registered packages that need an app context.
7. Load saved feature runtime state such as enablement and log levels.
8. Enable features that should run on startup.
9. Collect route contributions.
10. Sync application commands.
11. Start the Discord gateway.

Startup should make runtime failures observable. The bot has known runtime infrastructure and composes it directly. If required config, databases, or services are unavailable, startup should fail before command sync or gateway start.

## Registered Package Contributions

Packages export plain source-authored contribution objects. If a package needs runtime context, it exports a setup function directly and returns the contribution object. Package setup should compose services, repositories, routes, and contribution metadata; it should not perform database reads, database writes, Discord API calls, or other startup I/O. When a package needs saved startup state, Snail should add an explicit package initialization phase after the registry is fully composed and before command sync or gateway startup. The package registry is static source, so tests verify contribution shape, feature metadata when present, route identity, and routing conflicts. Runtime code trusts registered contributions after that test-time contract.

Example route-only contribution:

```js
export default {
    routes: [
        {
            kind: 'command',
            id: 'snail:command',
            command: {
                type: ApplicationCommandType.ChatInput,
                name: 'snail',
                description: '🐌'
            },
            handle(context) {
                return context.respond('🐌');
            }
        }
    ]
};
```

Example admin-visible feature contribution that needs runtime context:

```js
export default function setupTicketMarket(context) {
    const service = createTicketMarketService(context);

    return {
        feature: {
            id: 'ticket_market',
            name: 'Ticket Market',
            description: 'Manages Ticket Market access, seller ads, and trading availability.',
            toggleable: true
        },
        routes: [
            ...ticketMarketCommandRoutes(service),
            ...ticketMarketComponentRoutes(service),
            ...ticketMarketModalRoutes(service)
        ],
        events: ticketMarketEvents(service),
        admin: ticketMarketAdmin(service),
        state: () => service.exportState()
    };
}
```

A registered package contribution may include:

- `routes`: package-owned inbound Discord handlers. The current runtime supports application command, component, and modal routes. Runtime support for another route kind should only be added when registry indexing, command sync when needed, gateway dispatch, tests, and docs all support that kind.
- `feature`: optional product/admin-visible metadata.
- `events`: gateway event handlers.
- `admin`: optional Admin Console panel contribution.
- `state`: optional structured state export.
- `services`: named services for other features to consume, such as Message Builder.
- `lifecycle`: optional hooks such as `onEnable`, `onDisable`, `onReady`, and `onShutdown`.

Feature IDs should be stable, lowercase, and use underscores when multiple words are needed. Route IDs should include a stable owner prefix, such as `ticket_market:set_control_channel` or `snail:command`.

## Contribution Registry

The contribution registry is the source of truth for registered packages, their contributions, admin-visible features, services, and the route indexes built from those contributions. It should:

- own the package registry
- expose sorted feature lists for admin UI and diagnostics
- expose route contributions and route lookup indexes
- expose admin-capable features to the Admin Console
- expose state, logger source, and enablement metadata
- provide feature lookup by ID

Creating a package under `src/features/` does not register it by itself. Snail does not scan feature directories or load packages by naming convention. To register a contribution, import it in `src/runtime/registry.js` and add it to `PACKAGE_REGISTRY`. Packages are registered and set up in the order they appear in `PACKAGE_REGISTRY`; services exposed by earlier packages are available to later setup functions. The package registry is intentionally explicit so startup composition, tests, command sync, routing, and admin discovery all agree on the same source of truth. Registry tests verify feature metadata when present, duplicate feature IDs, registered route shape, implemented route contracts, duplicate route IDs, duplicate command names, and component/modal custom ID prefixes that are unique and do not overlap.

The registry should not know feature-specific settings or rules. It stores contracts, builds lookup indexes, and delegates behavior to the owning contribution.

## Routes

Discord routing should be unified. A route is a package-owned handler for an inbound Discord surface: "when this inbound thing arrives, call this owning handler." The runtime should not have separate paths for module routes, command routes, and system routes.

Route IDs are Snail's stable internal route identity for logs, diagnostics, tests, admin references, and future state keys. Discord matching uses kind-specific fields such as `command.name`, `customId`, `customIdPrefix`, or gateway event names. Do not use the route ID as the Discord matching key unless the owning route deliberately makes those values the same.

Application commands share `kind: 'command'`. Slash commands, user context commands, and message context commands should be distinguished by the Discord command definition, such as `command.type`, not by separate route kinds.

Component and modal routes match the `custom_id` Discord sends back when a user clicks a component or submits a modal. The route ID is Snail's internal name for that route. The `customIdPrefix` is the beginning of the Discord `custom_id` values that route handles, such as `message_builder:action:` for Message Builder action selects. Prefixes must be unique and non-overlapping: no component prefix may start with another component prefix, and no modal prefix may start with another modal prefix.

Every route contribution should carry enough metadata for generic routing:

```js
{
    kind: 'command',
    id: 'ticket_market:command',
    command: {
        name: 'ticket-market',
        description: 'Open Ticket Market.',
        staff: true
    },
    authorize: hasManagerAccess,
    cooldown,
    allowWhenDisabled,
    handle
}
```

As each route kind is implemented, the router owns the relevant generic routing work:

- command lookup
- custom ID exact and prefix lookup
- autocomplete dispatch
- route authorization through `authorize(context)`
- cooldown checks
- disabled-feature rejection
- interaction context creation
- generic error responses and logging

Do not add runtime support for a route kind until the full path exists for that kind: registry indexing, Discord sync when applicable, gateway dispatch, focused tests, and docs.

The owning feature owns product decisions and user-facing workflow behavior.

## Shared Admin UI

The shared admin UI reads admin-visible feature contributions from the contribution registry. The current command is `/module`, but that name still reflects the old module model; a clearer command name should be chosen when this feature is implemented.

The shared `/module` layout owns:

- feature overview
- feature selection/autocomplete
- enable/disable controls for toggleable features
- log level controls
- log export
- state export
- runtime status display
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
            authorize: hasManagerAccess,
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
  index.js          contribution and composition
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

- `discord/`: REST wrapper, gateway setup, interaction router, route authorization, command sync, component builders, Discord payload normalization.
- `config/`: runtime config loading and config catalog.
- `logging/`: logger creation, log level storage, log export behavior.
- `data/snail/`: Snail database connections, shared models, and saved records.
- `data/owo/`: OwO Mongo, Redis, MySQL clients, and named OwO write services.
- Discord route authorization helpers such as `hasManagerAccess`, with owner, admin, manager, helper, and staff hierarchy helpers.

Message Builder is a registered package contribution that exposes a service and Discord routes for other features to use.

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

Command sync is authoritative: Snail should sync the guild and global command lists that the current code defines. Syncing an empty command list is valid and intentionally removes registered commands for that sync target. Command routes are guild commands by default. Global commands must opt in with `command.global: true` on the route that owns the command.

Staff commands should set `command.staff: true`. During command sync, Snail adds Discord's `Bypass Slowmode` default member permission so users without that permission do not see the command. This only controls Discord-side command visibility; runtime `authorize` checks remain the source of truth for access.

Interaction create events do not require gateway intents. Do not add gateway intents for interaction routing unless another current gateway event requires them.

## Discord REST And Gateway

Snail uses Discordeno standalone packages with a local REST wrapper.

The REST wrapper isolates Discord API and library quirks, centralizes message normalization, and lets the project work around missing or newly released Discord fields. Discord REST calls should go through the wrapper or interaction context where possible.

Use raw gateway payloads when Discordeno helpers do not expose newer Discord API fields. Keep raw payload handling close to Discord infrastructure code so feature packages do not each invent their own Discord compatibility layer.

Discord gateway setup lives under `discord/`. It owns Discordeno gateway manager creation, gateway intents, ready logging, and forwarding raw gateway payloads to the interaction/event router.
