# ADR 5: Discordeno REST And Discord API Types

## Context

Snail needs Discord API infrastructure for interaction-first workflows. Runtime needs REST for command sync and interaction responses, plus gateway connectivity for receiving interaction create events.

The previous production bot used Eris, but Eris took too much control over gateway data. It could silently drop, reshape, or fail to handle newer Discord object types before Snail had a chance to inspect the raw payloads. That made it hard to adopt newer Discord interaction and component features quickly.

Snail needs Discord runtime packages that let the app stay close to Discord's API shapes. The installed Discordeno type package also does not include newer component definitions such as labels, file uploads, radio groups, and checkboxes. Snail should prefer the community Discord API type package for API shapes so payload constants and schemas stay closer to Discord's public API model.

## Decision

Snail will use `@discordeno/rest` for the REST client and `@discordeno/gateway` for gateway connectivity.

Snail will prefer `discord-api-types` for Discord API shapes, constants, and payload references when the code needs them. Do not add `@discordeno/types` by default.

Interaction create events do not require privileged intents or gateway intents, so Snail does not request gateway intents for interaction routing.

Create Discord system boundaries when there is meaningful Snail-owned Discord behavior to place there, such as REST payload normalization, command sync ownership, reusable interaction routing, or shared REST helpers.

The Discord REST wrapper owns REST manager construction. Other code should ask the wrapper for Discord REST behavior instead of accessing the REST manager directly.

## Alternatives Considered

| Alternative | Summary | Rejected Because |
| --- | --- | --- |
| Continue using Eris | Keep the previous production Discord library. | Eris took too much control over gateway data and could silently drop, reshape, or fail to handle newer Discord object types before Snail could inspect them. |
| Build gateway and REST directly | Own the gateway websocket, heartbeat, reconnect, rate-limit, REST route, and auth behavior in Snail. | This would keep Snail close to Discord payloads, but it would make the project responsible for too much fragile Discord infrastructure. |
| Lean Discord.js usage | Use Discord.js while trying to avoid its higher-level abstractions. | Discord.js still brings a larger framework and object model than Snail wants for this rewrite, and using it "leanly" would fight the library's normal shape. |

## Pros

- Uses maintained runtime packages for REST and gateway behavior without adopting a larger bot framework.
- Keeps Snail closer to Discord gateway and REST payload shapes than higher-level bot frameworks that own more transformation.
- Keeps Discord API shape imports independent from the Discordeno runtime packages.
- Does not request gateway intents for interaction handling.

## Cons

- Adds runtime dependencies before the final routing boundary exists.
- The REST wrapper and router are intentionally narrow and will need to grow with command behavior.

## Consequences

- Startup may fail clearly when Discord REST or gateway setup is missing required config.
- Command sync and gateway startup now run during `src/index.js`.
- Interaction routing currently lives in `src/systems/discord/router.js`.
- `src/systems/discord/` owns reusable Discord behavior once it exists.
- Add new Discord REST behavior to the wrapper before exposing raw REST manager access elsewhere.

## Links

- Related docs: [Architecture](../architecture.md), [Code standards](../code-standards.md)
