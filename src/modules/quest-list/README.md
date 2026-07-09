# Quest List

## Purpose

Quest List maintains the shared OwO social quest queue for the support server. It publishes a single Quest List message in a configured channel so users can see which users need Cookie, Pray, Curse, or Action quest progress, and users can add their current eligible OwO quests through Discord components.

This is a runtime module instead of a command package because it owns long-lived queue state, startup hydration, a posted Discord message, cooldown-limited channel refreshes, interval reposts, module configuration, module panel output, component/modal routes, and read-only OwO quest integration.

## Ownership

This module owns:

- The Snail-owned queued quest rows for the shared Quest List.
- Quest List channel, repost interval, empty-message, and visible-capacity settings.
- Startup load and refresh of queued quest rows.
- Publishing, editing, and reposting the shared Quest List message.
- User-facing Quest List components: Add My Quests, My Position, Visible Mentions, and Toggle Reminders.
- Staff-facing module panel controls for settings, queue management, and force repost.
- Quest List rendering and position formatting.
- Quest List logs, health state, and admin panel summary.

This module does not own:

- OwO quest creation, rerolling, locking, completion, rewards, or claim behavior.
- OwO Redis stat mutation.
- Generic module registry, command routing, component routing, modal routing, or message-builder infrastructure.
- Generic database connection setup.
- Privileged message-content parsing for OwO commands.

Delegate to:

- `systems/discord/` for Discord response helpers, Components V2 builders, component/modal routing, and channel message send/edit APIs.
- `database/` for raw Snail queue/config models and read-only OwO Mongo/Redis connections.
- OwO integration boundaries for active quest document reads and user stat reads.

## User Workflows

- Staff starts the Quest List: a manager sets the Quest List channel from the module settings panel. Until a channel is set, the module logs that it is waiting for configuration and does not post, refresh on a loop, or respond with a missing-channel failure. Once a channel is configured, the module posts the Quest List automatically on startup.
- Users add eligible quests: a user clicks `Add My Quests`; Snail reads that user's active OwO V2 quest documents, filters to unlocked incomplete Cookie, Pray, Curse, and Action quests, incrementally persists any not already queued, logs the added batch, and refreshes the shared list.
- Users check queue position: a user clicks `My Position` and receives an ephemeral summary of their queued quest progress and whether each quest is visible now or farther back in the queue.
- Users reveal visible mentions: a user clicks `Visible Mentions` and receives one ephemeral line of unique mentions for currently visible users.
- Users toggle reminders: a user clicks `Toggle Reminders` and receives an ephemeral work-in-progress response until reminder behavior is implemented.
- Queue auto-refreshes: after a channel is configured, startup, successful Add My Quests, force repost, and cooldown-limited Quest List channel messages rehydrate queued quest rows from OwO Mongo and Redis, remove stale, locked, completed, replaced, or unsupported quests, and update the shared message.
- Queue reposts: each non-list message in the Quest List channel increments the repost counter, including bot messages. When the configured interval is reached, Snail refreshes quest data and posts a fresh Quest List message so it stays recent in chat history.
- Staff manages settings: a manager uses module panel controls to update the Quest List channel, visible limits per quest type, repost interval, or empty message.
- Staff manages the queue: a manager uses the module panel to remove selected users from a quest type, or clears the selected type by leaving users empty, optionally notifying affected users in the Quest List channel.
- Staff force-reposts: a manager uses the module panel Force Repost control to refresh quest data and post a fresh Quest List message.

## Commands and Interactions

Quest List owns component and modal routes registered through the module registry. The shared `/module` command owns the manager-facing module panel surface.

