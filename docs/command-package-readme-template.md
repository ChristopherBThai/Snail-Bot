# Command Package README Template

Use this template for `src/commands/<package>/README.md`.

Command package READMEs are specs for command-only features. Use a command package when a feature is primarily invoked through application commands/components/modals and does not need gateway event handling, lifecycle hooks, module panels, or long-lived runtime state.

Keep this README current with the implemented command package. Remove sections that truly do not apply, but prefer writing "None" or "Not applicable" when an absence is an intentional part of the design.

```md
# Command Package Name

## Purpose

What user, staff, or operational problem does this command package own?

Why is this a command package instead of a runtime module?

## Ownership

This command package owns:

- owned behavior/state/surfaces

This command package does not own:

- explicit non-goals or delegated behavior

Delegate to:

- `systems/` for shared Discord/runtime infrastructure
- `database/` or named services for persistence/integration boundaries
- runtime modules only through explicit public behavior

## User Workflows

Describe the main user-facing or staff-facing flows.

- Flow name: summary

## Commands and Interactions

List slash commands, context commands, components, selects, and modals.

| Route | Audience | Purpose | Notes |
| --- | --- | --- | --- |
| `/example` | staff/users | ... | ... |

Long-running commands must `defer()` and finish with `editReply()`.

## State and Persistence

Describe Snail state, OwO reads, external services, cache behavior, and write boundaries.

- Snail state:
- OwO reads:
- OwO writes through named services:
- External services:
- Cache/invalidation:

## Authorization

Describe who can use each action and why.

- User actions:
- Staff actions:
- Owner/admin actions:
- Auth edge cases:

## Rendering and Responses

Describe response style, Components V2 usage, legacy exceptions, files/uploads, and message-builder integration.

## Failure Modes

Describe expected behavior when dependencies fail or Discord operations error.

- Missing config:
- Database unavailable:
- External service unavailable:
- Discord API failure:
- Partial update:

## Test Plan

List unit, integration, and manual scenarios.

- Unit:
- Integration:
- Manual:
- Regression:

## Open Questions

Track real unresolved local choices. Stable implemented command packages should use "None" here unless a genuine decision remains open. Move global architecture choices into ADRs.

- None.

## ADR Links

- ADR link or "None"
```
