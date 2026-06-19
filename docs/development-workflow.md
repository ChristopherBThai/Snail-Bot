# Development Expectations

This document describes what development work in Snail should preserve, regardless of each contributor's personal workflow.

## Workflow Expectations

Contributors may use different personal workflows as long as changes preserve:

- ownership boundaries
- documentation accuracy
- verification proportional to risk
- production safety
- maintainable feature shape

## Feature Specs

Substantial runtime modules and command packages should have a local README spec by the time the feature is complete. Writing the README before implementation is recommended for new features, but the important requirement is that the final implementation and README agree.

- Runtime modules use `src/modules/<ModuleName>/README.md` from `docs/module-readme-template.md`.
- Command-only features use `src/commands/<package>/README.md` from `docs/command-package-readme-template.md`.
- Local READMEs should describe purpose, ownership, user workflows, commands/interactions, state, authorization, failure modes, and test plan.
- Update the local README whenever implementation clarifies or changes the spec.
- Write or update an ADR when a decision changes global architecture.

## Before Editing

1. Read `AGENTS.md`.
2. Read the closest project doc or local README for the area you touch, when one exists.
3. Check current worktree state.
4. Identify the owning module, command package, system, or database boundary.
5. For substantial modules or command packages, create or update the local README spec before the work is considered complete.
6. Note any global doc or ADR updates before editing.

## Adding Features

- Add or update the owning module or command package first.
- Register module-owned commands, components, modals, and events through the owning module when practical.
- Keep command-only features in command packages such as `src/commands/tags/`.
- Keep command files thin.
- Put reusable Discord infrastructure in `systems/`.
- Put persistence access behind focused database or service boundaries.
- Keep feature behavior testable through production-facing interfaces instead of test-only shims.

For horizontal feature growth, prefer adding a local feature README over expanding global docs. Update global docs only when a reusable pattern, constraint, or architecture decision changes.

## Documentation Updates

Update docs when:

- a config option is added or removed
- startup requirements change
- a module, command, socket event, or database model is added
- behavior changes in a way users, maintainers, or agents need to understand
- an operational risk or security rule changes
- a new project pattern becomes the expected way to build future work

## Verification

Use the narrowest meaningful check first.

- Docs-only changes: proofread and check links/paths.
- JavaScript changes: run the configured checker or the closest available focused check.
- Tested behavior: run focused tests, and run `npm test` when appropriate.
- Startup/runtime changes: verify imports, configuration, and startup composition.

Keep command examples in docs aligned with actual `package.json` scripts. Remove or revise doc references to scripts that are not part of the project.
