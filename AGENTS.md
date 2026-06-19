# Snail Bot Agent Guide

This guide is for coding agents and humans working on Snail Bot. Read it before making non-trivial changes, then read the closest project doc or local README for the area you touch.

Snail is an interaction-first Discord utility bot with clear ownership boundaries, maintainable feature routes, safe operational defaults, and documented feature specs.

## Maintenance

This file is living repo-wide guidance. Update it when source layout, workflow, architecture expectations, safety rules, review process, or other project-wide operating rules change.

Keep this file short. If guidance applies only to one system, module, command group, database boundary, or workflow, put it in that doc instead of expanding this file.

## Source Route

The source layout is rooted at `src/`. Project docs describe the final architecture, not transitional folders or scratch migration paths.

## First Principles

1. **Find the owning feature boundary before writing code.** Put behavior in the module, command package, system, or database boundary that owns it.
2. **Keep commands and interactions thin.** Commands, buttons, modals, and socket handlers parse input, authorize, call the owner, and return output.
3. **Keep systems reusable.** Shared systems provide infrastructure, not feature-specific policy.
4. **Keep persistence focused.** Database files model, load, save, and query data; business rules belong to the owning feature unless they are persistence-specific.
5. **Prefer interaction-first Discord UX.** Application commands, components, and modals are the primary UI. Prefix commands are not part of Snail.
6. **Document lasting choices.** Major architecture choices should get ADRs.
7. **Preserve user work.** Inspect diffs before editing, keep changes scoped, and do not overwrite unrelated changes.
8. **Be production-conservative.** Discord actions, database mutations, socket events, auth changes, and secrets handling are production-sensitive unless explicitly scoped to local development.

## Project Map

The high-level layout is:

```text
src/
  index.js                  Runtime composition and startup flow
  config/                   Runtime config loading and config values
  systems/                  Shared infrastructure
  modules/                  Event/lifecycle-driven runtime modules
  commands/                 Command packages grouped by feature or audience
  database/                 Snail and OwO persistence boundaries
  utils.js                  Small truly shared utilities
docs/                       Project-level guides
AGENTS.md                   Repo-wide agent and contributor operating guide
README.md                   Human-facing project overview and quick start
```

Pending project-map decisions are tracked in the relevant docs until they become ADRs.

## Core Guardrails

- Snail must not change OwO data except through named services that exist specifically for that integration.
- New features must not depend on privileged message content unless the maintainer explicitly approves the tradeoff.
- Bot-authored Discord messages should use Components V2 by default unless a documented Discord limitation or compatibility exception applies.
- Discord API calls should go through the adapter or interaction context where possible.
- The configuration catalog must stay complete and safe.
- Do not commit secrets, real tokens, database credentials, socket tokens, or production-only private config.
- Command sync happens in production on startup, so command definition changes are production-visible.
- Use the configured formatter/checker when one exists. Biome is the expected default unless an ADR chooses different tooling.

## Documentation Map

- `README.md`: project overview, quick start, and docs index
- `docs/architecture.md`: startup flow, system boundaries, module lifecycle, and request/event flow
- `docs/code-standards.md`: coding standards, anti-patterns, and review rubric details
- `docs/configuration.md`: runtime config loader, normal/debug config files, and ignored `.env` values
- `docs/database.md`: Snail/OwO data boundary and persistence conventions
- `docs/development-workflow.md`: development expectations, feature specs, documentation updates, and verification
- `docs/module-readme-template.md`: required README shape for runtime modules
- `docs/command-package-readme-template.md`: required README shape for command packages
- `docs/adr/`: architecture decision records and template
- `src/**/README.md`: local folder-specific guidance when present

Use nested `AGENTS.md` files only when a subsystem needs stricter local operating rules than a README can comfortably explain.

## Agent Expectations

- Read this file and the closest relevant docs before editing.
- Check the current worktree state.
- Identify the owning module, command package, system, or database boundary.
- Keep changes scoped and preserve unrelated user work.
- For substantial new modules or command packages, write or update the local README spec before the work is complete.
- Update docs alongside behavior, setup, architecture, or operational changes.
- Do not disable auth, skip validation, or bypass persistence boundaries as a shortcut.
- Run the narrowest meaningful verification and state what was or was not verified.

## Review Expectations

Reviews should prioritize correctness and risk over rewriting style. Review in this order:

1. Startup, runtime correctness, and user-visible behavior
2. Auth, permissions, secrets, production safety, and data integrity
3. Local README/spec alignment
4. Module/command-package/system/database ownership boundaries
5. Missing tests or missing verification
6. Documentation updates
7. Maintainability, naming, and style

Review findings should explain concrete risk, include file and line references when possible, and avoid broad rewrites unless the current approach is unsafe or likely to harden into the wrong architecture.

## Verification

Use the smallest check that gives meaningful confidence.

- Docs-only changes: proofread, check paths/links, and make sure examples match the source route.
- JavaScript changes: run the configured checker or the closest available focused check.
- Tested behavior or shared runtime changes: run focused tests, and run `npm test` when appropriate.
- Startup, Discord, database, socket, or auth changes: verify as much as possible without touching production services unless explicitly approved.

Always report what changed, what verification ran, what could not be verified, and any remaining risks.

## Pending Architecture Decisions

- The project map may evolve through ADRs, but use the map above until a decision changes it.
- Add nested `AGENTS.md` files only if a subsystem develops local rules that README docs cannot express clearly.
- Vitest is the standard test framework. The focused-test command can be finalized once testable code exists.
- Runtime config lives under `src/config/`; update configuration docs if the config loading model changes.
- Document the command package registration model in command docs once that design is chosen.
