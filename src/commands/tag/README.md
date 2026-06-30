# Tags

## Purpose

Tags let staff maintain reusable OwO support answers and let users request those answers through application commands. Tags are short named messages that can be sent ephemerally by default, made public in selected channels, and edited through the shared Message Builder when plain text is not enough.

This is a command package instead of a runtime module because Tags does not need gateway event handling, lifecycle hooks, module panels, or long-lived runtime state. It owns command-invoked CRUD and read behavior; reusable draft editing belongs to `systems/message-builder/`.

## Ownership

This command package owns:

- The `/tag` user command for viewing and listing tags.
- The `/tag-manage` staff command for creating, editing, deleting, and configuring public tag behavior.
- Tag name validation, autocomplete, and cache invalidation.
- Tag response policy for ephemeral vs public sends.
- Command-package-local persistence access for Snail `Tag` and `Channel` records.
- Saving Message Builder drafts into tag records.

This command package does not own:

- Generic message composition UI, draft mutation, or Components V2 block rendering.
- Global command registration mechanics outside the command package export shape.
- Runtime module enablement, logs, or module panels.
- Knowledge Base indexing or retrieval.
- OwO database reads or writes.

Delegate to:

- `systems/message-builder/` for reusable message draft creation, editing, rendering, hydration, and submit routing.
- `systems/discord/` for Discord response helpers, Components V2 helpers, component/modal routing, and REST calls.
- `database/snail/` for raw `Tag` and `Channel` models.
- `utils.js` for shared command option parsing and staff authorization helpers.

## User Workflows

- Get a tag: a user runs `/tag get name:<tag>` and receives the rendered tag. The response is ephemeral unless the tag is public in the current channel or the current channel is configured to make all tags public by default.
- List tags: a user runs `/tag list` and receives an ephemeral list of available tag names.
- Create a plain-text tag: a manager runs `/tag-manage create name:<tag> message:<text>` and Snail stores the tag immediately as a Components V2 text display.
- Create a rich tag: a manager runs `/tag-manage create name:<tag>` without a message and Snail opens the Message Builder. Saving the builder creates the tag.
- Edit a tag: a manager runs `/tag-manage edit name:<tag>` with optional replacement text. Without replacement text, Snail opens the Message Builder with the existing editable blocks.
- Delete a tag: a manager runs `/tag-manage delete name:<tag>` and Snail removes the tag.
- Configure public channels: a manager runs `/tag-manage public` with `public:true` or `public:false` for a specific tag and channel. Omitting the channel uses the current channel. Using `name:all` controls whether all tags are public by default in that channel.
- Inspect public channels: a manager runs `/tag-manage public-list` to see where a tag is public, or uses `name:all` to list the current channel default plus tag-specific public settings in the current channel.

## Commands and Interactions

| Route | Audience | Purpose | Notes |
| --- | --- | --- | --- |
| `/tag get` | users | Send one tag. | Autocompletes tag names. Public only when channel policy allows it; otherwise ephemeral. |
| `/tag list` | users | List tag names. | Ephemeral response. |
| `/tag-manage create` | managers | Create a tag from text or open Message Builder. | `staff: true`, runtime `auth.manager`. |
| `/tag-manage edit` | managers | Replace tag text or open Message Builder for rich editing. | `staff: true`, runtime `auth.manager`. |
| `/tag-manage delete` | managers | Delete a tag. | `staff: true`, runtime `auth.manager`. |
| `/tag-manage public` | managers | Set whether a tag is public in a selected channel, or set channel default with `all`. | `staff: true`, runtime `auth.manager`. |
| `/tag-manage public-list` | managers | Inspect public channel policy. | `staff: true`, runtime `auth.manager`. |
| `message_builder:*` components and modals | managers | Build and submit rich tag content. | Shared global routes owned by `systems/message-builder/`; Tags supplies submit behavior when opening a builder session. |

Tag names must match lowercase ASCII letters and digits only: `^[a-z0-9]+$`. The reserved value `all` is allowed only for public-channel management subcommands.

Autocomplete returns up to 25 matching tag names from an in-memory cache. The cache loads from the database once and create/delete flows update it after persistence succeeds.

Long-running commands that perform several persistence operations or open a builder may respond normally when fast. If a future implementation adds slow reads or external calls, those commands must `defer()` and finish with `editReply()`.

## State and Persistence

