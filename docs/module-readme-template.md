# Module README Template

Use this template for `src/modules/<ModuleName>/README.md`.

Module READMEs are specs for runtime modules: features that react to Discord gateway events, lifecycle hooks, background state, module panels, structured logs, or module-specific routes. Substantial command-only features should use `docs/command-package-readme-template.md` instead; simple commands can stay as single files.

Keep this README current with the implemented module. Remove sections that truly do not apply, but prefer writing "None" or "Not applicable" when an absence is an intentional part of the design.

```md
# Module Name

## Purpose

What user, staff, or operational problem does this module own?

Why is this a runtime module instead of a command package?

## Ownership

This module owns:

- owned behavior/state/surfaces

This module does not own:

- explicit non-goals or delegated behavior

Delegate to:

- `systems/` for shared Discord/runtime infrastructure
- `database/` or named services for persistence/integration boundaries
- other modules only through explicit public behavior

## User Workflows

Describe the main user-facing or staff-facing flows.

- Flow name: summary

## Commands and Interactions

List slash commands, context commands, components, selects, and modals.

| Route | Audience | Purpose | Notes |
| --- | --- | --- | --- |
| `/example` | staff/users | ... | ... |

Long-running commands must `defer()` and finish with `editReply()`.

Document module-owned command metadata such as `staff: true` for staff-only Discord visibility, runtime `auth`, and `cooldown` when the command is throttled per user.

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

## Admin Panel

Describe `state()`, `panelPages()`, structured logs, exports, and module-specific admin actions. Name each module-owned panel page and summarize the controls on it. Shared Runtime controls such as enable/disable, log export, state export, and log level belong to the shared `/module` panel, not the module-specific page list.

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

Track real unresolved local choices. Stable implemented modules should use "None" here unless a genuine decision remains open. Move global architecture choices into ADRs.

- None.

## ADR Links

- ADR link or "None"
```
