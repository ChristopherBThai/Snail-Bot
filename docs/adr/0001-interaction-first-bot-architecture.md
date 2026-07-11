# ADR 1: Interaction-First Bot Architecture

## Context

Snail is already a Discord utility bot for OwO Bot Support workflows. Historically, parts of the bot could rely on message-content access and prefix-command behavior without forcing a major architecture decision.

Discord has changed privileged-intent access review. Apps that can access 10,000 or more users now need review for Privileged Intents, and apps with approved access must reapply annually. Discord specifically identifies application commands as an alternative for bots that previously used prefix commands to read message content.

Snail's normal operation should not require the Message Content intent and should not need a privileged-intent application for prefix-command behavior. Snail should preserve its utility role while using Discord-native interactions: application commands, context commands, buttons, selects, and modals.

## Decision

Snail will use interaction-first Discord UX by default: application commands, context commands, components, and modals.

Prefix commands are not part of the architecture because they require message-content access for normal command handling.

New features must not depend on privileged message content unless the maintainer explicitly approves the tradeoff and documents why the feature cannot reasonably be built with Discord interaction APIs.

## Alternatives Considered

| Alternative | Summary | Rejected Because |
| --- | --- | --- |
| Prefix-first commands | Keep command behavior centered on message content. | This keeps Snail dependent on the Message Content intent for normal command handling and fails the privileged-intent reduction goal. |
| Mixed prefix and interaction command surface | Support both prefix commands and application commands for most features. | This preserves the message-content dependency, doubles the command surface, increases review burden, and makes behavior drift more likely. |

## Pros

- Reduces annual privileged-intent review exposure for features that do not truly need privileged data.
- Gives commands and components structured Discord inputs instead of hand-parsed message text.
- Makes permissions, command options, and user prompts more visible in Discord's native UI.
- Encourages feature flows that can be reviewed at the command, component, and modal boundary.
- Keeps new workflows aligned with Discord's current app platform direction.

## Cons

- Existing behavior has to be redesigned around interactions instead of copied directly from prefix-command flows.
- Some workflows will take more implementation effort because interaction state, components, modals, and follow-up responses have stricter rules than plain messages.
- Users may hesitate to adopt interaction-based workflows if they are used to faster or more familiar prefix commands.
- Command definition changes have to be reviewed carefully because startup sync can change visible commands in Discord.
- Features that genuinely require privileged intents need explicit exception handling and documentation.

## Consequences

- Commands and interaction handlers should stay thin and delegate to owning modules, command packages, or systems.
- Features that need privileged message content require maintainer approval and documentation.
- Command sync remains production-sensitive.
- Prefix-command behavior should not be reintroduced casually.
- Reviews should treat message-content access as a production-sensitive privacy and compliance concern.

## Links

- Related docs: [Agent guide](../../AGENTS.md), [Architecture](../architecture.md), [Code standards](../code-standards.md)
- Discord: [Changes to Privileged Intent Access for Discord Apps](https://support-dev.discord.com/hc/en-us/articles/40281523410967-Changes-to-Privileged-Intent-Access-for-Discord-Apps)
