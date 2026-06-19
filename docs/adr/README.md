# Architecture Decision Records

ADRs explain major architecture choices in Snail. They are for decisions with lasting consequences, meaningful alternatives, or tradeoffs future maintainers need to understand.

Use [`template.md`](template.md) for new ADRs.

## When To Create An ADR

Create an ADR when a decision:

- changes project structure or ownership boundaries
- chooses a major library, framework, database, or service
- creates a lasting integration pattern
- changes how commands, modules, interactions, config, or persistence work
- accepts a meaningful tradeoff

Do not create ADRs for routine feature work, small refactors, obvious bug fixes, or local implementation details already explained by nearby code and docs.

## Naming

Use zero-padded numeric names:

```text
0001-interaction-first-bot-architecture.md
0002-discordeno-standalone-runtime-and-adapter.md
```

Keep accepted ADRs immutable except for small clarifications. If a decision changes, create a new ADR that supersedes the old one.