| Route | Audience | Purpose | Notes |
| --- | --- | --- | --- |
| `quest_list:add_quests` | users | Add the caller's active eligible OwO quests. | Reads OwO Mongo/Redis, persists new Snail queue rows, responds ephemerally, and updates the shared message only when something was added. |
| `quest_list:my_position` | users | Show the caller's current queue positions. | Ephemeral response. |
| `quest_list:visible_mentions` | users | Show mentionable users currently visible on the list. | Ephemeral response with `allowed_mentions` protection where applicable. |
| `quest_list:toggle_reminders` | users | Placeholder for reminder opt-in/out. | Ephemeral work-in-progress response until reminders are implemented. |
| `quest_list:channel_select` | managers | Save Quest List channel from a Discord channel select. | Filters to text channels. |
| `quest_list:edit_capacity` | managers | Open visible-limit settings modal from the module panel. | Positive integers for each supported quest type. |
| `quest_list:edit_repost_interval` | managers | Open repost interval settings modal from the module panel. | Positive integer. |
| `quest_list:edit_empty_message` | managers | Open empty-message settings modal from the module panel. | Non-empty string. |
| `quest_list:manage_queue` | managers | Open queue management modal. | Supports clear-list and remove-users flows. |
| `quest_list:force_repost` | managers | Refresh and repost the shared message. | Requires a configured channel. |
| `quest_list:capacity_modal` | managers | Save visible limits. | Positive integer for Cookie, Pray, Curse, and Action. |
| `quest_list:repost_interval_modal` | managers | Save message interval for reposting. | Positive integer. |
| `quest_list:empty_message_modal` | managers | Save empty-list text. | Non-empty string. |
| `quest_list:manage_queue_modal` | managers | Remove or clear queued quests. | Selected users are removed; no selected users clears the selected type. Can notify affected users. |

Supported quest types:

| OwO quest type | Display name | Default visible capacity |
| --- | --- | --- |
| `cookieBy` | Cookie | 5 |
| `prayBy` | Pray | 10 |
| `curseBy` | Curse | 10 |
| `emoteBy` | Action | 5 |

Battle quests are intentionally unsupported in the first implementation. `friendlyBattle` can be reconsidered later, but should not be included without an explicit product decision.

Long-running interactions that perform OwO reads or persistence writes must `defer()` and finish with `editReply()`. Fast validation failures may respond immediately.

## State and Persistence

- Snail state: queued quest rows, Quest List channel ID, repost interval, visible capacity per supported quest type, empty message, module enabled/log-level settings, message count since last repost, and message refresh cooldown state.
- Runtime-only state: current Quest List message ID. This is not persisted; on bot restart, a configured Quest List channel receives a fresh list message.
- OwO reads: active V2 `UserQuest` Mongo documents and Redis lifetime stat hashes at `user_stats:{userId}`.
- OwO writes through named services: none. Quest List must never mutate OwO quest docs, Redis stats, rewards, or claim state.
- External services: Discord for interaction responses and posting/editing the shared Quest List message.
- Cache/invalidation: in-memory indexes may be rebuilt from the queue after each load, refresh, add, or removal. Persistence remains authoritative. Queue persistence should use incremental inserts and deletes instead of replacing the whole collection during normal operation.

Snail queued quest rows should persist:

- `userID`
- `questID`, as `String(UserQuest._id)`
- `questType`
- `startValue`
- `targetValue`
- `addedAt`

`questType`, `startValue`, and `targetValue` are a fingerprint. If an OwO quest document with the same `_id` changes these fields, treat the queued row as stale and remove it during refresh.

Runtime display rows should derive:

- `userID`
- `questID`
- `questType`
- `count`, calculated from Redis as `clamp(currentValue - startValue, 0, targetCount)`
- `total`, from OwO `targetCount`
- `addedAt`, from Snail queue state

The renderer does not need OwO `tier`, `slotIndex`, `statKey`, `startValue`, `targetValue`, `locked`, or timestamps from the OwO document. Those fields may be used during hydration and filtering, but should be dropped before rendering unless a later display requirement uses them.

Refresh must remove queued rows when:

- the OwO quest document no longer exists
- the quest type is unsupported
- the quest is locked
- the quest fingerprint no longer matches
- Redis-derived progress is complete, meaning `currentValue >= targetValue`

Refresh removals must be logged as a batch with one removal entry per quest. Each entry should include the queued quest identity and one of these reasons:

- `owo_missing`
- `unsupported_type`
- `locked`
- `fingerprint_mismatch`
- `completed`

Expected data boundaries:

