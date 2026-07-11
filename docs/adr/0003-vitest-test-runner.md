# ADR 3: Vitest Test Runner

## Context

Snail needs a standard JavaScript test runner for focused unit tests and runtime behavior tests.

## Decision

Snail will use Vitest as the project test runner.

`npm test` runs `vitest run`.

## Alternatives Considered

| Alternative | Summary | Rejected Because |
| --- | --- | --- |
| Node built-in test runner | Use `node --test` with no test dependency. | It is enough for very small tests, but Vitest gives the project a stronger path for watch mode, mocks, and feature tests while still keeping setup simple. |
| Jest | Use Jest as the project test runner. | Jest is a larger test stack than Snail needs and would add more configuration friction around native ESM. |
| No tests yet | Delay test setup until Discord behavior exists. | The foundation already has small behavior worth checking, and delaying test setup would make later changes easier to ship without verification. |

## Pros

- Provides a familiar assertion, watch, and mocking path for feature tests.
- Keeps `npm test` as the single standard verification command.

## Cons

- Adds a development dependency.
- Test helpers should not require production code paths or public APIs that exist only for tests.

## Consequences

- Tests should import from `vitest`.
- `package.json` owns the test command.
- Focused tests should stay close to behavior risk and current implementation shape.

## Links

- Related docs: [Agent guide](../../AGENTS.md), [Code standards](../code-standards.md)
