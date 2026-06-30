# Message Builder

## Purpose

Message Builder is shared Discord infrastructure for composing, previewing, hydrating, persisting, and submitting Components V2 messages through Discord components and modals. It lets staff build richer Snail-authored messages without each command file or package inventing its own draft UI.

This is a system instead of a command file, command package, or runtime module because it is reusable infrastructure. It does not own a user-facing product by itself; command files, command packages, and modules provide labels, authorization, validators, and submit behavior when they open a builder session.

## Ownership

This system owns:

- The Message Builder draft model and block operations.
- Components V2 block compilation from prepared draft blocks.
- Loading existing stored blocks back into editable drafts.
- Builder panel rendering, block selection, action selection, modal construction, and the single shared route set.
- Shared submit validation helpers for command files, command packages, or modules that open builder sessions.
- Per-user current draft persistence, active-session ownership, stale-session responses, and session-owned submit dispatch.
- URL-based link and image block rendering.
- Input normalization for builder-specific URLs, colors, booleans, and modal values.

This system does not own:

- Tag names, tag persistence rules, or tag public-channel policy.
- Command definitions such as `/tag-manage`.
- Runtime module lifecycle, logs, or module panels.
- Database schemas for features that save builder output.
- Discord REST transport beyond calls exposed by the interaction context.

Delegate to:

- Command packages or modules for feature-specific submit behavior.
- `systems/discord/` for primitive Components V2 builders, interaction responses, modal opening, and message sends/edits.
- Owning features for authorization. Message Builder sessions should still be scoped to the initiating user.

## User Workflows

- Continue current draft: an owning command opens Message Builder and, when allowed by that context, resumes the user's persisted current draft from Snail Mongo.
- Start a new draft: an owning command opens Message Builder with an empty block list and replaces the user's current draft.
- Edit existing content: an owning command opens Message Builder with stored tag blocks and replaces the current draft when the context requires editing content as it exists now.
- Select a block: the user chooses the message root or one editable block from a select menu.
- Add blocks: the user adds text, separators, link-button rows, containers, sections, and image galleries.
- Edit blocks: the user edits supported selected blocks through modals.
- Move or delete blocks: the user reorders or removes the selected block where valid.
- Submit: the user submits the rendered draft to the owning feature. The owning feature performs persistence or Discord send/edit work.
- Clear: the user clears draft blocks through the action flow.

Only one active builder interface may exist per user. Opening a second builder deactivates the previous interface. If the new context allows resuming, the previous current draft is carried into the new context. If the new context is an edit flow, the edit source wins and replaces the current draft so staff do not accidentally edit stale blocks into an existing tag or message.

## Routes and Interactions

Message Builder routes are registered once by the runtime composition root and shared by every command file, command package, or module that opens a builder session. The route IDs use a stable `message_builder:` prefix in this repo.

| Route | Audience | Purpose | Notes |
| --- | --- | --- | --- |
| `message_builder:select_block` | owning feature's authorized users | Select root or a block. | Component route. |
| `message_builder:action` | owning feature's authorized users | Add, edit, move, delete, clear, or submit. | Component route. |
| `message_builder:text_modal` | owning feature's authorized users | Add text. | Modal route. |
| `message_builder:edit_text_modal` | owning feature's authorized users | Edit selected text. | Modal route. |
| `message_builder:link_modal` | owning feature's authorized users | Add a link-button row. | Modal route. |
| `message_builder:section_modal` | owning feature's authorized users | Add a section with text and thumbnail. | Modal route. |
| `message_builder:edit_section_modal` | owning feature's authorized users | Edit selected section. | Modal route. |
| `message_builder:media_gallery_modal` | owning feature's authorized users | Add an image URL to an image gallery. | Modal route. |
| `message_builder:edit_container_modal` | owning feature's authorized users | Edit container accent/spoiler options. | Modal route. |