- `database/` owns raw connection groups, models, clients, and shared config helpers.
- The Quest List module owns module-local data access for queued quests, OwO quest reads, and Redis stat reads.
- The Quest List module owns queue rules, refresh rules, ordering, position calculations, and rendered output.

## Authorization

- User actions: any guild user may click Add My Quests, My Position, Visible Mentions, and Toggle Reminders.
- Staff actions: settings, queue management, and force repost require configured manager-level roles.
- Owner/admin actions: the configured owner user may use staff controls even without a staff role.
- Auth edge cases: component and modal handlers must re-check authorization on every interaction. A rendered module panel component is not proof of permission.

If role or owner authorization requires new config in this repo, update `docs/configuration.md`, `src/config/config.js`, and tests in the same implementation change.

## Admin Panel

Quest List exposes module panel state through the shared `/module` command.

- `state()`: includes channel ID, message ID, repost interval, messages since repost, capacity, empty message, supported quest types, queued quest count, queued user count, quests by type, and current hydrated quests.
- `panelPages()`: contributes Quest List feature pages to the shared module panel.
  - Overview: current Quest List message link, force repost, queue management, queued quest count, and messages since repost.
  - Settings: editable Visible Limits, Repost Interval, and Empty Message controls.
  - Channel: current post channel and a channel select.
- Queue management modals should prefer Discord-native selects. User removal uses a user select instead of parsing mentions or raw IDs; leaving users empty clears the selected type or all types.
- Structured logs: log quests loaded, quests added, quests removed with per-quest reasons, quests refreshed, list published, and config updated.
- Shared module admin actions: persisted enable/disable, recent log viewing, state export, log level, and log usage display on the Runtime page.
- Module-specific admin actions: settings modal submissions, manage queue modal submission, and force repost.

## Rendering and Responses

The shared Quest List message should use Components V2 by default.

The message content should include:

- Heading: `Quest List`
- Help text telling users to use the buttons to add current Cookie, Pray, Curse, and Action quests.
- A note that Battle quests are unsupported.
- A note that locking an OwO quest removes it from the list.
- One section per quest type that has queued users.
- For each quest type, show `visibleCount/totalQueuedUsers`.
- For each visible user, show padded progress like ``03/10`` and the user mention.
- If a user has multiple queued quests of the same type, show them as separate entries instead of combining progress with `+`.
- The configured empty message when no quests are queued.
- Buttons inside the Quest List container after a separator: Add My Quests, My Position, Visible Mentions, Toggle Reminders.
- `allowed_mentions: { parse: [] }` on rendered Quest List messages so the list does not ping users while publishing or editing.

User responses should be ephemeral for Add My Quests, My Position, validation failures, permission failures, and settings confirmations. Queue removal notifications may be public in the Quest List channel when staff explicitly choose to notify affected users.

Renderers should receive prepared display state. They should not query databases or calculate queue rules.

## Gateway Events

The module handles `ready` and `message`.

- On `ready`, if no channel is configured, log the unconfigured state and do nothing else.
- On `ready`, if a channel is configured, post a fresh Quest List message after loading and refreshing queued quests.
- On `message`, if the message is in the Quest List channel and is not authored by Snail, increment the repost counter.
- Non-Snail messages refresh immediately and start a 500ms refresh cooldown.
- Additional non-Snail messages during the 500ms cooldown queue one trailing refresh to run when the cooldown ends, so a burst that suddenly stops still gets a final update.
- Bot messages from other bots count toward the repost interval and trigger refresh edits.
- If the repost counter reaches the configured interval, cancel any pending refresh cooldown, refresh quest data, post a fresh Quest List message, store its ID in runtime state, and reset the repost counter.

The first implementation must not depend on message content. Reference code explicitly leaves content-based OwO quest completion triggers disabled unless privileged message content is intentionally restored later.

## Failure Modes

