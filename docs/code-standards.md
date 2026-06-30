# Code Standards

This document captures repo-wide code quality rules and review standards.

## Style

- Use modern ESM JavaScript.
- Use project import aliases for stable shared boundaries.
- Use the configured formatter/checker when one exists. Biome is the expected default; see [ADR 7](adr/0007-biome-formatting-and-checking.md).
- Keep files focused on one clear responsibility.
- Prefer explicit names over clever abbreviations.
- Implement the shape that exists now. Do not add fields, branches, spreads, adapters, or extension points only for possible future config or feature needs.
- Treat runtime entry points as direct execution files unless the current code imports them. Do not add import-safe guards only for hypothetical reuse.
- Do not over-normalize data the codebase owns. Normalize external text input, env values, Discord payloads, and database records at their boundaries; do not add defensive cleanup around trusted internal config or objects without a current reason.
- Trust required runtime dependencies after startup and composition. Do not add fallback defaults or optional chaining around config, loggers, databases, module dependencies, or interaction context fields that Snail creates and requires.
- Keep mode and option behavior direct. If a caller wants resume behavior, use a resume mode; do not hide special-case behavior inside a different mode plus target or option checks.
- Add comments only for non-obvious decisions, invariants, or operational risks.
- Avoid unrelated formatting churn.

## Helpers and Abstractions

Helpers should earn their place by making behavior clearer, safer, or more consistent.

- Prefer direct calls when a helper only renames or proxies one existing operation.
- Inline one-use helpers when the call site becomes easier to read with the code in place.
- Keep helpers when they centralize repeated policy, enforce an invariant, or apply consistent logging, validation, or Discord response shape.
- Finished features should not keep transitional helpers, compatibility branches, and old terminology once the final direction no longer needs them.
- Prefer small local helpers over global utilities unless multiple owners truly share the behavior.

## Logging

Logs should help diagnose runtime behavior from user reports without requiring a debugger.

- Create loggers through the owning system, command file, command package, or module boundary.
- Use stable dot-separated event names such as `message_builder.action`, `tag.created`, or `quest_list.quest_added`.
- Use `trace` for detailed flow and state snapshots, `debug` for normal diagnostic actions, `info` for lifecycle and user-visible success, `warn` for rejected operations, and `error` for failures.
- Prefer structured fields such as IDs, counts, modes, result codes, durations, and small state summaries.
- Avoid logging raw user-authored text unless the text itself is needed to diagnose the feature and is acceptable to expose in runtime logs.
- Do not add logger optional chaining in code paths where Snail owns logger creation.

## Discord Interactions

Interaction handlers should use the simplest response flow that fits the current behavior.

- Use direct `respond` and `edit` calls for fast interactions.
- Use `defer`, `editReply`, and followups only when the current implementation does slow work that needs the extra interaction window or when Discord requires that response shape.
- Validation failures from component actions should usually respond ephemerally without replacing the current panel.
- Bot-authored user-facing messages should suppress mentions unless a feature explicitly documents an exception.
- Component builders should make invalid Discord payloads impossible through available actions, not rely on Discord rejecting bad messages.

## Ownership

Put behavior where it is owned.

- Event/lifecycle-driven behavior belongs in the owning module or a module-local service/domain file.
- Command-only feature behavior belongs in the owning command file, command package, or command-package-local service/domain file.
- Shared infrastructure belongs in `systems/`.
- Persistence behavior belongs in `database/`.
- Command files adapt Discord input/output and delegate behavior.
- Renderers and message builders render prepared state; they should not calculate domain rules.

## Anti-Patterns

Reject these during implementation and review:

- Thin command handlers or interaction handlers that own long-term feature policy instead of delegating to the owning module, command file, or command package.
- Renderers that calculate domain behavior instead of rendering prepared state.
- Database modules that accumulate business behavior unrelated to persistence.
- Global helper files that become dumping grounds for feature-specific logic.
- Thin wrappers that only rename or proxy one existing call.
- Static facades that construct an object only to call one method.
- New abstractions introduced before Snail has enough real usage to justify them.
- Defensive normalization against data shapes the current code cannot produce.
- Hidden mode behavior where one mode silently behaves like another because of specific target or option combinations.
- Stale feature artifacts such as old command names, old log event names, old upload/storage terminology, or unused compatibility branches after scope changes.
- Debug-only shortcuts that can leak into production.

## Review Standards

Reviews should prioritize correctness, safety, ownership boundaries, missing verification, and documentation accuracy before style preferences.

Review findings should explain concrete risk and include file and line references when possible. Style feedback should not fight formatter output.

## Tests and Type Checks

Use `npm test` as the standard way to run tests. If a component does not have tests yet, add focused tests when behavior risk justifies them.

Test Snail behavior, not external libraries. Do not add tests that only prove a dependency constructor, parser, or API works as documented. Tests around wrappers or adapters should verify Snail's validation, normalization, routing, error handling, or boundary contract.

Avoid tests that only mirror a one-line guard or pass-through wrapper. Add focused tests when the wrapper owns meaningful validation, transformation, routing, error handling, or production-risk behavior.

Tests should describe the final user-visible and persistence behavior, not transitional implementation details. When a feature no longer defers, uploads files, or uses an old command shape, update tests to assert the new shape instead of preserving the old path.

Prefer regression tests for bugs and risks Snail has actually hit, especially invalid Discord component payloads, stale interaction sessions, missing fallback rendering, permission boundaries, persistence updates, and log events used for debugging.

Use the package scripts for verification and formatting:

- `npm run check`: run Biome checks.
- `npm run check:fix`: run Biome checks and safe writes.
- `npm run format`: run Biome formatting checks.
- `npm run format:fix`: run Biome formatting writes.
