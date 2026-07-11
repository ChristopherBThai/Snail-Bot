# ADR 6: Authoritative Guild Command Sync

## Context

Snail is interaction-first, so application command definitions are part of the runtime contract. Discord command state should match the code that is running, including periods where the command list is intentionally empty.

Snail should not preserve unknown Discord command state just because it already exists in Discord. Stale commands are user-visible behavior, and keeping them registered after the code stops owning them creates drift between Discord and the deployed source.

## Decision

Snail will sync guild application commands on startup using the command list defined by the running code.

The sync is authoritative. If the running code provides an empty guild command list, Snail should sync that empty list and remove registered guild commands for the configured guild.

Normal commands are guild commands. Global commands must opt in explicitly on the route that owns the command.

## Alternatives Considered

| Alternative | Summary | Rejected Because |
| --- | --- | --- |
| Skip command sync while the list is empty | Avoid deleting existing Discord commands until new commands exist. | This preserves command state that the current code no longer owns and makes Discord diverge from the running source. |
| Add a generic command scope config | Configure whether command sync is guild or global. | Normal commands are guild commands, and global commands should opt in on the owning command route instead of broad runtime mode switches. |
| Manual command sync only | Require a separate command or deployment step to sync definitions. | This makes command state easier to forget and allows Discord to drift from the deployed code. |

## Pros

- Keeps Discord command state aligned with the running code.
- Makes stale command removal intentional instead of accidental or manual.
- Keeps the normal command path guild-scoped while allowing route-owned global command opt-in.

## Cons

- Startup can remove commands if the command list is empty or wrong.
- Command definition mistakes become visible in Discord during startup.
- Production startup needs careful review whenever command definitions change.

## Consequences

- `discord.applicationId`, `discord.guildId`, and `BOT_TOKEN` are required before command sync can run.
- The command list must be treated as production-visible behavior.
- Empty command sync is allowed and meaningful.

## Links

- Related docs: [Architecture](../architecture.md), [Configuration](../configuration.md)