Builder sessions should be keyed by initiating user ID and a monotonically changing session ID. A user has one active builder session at a time. Component custom IDs should include enough session identity to make older panels read-only or expired, while still allowing the user's persisted current draft to carry into the newly opened builder.

## Block Model

Supported blocks:

| Kind | Rendered Component | Editable Notes |
| --- | --- | --- |
| `text` | Text Display | Content up to Discord's practical text-display limit. |
| `separator` | Separator | Not editable; can be moved/deleted. |
| `link_buttons` | Action Row with link buttons | Up to 5 link buttons per row. |
| `container` | Container | May contain child blocks; supports accent color and spoiler where Discord supports it. |
| `section` | Section with Thumbnail accessory | 1-3 text displays plus thumbnail URL. |
| `media_gallery` | Image Gallery | Up to 10 external image URLs. |

Drafts should track:

- `ownerID`
- `blocks`
- `selectedBlockPath`
- `updatedAt`
- `sessionID`
- `source`

Limits:

- Maximum rendered Components V2 components: 35.
- Maximum selectable/editable blocks: 24.
- Maximum link buttons per row: 5.
- Maximum media gallery items: 10.
- Maximum section text displays: 3.

The model should validate limits before mutating drafts where possible. Operations should return named results rather than throwing for expected UI failures such as stale selection, full rows, or component limits.

Link and image blocks are URL-only. Managers should provide durable `http` or `https` URLs for link buttons, image gallery items, and section thumbnails. The builder does not download, copy, or store file bytes.

## Current Drafts and Templates

Message Builder should persist a current draft for each user in Snail Mongo. The current draft is the user's workspace, survives process restarts, and is reused when a builder context allows resuming.

Opening behavior:

- `resume`: use the user's persisted current draft when it exists; otherwise start empty.
- `replace_from_blocks`: replace the current draft from stored blocks.

Tag edits use replacement mode because the user is editing a specific existing tag. New tag creation resumes the current draft when it starts from an empty block list.

## Submit Behavior

Message Builder exposes a `start(context, options)` entry point plus `routes.components` and `routes.modals`. The runtime registers those routes once, and feature owners call `start()` with session-specific behavior:

- `label`: displayed in the panel header.
- `submitLabel`: displayed as the final action label.
- `auth` or `authorize`: rechecked by every component and modal route before mutation or submit.
- `validators`: shared or feature-specific validators that must pass before submit.
- `submit`: async callback that performs the feature-owned persistence or Discord send/edit work.

Implemented consumers:

- Tags: create a new tag or replace an existing tag with built blocks.
- Staff Echo: send built blocks to a selected Discord channel.

The system compiles blocks into a message payload, but the submit callback decides whether that payload is sent, edited, or persisted.

Submit must fail safely:

- Do not clear a session or report success until the submit succeeds.
- If validation fails, keep the draft available.
- If Discord send/edit fails, surface an ephemeral failure and keep the draft available.

## Authorization

Message Builder sessions should use the authorization supplied by the command or module that opened the active session. For Tags and Staff Echo, builder sessions require manager access.

Auth edge cases:

- Component and modal handlers must verify that `context.userID` owns the active session.
- Stale panels from older sessions should respond with an expired-interface message and should not mutate the current user's draft.
- Persisted drafts do not store auth or submit callbacks; after restart, old panels expire and users reopen through an authorized command.

## Rendering and Responses

Builder panels should use Components V2 and be ephemeral. The panel should show:

- Builder title and session label.
- Rendered component count and editable block count.
- Optional notice text.
- Block select when blocks exist.
- Action select.
- URL controls for link buttons, image galleries, and section thumbnails.
- Live preview compiled from the current blocks.

Compiled output should use Components V2. Link buttons, media, thumbnails, containers, separators, and text displays should be emitted through `systems/discord/` helpers. The renderer receives prepared draft blocks and should not query databases or perform feature-specific submit rules.

