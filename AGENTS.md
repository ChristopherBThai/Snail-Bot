# Snail Bot Agent Guide

This file is for AI agents working on Snail Bot. Read it before making non-trivial changes, then read the closest project doc or local feature README for the area you touch.

Snail is an interaction-first Discord utility bot built from registered package contributions and concrete runtime infrastructure.

The canonical detailed coding and review standard is [`docs/code-standards.md`](docs/code-standards.md). Keep this file as the short agent entrypoint; add detailed examples, review rubrics, and project-wide coding rules to the standards doc instead of duplicating them here.

## First Principles

1. **Find the owner before writing code.** Product behavior belongs in the owning feature package; reusable infrastructure belongs in the concrete runtime folder that owns it.
2. **Keep Discord routes thin.** Commands, buttons, selects, modals, and gateway event handlers parse input, authorize, call the owner, and return output.
3. **Keep runtime infrastructure reusable.** Runtime, Discord, config, logging, and data code provide infrastructure, not feature-specific policy.
4. **Keep database code focused.** Database code loads, saves, connects, and translates database-specific records; feature rules belong to the owning feature.
5. **Prefer interaction-first Discord UX.** Application commands, components, and modals are the primary UI. Prefix commands are not part of Snail.
6. **Preserve user work.** Inspect diffs before editing, keep changes scoped, and do not overwrite unrelated changes.
7. **Be production-conservative.** Discord actions, database mutations, gateway events, auth changes, command sync, and secrets handling are production-sensitive unless explicitly scoped to local development.
8. **Avoid speculative architecture.** Add folders, services, fields, config, extension points, and docs for current features or concrete planned features already described by project docs. Do not add generic buckets for unspecified future work.

## Source Map

```text
src/
  index.js                  Runtime entry point
  runtime/                  Runtime composition, package registry, startup ordering
  discord/                  REST, gateway, routing, command sync, component helpers
  config/                   Runtime config loading and config catalog
  logging/                  Logger creation, log levels, log export support
  data/                     Snail databases, OwO database clients, and saved records
  features/                 Product, utility, and admin feature packages
  util/                     Small general utilities
docs/                       Project-level guides
docs/adr/                   Architecture decision records
AGENTS.md                   AI agent operating guide
README.md                   Human-facing project overview and quick start
```

Use this map unless a newer ADR changes it.

## Required Context

Before non-trivial edits or reviews:

- Read this file.
- Read [`docs/code-standards.md`](docs/code-standards.md) and apply it as a checklist.
- Read the closest relevant project doc, such as [`docs/architecture.md`](docs/architecture.md), [`docs/configuration.md`](docs/configuration.md), or [`docs/database.md`](docs/database.md).
- Read `src/features/<feature-id>/README.md` before changing a feature when one exists.
- Check `git status --short` before editing and again before reporting completion.

## Core Guardrails

- Snail must not change OwO data except through named OwO services.
- New features must not depend on privileged message content unless the maintainer explicitly approves the tradeoff.
- Bot-authored Discord messages should use Components V2 by default unless a documented Discord limitation or compatibility exception applies.
- Discord API calls should go through the Discord REST wrapper or interaction context where possible.
- The configuration catalog and config shape tests must stay complete and safe.
- Do not commit secrets, real tokens, database credentials, socket tokens, or production-only private config.
- Command sync happens in production on startup, so command definition changes are production-visible.
- Use the package formatter/checker scripts. Biome is the project formatter/checker unless an ADR chooses different tooling.

## Working Rules

- Identify the owning feature, runtime service, database code, or utility helper before editing.
- Keep changes scoped. Avoid unrelated refactors, formatting churn, and cleanup outside the task.
- For substantial features, write or update the local feature README contract before the work is complete.
- Update docs alongside behavior, setup, architecture, operational, or safety changes.
- Do not disable auth, skip validation, bypass database ownership rules, or hide production failures as a shortcut.
- If the maintainer names architecture concerns, treat them as blocking acceptance criteria and use the feedback closure process in [`docs/code-standards.md`](docs/code-standards.md) before claiming completion.
- Preserve intentional user-visible Discord copy, layout, and interaction behavior unless the task asks to change it or the current behavior is unsafe.

## Review Stance

When asked for a review, prioritize findings in this order:

1. Startup, runtime correctness, and user-visible behavior
2. Auth, permissions, secrets, production safety, and data integrity
3. Feature README/spec alignment
4. Feature/runtime/database ownership
5. Missing tests or missing verification
6. Documentation updates
7. Maintainability, naming, and style

Review findings should explain concrete risk, include file and line references when possible, and avoid broad restructuring unless the current approach is unsafe or likely to harden into the wrong architecture.

## Verification

Use the smallest check that gives meaningful confidence.

- Docs-only changes: proofread, check paths/links, and make sure examples match the source map.
- JavaScript changes: run the configured checker or the closest available focused check.
- Contribution additions or feature metadata changes: run the tests that cover `src/runtime/registry.js` so registered-contribution and route expectations still hold.
- Tested behavior or shared runtime changes: run focused tests, and run `npm test` when appropriate.
- Startup, Discord, database, gateway, or auth changes: verify as much as possible without touching production services unless explicitly approved.

Always report what changed, what verification ran, what could not be verified, and any remaining risks.
