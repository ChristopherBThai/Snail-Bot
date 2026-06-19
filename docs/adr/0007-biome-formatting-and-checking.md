# ADR 7: Biome Formatting And Checking

## Context

Snail needs a standard formatter and checker so code style does not depend on individual editor defaults. The project also needs a single command that contributors and agents can run before handoff.

## Decision

Snail will use Biome for formatting and lint checking.

`npm run check` runs `biome check .`.

`npm run check:fix`, `npm run format`, and `npm run format:fix` expose the write and format-only workflows.

## Alternatives Considered

| Alternative | Summary | Rejected Because |
| --- | --- | --- |
| ESLint and Prettier | Use separate tools for linting and formatting. | This is a larger tooling setup than Snail currently needs, and it creates more configuration surface for formatter/linter disagreements. |
| Prettier only | Use a formatter without lint checks. | Snail needs a checker command that can catch basic code issues in addition to formatting drift. |
| No configured formatter | Let editor defaults or contributor preferences decide formatting. | This causes noisy diffs and inconsistent review feedback. |

## Pros

- Gives contributors and agents one standard check command.
- Keeps formatter behavior aligned between the CLI and editors that read `biome.json`.
- Reduces style-only review churn.

## Cons

- Adds a development dependency.
- Some formatter decisions may require small code rewrites instead of local style overrides.

## Consequences

- Use `npm run check` before handoff for JavaScript and documentation changes.
- Use `npm run check:fix` or format scripts for mechanical formatting fixes.
- Do not fight Biome output unless there is a strong readability or correctness reason.

## Links

- Related docs: [Code standards](../code-standards.md), [Development expectations](../development-workflow.md)