The manager-facing guide lives at [Message Builder Manager Guide](../../../docs/message-builder-guide.md). Treat it as a product-facing draft during implementation; rewrite it once the final interaction model settles.

## Link and Image Support

The current implementation is URL-only:

- Link rows can point to any durable external URL, including document or file links.
- Image galleries render manager-provided image URLs directly.
- Section thumbnails render manager-provided image URLs directly.
- The builder validates URLs before mutating the draft.
- The builder does not upload files, download files, persist binary data, or manage an asset store.

If Snail needs managed uploads later, design that as a separate asset-management feature rather than mixing it into the builder flow.

## Interaction Flow and Collectors

The desired UX is a single persistent builder workspace per user, not many isolated throwaway sessions. A lightweight interaction-collector abstraction may be useful if it provides:

- Session identity and stale-panel handling.
- Per-user active interaction ownership.
- Route grouping for many related component/modal handlers.
- Consistent timeout/deactivation behavior.

Do not add a generic collector only to mimic Discord.js collectors. If the implementation only needs route handlers plus persisted draft/session IDs, keep that logic inside Message Builder. If a second substantial feature needs the same active-session behavior, promote the reusable parts into a system-level collector with an ADR or doc update.

## Failure Modes

- Missing session: respond ephemerally that the builder session expired.
- Wrong user: respond ephemerally that the interaction belongs to another builder session.
- Superseded session: respond ephemerally that a newer Message Builder is active.
- Stale selection: keep the draft and ask the user to select a current block.
- Invalid URL: respond ephemerally and keep the modal/draft state as much as Discord allows.
- Invalid color: respond ephemerally and keep the draft unchanged.
- Missing image URL on old malformed data: render a clear missing-URL fallback in the preview.
- Component/selectable limit reached: respond ephemerally and keep the draft unchanged.
- Submit failure: respond ephemerally, keep the draft, and do not report success.
- Discord API failure: respond through the shared router error path when not handled locally.

## Runtime Logging

Message Builder writes to the `message_builder` log source. Use `/logs` to export the full runtime timeline or the Message Builder source logs.

Useful event types:

- `message_builder.started`: a builder session opened.
- `message_builder.action`: a component action was selected.
- `message_builder.block_selected`: the selected block changed.
- `message_builder.panel_updated`: the builder panel was edited and the draft was persisted.
- `message_builder.submitted`: a submit callback completed, failed validation, or threw.
- `message_builder.session_rejected`: an expired or superseded panel was used.
- `message_builder.operation_rejected`: a requested draft mutation was invalid.
- `message_builder.validation_failed`: modal input failed URL, color, or required-field validation.

Prefer IDs and counts for routine logs. Use trace level briefly when reproducing an issue, then lower the source level again.

## Test Plan

- Unit: draft creation, per-user persisted draft replacement/resume modes, block add/edit/delete/move, selected path adjustment, component-limit enforcement, selectable-limit enforcement, URL normalization, color parsing, link validation, and compile output.
- Integration: start builder from Tags, create/edit tag submit callbacks, stale/superseded session handling, wrong-user handling, persisted draft recovery after restart, modal value extraction, submit failure preserving the draft, and old tag `data` rendering through Tags.
- Manual: open builder from `/tag-manage create`; add text, separator, link row, container, section, and image gallery URL; move/delete blocks; submit; fetch rendered tag; edit the tag and verify existing blocks hydrate; restart the bot and verify a new create context resumes the previous current draft.
- Regression: Quest List Components V2 rendering, module panel routes, command sync, `npm run check`, and `npm test`.

## Open Questions

None.

## ADR Links

- [ADR 1: Interaction-first bot architecture](../../../docs/adr/0001-interaction-first-bot-architecture.md)
- [ADR 5: Discordeno REST and API types](../../../docs/adr/0005-discordeno-rest-and-api-types.md)
- [ADR 6: Authoritative guild command sync](../../../docs/adr/0006-authoritative-guild-command-sync.md)
