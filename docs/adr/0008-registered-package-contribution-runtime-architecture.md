# ADR 8: Registered Package Contribution Runtime Architecture

## Context

Snail needs one runtime contribution model for user-facing features, staff/admin tools, lifecycle behavior, and shared interaction surfaces. Separating those concerns into unrelated primary route paths makes route registration and admin UI composition uneven.

The implemented feature set now makes the shared shape clearer. Quest List, Ticket Market, Tags, Message Builder, Logs, the shared admin UI, and small utility commands all contribute Discord routes and own user-facing behavior. Some also own lifecycle hooks, saved records, admin panels, external data access, or shared services.

The architecture should express that common model directly without flattening ownership. Snail still needs reusable runtime infrastructure and shared database code, but registered packages should declare what they contribute to the runtime. Product/admin-visible behavior should include explicit feature metadata.

## Decision

Snail will use a registered package contribution runtime architecture.

Source will be organized around:

- `src/runtime/` for runtime composition, package registry setup, registries, command sync planning, and startup ordering.
- `src/discord/` for Discord REST/gateway, routing, command sync, component helpers, and Discord payload normalization.
- `src/config/` for runtime config loading and config catalog.
- `src/logging/` for logger creation, log levels, and log export support.
- `src/data/` for Snail databases, OwO database clients, and saved records.
- `src/features/` for product, utility, and admin feature packages.
- `src/util/` for small general utilities.

Only add source folders and shared service categories for current features or concrete planned features. Concrete planned features are named product behavior, route kinds, databases, admin surfaces, or runtime capabilities already described by project docs. Do not keep generic buckets for unspecified future work.

Registered packages contribute runtime pieces. A package may directly export a contribution object, or export a setup function when it needs runtime context. Packages are registered in the order they appear in `PACKAGE_REGISTRY`, and services exposed by earlier packages are available to later setup functions. Contributions may include routes, services, lifecycle hooks, admin pages, state export, and optional `feature` metadata. A feature is a product/admin-visible contribution with stable feature identity.

Discord routing will be unified through route contributions. The router should not have separate module-route, command-route, and system-route paths.

The shared admin UI reads admin-visible feature contributions from the registry. It owns the shared admin layout, navigation, enable/disable controls, log controls, and state export. The current command is `/module`, but that name still reflects the old module model; a clearer command name should be chosen when this feature is implemented.

Message Builder will be modeled as a registered package contribution that exposes a service and Discord routes for other features.

Database code will be split between Snail-owned records, OwO database clients, and feature-local repositories. Feature-specific schemas and query vocabulary live with the owning feature unless the model is genuinely cross-feature.

## Alternatives Considered

| Alternative | Summary | Rejected Because |
| --- | --- | --- |
| Keep modules, commands, and systems as separate primary concepts | Preserve separate top-level concepts and improve the glue around them. | Implemented features share route/admin/lifecycle patterns across those categories, so preserving the split keeps extra translation points and makes the runtime harder to reason about. |
| Make everything a module | Collapse commands, systems, and features into the old module abstraction. | This would overfit the runtime to lifecycle/admin behavior and blur the difference between product behavior, reusable infrastructure, and database code. |
| Use a deep class hierarchy | Model features, toggleable features, admin features, and service features as inherited classes. | The project needs clear contracts more than inheritance. Plain registered package contributions and registry tests are easier to compose, review, and evolve than inheritance. |
| Build a generic dependency injection container | Resolve all services, databases, and features through a container. | Snail benefits from explicit runtime composition. A broad container would hide dependencies and make production-sensitive startup harder to review. |

## Pros

- Gives commands, components, modals, gateway events, lifecycle hooks, admin panels, logs, and state export one contribution model.
- Keeps product behavior in feature packages while preserving runtime and database ownership.
- Lets small command-only behavior and large lifecycle-heavy behavior use the same registry without pretending they have the same complexity or the same feature metadata.
- Makes the shared admin UI discover panels from the registry instead of importing feature implementations directly.
- Keeps startup composition explicit before command sync or gateway start.
- Reduces historical layering and route-collection special cases.

## Cons

- Requires replacing the module/command/system source layout.
- Requires new contracts before feature implementations can land.
- Contributions can become too large if packages do not split service, routes, admin, render, repository, and rules files when behavior grows.
- Runtime setup and tests need clear contracts so contribution objects stay consistent as features grow.

## Consequences

- New substantial behavior belongs under `src/features/<feature-id>/`.
- Runtime infrastructure must stay reusable and avoid feature-specific policy.
- Shared Snail data belongs under `src/data/snail/`; OwO database clients belong under `src/data/owo/`; neither should own Snail feature rules.
- Route handlers should remain thin and delegate to feature services.
- Feature READMEs replace separate module and command-package README templates.
- This ADR supersedes source-layout guidance in earlier docs and ADR consequences that refer to `src/modules/`, `src/commands/`, or `src/systems/` as primary architecture folders.
- Existing ADRs for interaction-first behavior, Discordeno REST/gateway, command sync, ESM, dotenv, Vitest, and Biome otherwise remain in force.
- Project docs should describe the feature architecture rather than module/command/system folders as primary architecture folders.

## Links

- Related docs: [Architecture](../architecture.md), [Database](../database.md), [Feature README template](../feature-readme-template.md)
