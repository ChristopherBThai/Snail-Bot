# ADR 2: ESM JavaScript Runtime

## Context

Snail needs one JavaScript module system for runtime code, tests, and tooling. The reference implementation already used native ESM with `"type": "module"` and imported Discordeno standalone packages with ESM syntax.

The rewrite should preserve that baseline unless there is a strong reason to change it. Switching module systems during the rewrite would add churn without solving a current problem.

## Decision

Snail will use native ESM JavaScript, with `"type": "module"` in `package.json`.

Snail will not adopt TypeScript for this rewrite. TypeScript would add a larger developer, build, and production deployment change than the project currently needs. A future switch would require a very compelling reason and a separate ADR.

## Alternatives Considered

| Alternative | Summary | Rejected Because |
| --- | --- | --- |
| CommonJS | Use `require` and `module.exports`. | The reference implementation already moved to ESM and imported Discordeno standalone packages with ESM syntax. Returning to CommonJS would add compatibility churn around the Discord library direction and the existing reference code. |
| TypeScript | Add a compile/typecheck step and write source in TypeScript. | This is too large a developer, build, and production setup change for the rewrite. There is no current need strong enough to justify adding a compile step and changing how Snail is built or deployed. |

## Pros

- Uses the current Node module standard.
- Keeps the rewrite free of a build step.
- Lets source, tests, and tooling run directly under Node.
- Matches the module style already used by the reference implementation.

## Cons

- No static type checking by default.
- Some older libraries or examples may require CommonJS interop.
- A future TypeScript migration would be larger once more JavaScript exists.
- Runtime-only errors that TypeScript could catch need to be managed through focused tests, review, and clear boundaries.

## Consequences

- Source files should use `import` and `export`.
- Tooling and tests should run directly against source files without a compile step.
- Avoid TypeScript-only patterns, generated type layers, or build tooling unless a later ADR changes this decision.

## Links

- Related docs: [Code standards](../code-standards.md)
