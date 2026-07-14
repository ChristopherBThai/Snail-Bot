# Feature Name

## Purpose

Describe what this feature does for users, staff, or operations.

Explain why this is a feature package and name the long-lived behavior, state, routes, admin pages, or external storage access it owns.

## Ownership

This feature owns:

- ...

This feature does not own:

- ...

Delegate to:

- `discord/` for Discord REST, gateway, routing, and component helpers.
- `data/snail/` for shared Snail-owned models and database setup.
- `data/owo/` for OwO Mongo, Redis, MySQL, and named OwO write services.
- Other feature services only when this feature directly calls them.

## User Workflows

- Workflow name: describe the normal user or staff flow and the expected result.

## Routes

List inbound Discord handlers contributed by this feature. Include only route kinds supported by the current runtime. Routes include stable Snail route IDs and the Discord matching fields they use, such as command names.

| Route | Discord Match | Audience | Purpose | Notes |
| --- | --- | --- | --- | --- |
| `feature_id:command` | `/example` | users | ... | ... |
| `feature_id:action` | `custom_id` when supported | staff | ... | ... |

Long-running interactions that read OwO data, save records, or call Discord should use the appropriate defer/edit flow. Fast validation failures may respond immediately.

## Admin Pages

Describe any Admin Console contribution. If the feature has no admin surface, say so.

- Summary: what appears on the feature overview.
- Runtime page: shared enable/disable, logs, and state controls are owned by Admin Console.
- Feature pages:
  - Overview: ...
  - Settings: ...

Feature-specific admin controls should be normal feature-owned routes.

## State And Data

Describe current state, saved state, runtime-only state, cache behavior, and external reads/writes.

- Snail state:
- Runtime-only state:
- External reads:
- External writes through named services:
- Cache/invalidation:

## Runtime And Data Access

List the runtime objects, databases, feature services, and config values this feature uses.

| Resource | Purpose |
| --- | --- |
| `databases.snail.mongo` | ... |
| `config.discord.guildId` | ... |

## Authorization

Describe who can use each workflow and how auth is checked.

Call out edge cases such as stale components, disabled features, missing roles, owner overrides, and public-vs-ephemeral responses.

## Rendering And Responses

Describe key Discord messages, Components V2 layouts, mentions policy, modal fields, selects, and response visibility.

Renderers should receive prepared display state. They should not query databases or calculate feature rules.

## Failure Modes

- Missing config:
- Disabled feature:
- Missing user or guild identity:
- Data unavailable:
- External storage unavailable:
- Discord API failure:
- Incomplete update:

## Test Plan

- Unit:
- Integration:
- Manual:
- Regression:

Verification commands:

- `npm run check`
- `npm test`

## Open Questions

- None.

## ADR Links

- Add relevant ADR links using paths relative to the feature README. Include Registered Package Contribution Runtime Architecture when useful.
