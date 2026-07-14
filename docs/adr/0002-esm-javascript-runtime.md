# ADR 2: ESM JavaScript Runtime

## Context

Snail needs one JavaScript module system for runtime code, tests, and tooling. Native ESM works with the current Node runtime, package tooling, and Discord runtime packages.

Snail should preserve that baseline unless there is a strong reason to change it. Switching module systems would add churn without solving a current problem.

## Decision

Snail will use native ESM JavaScript, with `"type": "module"` in `package.json`.

Snail will not adopt TypeScript at this time. TypeScript would add a larger developer, build, and production deployment change than the project currently needs. A future switch would require a very compelling reason and a separate ADR.

## Alternatives Considered

| Alternative | Summary | Rejected Because |
| --- | --- | --- |
| CommonJS | Use `require` and `module.exports`. | CommonJS would add compatibility churn around the current Node and Discord package direction without solving a current problem. |
| TypeScript | Add a compile/typecheck step and write source in TypeScript. | This is too large a developer, build, and production setup change. There is no current need strong enough to justify adding a compile step and changing how Snail is built or deployed. |

## Pros

- Uses the current Node module standard.
- Keeps the project free of a build step.
- Lets source, tests, and tooling run directly under Node.
- Matches the module style used by the current runtime packages.

## Cons

- No static type checking by default.
- Some older libraries or examples may require CommonJS interop.
- A future TypeScript adoption would be larger once more JavaScript exists.
- Runtime-only errors that TypeScript could catch need to be managed through focused tests, review, and clear boundaries.

## Consequences

- Source files should use `import` and `export`.
- Tooling and tests should run directly against source files without a compile step.
- Avoid TypeScript-only patterns, generated type layers, or build tooling unless a later ADR changes this decision.

## Links

- Related docs: [Code standards](../code-standards.md)
