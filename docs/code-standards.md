# Code Standards

This document captures repo-wide code quality rules and review standards.

## Style

- Use modern ESM JavaScript.
- Use project import aliases for stable shared boundaries.
- Use the configured formatter/checker when one exists. Biome is the expected default unless an ADR chooses different tooling. TODO: link the tooling ADR once it exists.
- Keep files focused on one clear responsibility.
- Prefer explicit names over clever abbreviations.
- Add comments only for non-obvious decisions, invariants, or operational risks.
- Avoid unrelated formatting churn.

## Ownership

Put behavior where it is owned.

- Event/lifecycle-driven behavior belongs in the owning module or a module-local service/domain file.
- Command-only feature behavior belongs in the owning command package or a command-package-local service/domain file.
- Shared infrastructure belongs in `systems/`.
- Persistence behavior belongs in `database/`.
- Command files adapt Discord input/output and delegate behavior.
- Renderers and message builders render prepared state; they should not calculate domain rules.

## Anti-Patterns

Reject these during implementation and review:

- Thin command handlers or interaction handlers that own long-term feature policy instead of delegating to the owning module or command package.
- Renderers that calculate domain behavior instead of rendering prepared state.
- Database modules that accumulate business behavior unrelated to persistence.
- Global helper files that become dumping grounds for feature-specific logic.
- Thin wrappers that only rename or proxy one existing call.
- Static facades that construct an object only to call one method.
- New abstractions introduced before Snail has enough real usage to justify them.
- Debug-only shortcuts that can leak into production.

## Review Language

Use:

- `Must`: blocking issue; correctness, startup, data integrity, auth, production safety, or serious maintainability risk.
- `Should`: important issue that should be fixed before merge unless the maintainer accepts the tradeoff.
- `Consider`: optional improvement, cleanup, naming, clarity, or future follow-up.

Review findings should lead with actionable issues, explain the risk, and include file and line references when possible. Style feedback should not fight formatter output.

## Tests and Type Checks

Use `npm test` as the standard way to run tests. If a component does not have tests yet, add focused tests when behavior risk justifies them.

If linting, formatting, or type checking is configured, expose it through named npm scripts. Prefer clear names such as `npm run format`, `npm run lint`, `npm run check`, or `npm run typecheck` based on what the tool actually does.

TODO: replace the script examples with the actual `package.json` scripts once they are created.