- Missing channel: this is the expected fresh-install state. The module logs that no Quest List channel is configured and otherwise does nothing until staff set the channel from the module settings panel.
- Disabled module: event handlers and normal Quest List work do not run. User/runtime actions from stale Quest List buttons, selects, or modals should respond with the disabled reason, but manager-owned settings controls remain usable. Disabling clears any pending refresh cooldown; enabling refreshes and reposts the list when a channel is configured.
- Missing user ID: user component actions respond ephemerally that the user could not be identified.
- Snail persistence unavailable: Snail Mongo is a required global startup dependency because module settings and enablement depend on it. If Snail Mongo is unavailable, the bot should fail startup before Quest List is created.
- OwO Mongo unavailable: Quest List requires OwO quest reads. If OwO Mongo is unavailable, the bot should fail startup before Quest List is created.
- OwO Redis unavailable: Quest List requires OwO progress reads. If OwO Redis is unavailable, the bot should fail startup before Quest List is created.
- Discord send/edit failure: if editing the current runtime message fails, attempt to send a new message and keep the new message ID in runtime state. Other Discord failures should be logged and surfaced to the interaction when possible.
- Partial update: do not report queue additions, removals, or settings changes as complete until Snail persistence succeeds.
- No-op Add My Quests: if the user has no eligible new quests, respond ephemerally and do not refresh, edit, or repost the shared Quest List message.
- Stale queued quest: remove it only during a successful refresh and persist the updated queue.
- Empty queue: publish the configured empty message.

## Required Supporting Work

Implementing Quest List requires these supporting pieces:

- A module base/registry that supports initialization, enabled state, logs, events, module-owned commands, components, modals, `state()`, and `panelPages()`.
- Interaction routing for application commands, message components, and modal submissions.
- Modal value extraction, including text inputs, string selects, channel selects, user selects, and checkboxes.
- Discord REST wrapper methods for `defer`, `editReply`, `edit`, `openModal`, `sendMessage`, and `editMessage`.
- Components V2 helper builders for text displays, containers, action rows, buttons, selects, labels, text inputs, checkboxes, ephemeral messages, and `allowed_mentions`.
- Staff auth helpers matching manager-level access.
- Snail config persistence for Quest List settings.
- Module-local Quest List data access for queued quest rows.
- Module-local read-only OwO Mongo `UserQuest` access.
- Module-local OwO Redis `HMGET` access for `user_stats:{userId}` fields.
- A module panel command/workflow if staff settings are managed through the shared module panel.

Any support code added under `systems/` must stay generic and should not contain Quest List policy.

## Test Plan

- Unit: supported quest filtering, fingerprint stale detection, Redis progress calculation, completed/locked removal rules, queue indexing by type and user, visible-capacity slicing, position formatting, modal parsing, positive-integer validation, and remove/clear queue rules.
- Integration: module startup load/refresh, Add My Quests with mocked OwO Mongo/Redis, save-and-publish flow, edit-failure fallback to repost, settings modal persistence, manage queue with optional notify, cooldown-limited message-triggered editing, and interval reposting.
- Manual: start with no configured Quest List channel and verify the module only logs and does not post; configure a debug Quest List channel through the module panel; restart and verify a fresh list posts automatically; add quests through the button; verify visible mentions and my position; post several normal messages below the repost interval and verify the list refreshes immediately, then queues one trailing refresh during the 500ms cooldown; verify bot messages count toward repost; reach the repost interval and verify a fresh list message is posted; update visible limits; change repost interval; change empty message; force repost; remove users; clear a type by submitting the manage queue modal with no users selected; and confirm non-staff actions are denied while the owner override works.
- Regression: `/snail` still routes, command sync still includes all registered commands, config tests pass, and the bot still starts without privileged message content.

Verification commands expected after implementation:

- `npm run check`
- `npm test`

## Open Questions

- None.

## ADR Links

- [ADR 1: Interaction-first bot architecture](../../../docs/adr/0001-interaction-first-bot-architecture.md)
- [ADR 3: Vitest test runner](../../../docs/adr/0003-vitest-test-runner.md)
- [ADR 5: Discordeno REST and API types](../../../docs/adr/0005-discordeno-rest-and-api-types.md)
- [ADR 6: Authoritative guild command sync](../../../docs/adr/0006-authoritative-guild-command-sync.md)
- [ADR 7: Biome formatting and checking](../../../docs/adr/0007-biome-formatting-and-checking.md)