- Snail state: tag records and channel records.
- OwO reads: none.
- OwO writes through named services: none.
- External services: Discord only.
- Cache/invalidation: tag-name autocomplete uses an in-memory cache. The cache loads from the database once and create/delete updates it after persistence succeeds.

`Tag` records should persist:

- `_id`: tag name.
- `blocks`: Message Builder block array used to render the tag.
- `publicChannelIDs`: channel IDs where this tag is sent publicly.
- `createdBy`: Discord user ID that created the tag.
- `updatedBy`: Discord user ID that last changed the tag.
- timestamps.

Legacy `data` text from reference code is read-only compatibility state. New create/edit flows must write `blocks`, not `data`. When an existing tag has no `blocks` but has `data`, render `data` as a single text-display block. No legacy JSON embed decoding is required.

`Channel` records should persist:

- `_id`: Discord channel ID.
- `tagsPublicByDefault`: whether all tags are public by default in that channel.
- timestamps.

The Tags command package owns tag-specific rules such as name validation, public-channel policy, and save semantics. The database layer owns only schema/model registration and persistence mechanics.

## Authorization

- User actions: any guild user may run `/tag get` and `/tag list`.
- Staff actions: `/tag-manage` and all Message Builder sessions opened by tag management require manager access.
- Owner/admin actions: owner/admin access is inherited through `auth.manager`.
- Auth edge cases: Tags supplies manager auth when opening Message Builder. Message Builder re-checks that auth on the active session. A stale builder panel is not proof of permission. Builder sessions are scoped to the initiating user.

## Rendering and Responses

Tags should render as Components V2 messages using Message Builder blocks.

Plain text create/edit should be converted into a single text block. Rich create/edit should use the Message Builder and submit the resulting block array. Renderers receive stored blocks and compile them; they should not query the database.

`/tag get` responses:

- Public when the tag's `publicChannelIDs` includes the current channel.
- Public when the current channel record has `tagsPublicByDefault: true`.
- Ephemeral otherwise.

User-facing validation errors and all `/tag-manage` confirmations should be ephemeral. Public tag sends must use conservative mention handling unless a future product decision intentionally allows tags to ping.

All tag renders, including public tag renders, must suppress mentions by default with `allowed_mentions: { parse: [] }`. This protects channels where any user can invoke a public tag that contains a mention. If a valid mention use case appears later, add an explicit tag-level exception instead of changing the default.

## Failure Modes

- Missing config: Snail startup owns config validation before commands are created.
- Database unavailable: Snail Mongo is already a required startup dependency. Tag commands should surface a generic interaction failure if persistence fails.
- External service unavailable: not applicable.
- Discord API failure: failed responses should use the shared router error path. Builder submit failures must not report success unless persistence and the intended Discord operation both succeed.
- Partial update: public-channel config changes and tag mutations should be single-record operations where possible. Do not update in-memory caches until persistence succeeds.
- Invalid tag name: respond ephemerally with the valid name rule.
- Missing tag: respond ephemerally that the tag does not exist.
- Duplicate create: respond ephemerally that the tag already exists.
- Stale builder session: respond ephemerally that the builder session expired.

## Test Plan

- Unit: tag name validation, reserved `all` handling, autocomplete filtering/limit/cache invalidation, public-vs-ephemeral policy, plain-text-to-block conversion, save create/edit results, and public-channel list formatting.
- Integration: `/tag get`, `/tag list`, `/tag-manage create/edit/delete`, public add/remove/list, Message Builder submit into a tag, and auth failures for non-managers.
- Manual: create a plain-text tag; fetch it in a normal channel and verify ephemeral; mark that tag public in a channel and verify public send; set channel default with `all`; create/edit a rich tag through Message Builder; delete a tag; verify autocomplete updates.
- Regression: `/snail`, `/module`, Quest List interactions, command sync, `npm run check`, and `npm test`.

## Open Questions

None.

## ADR Links

- [ADR 1: Interaction-first bot architecture](../../../docs/adr/0001-interaction-first-bot-architecture.md)
- [ADR 3: Vitest test runner](../../../docs/adr/0003-vitest-test-runner.md)
- [ADR 5: Discordeno REST and API types](../../../docs/adr/0005-discordeno-rest-and-api-types.md)
- [ADR 6: Authoritative guild command sync](../../../docs/adr/0006-authoritative-guild-command-sync.md)
- [ADR 7: Biome formatting and checking](../../../docs/adr/0007-biome-formatting-and-checking.md)
