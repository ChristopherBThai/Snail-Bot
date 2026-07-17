# Message Builder

Message Builder is a shared route and service contribution for composing Components V2 messages from Discord interactions.

It exposes `services.messageBuilder` for commands and features that want to open a builder session. It is not an admin-visible feature by itself.

## Behavior Contract

- One active builder session may exist per user.
- One current draft is saved per user.
- Opening a new builder session supersedes older controls and cancels the older pending builder result for that user.
- Builder sessions use an ephemeral display message followed by an ephemeral controller message.
- The display owns the compiled preview. The controller owns selection, editing actions, and finish actions.
- The controller and display are refreshed from the same draft after each successful change.
- Previews always suppress mentions.
- Final submit suppresses mentions by default. The Finish Builder controls can enable mentions for the current draft.
- Successful submit keeps the current draft available for later resume.
- Clear draft saves an empty current draft and turns mentions off.

## Draft Model

The saved draft stores:

- `components`: the builder-owned message component model.
- `allowMentions`: whether final submit may allow mentions.

The active session stores temporary runtime state:

- current selected component
- selected link or image inside the selected component
- session freshness ID
- Discord interaction tokens needed to refresh the display
- pending builder result and display labels

Selection state is intentionally in memory. If Snail restarts, resuming a draft starts from the message root.

## Builder UI

- The display message shows the compiled draft preview.
- The controller message uses one container for all controls.
- The top controls select the message root, a top-level component, or a component inside the selected container.
- The selected-component area shows concrete buttons for actions available on the selected component.
- Add Component adds to the message root when the selected component is top level.
- Add Component adds to the current container when the selected component is a container or inside a container.
- Link rows expose selected-link controls.
- Image galleries expose selected-image controls.
- Move Component keeps unavailable movement buttons disabled instead of removing them.
- Finish Builder contains mention behavior, clear draft, and submit.

## Supported Components

- Text components store one text body.
- Separators store divider visibility and spacing.
- Link rows store up to five link buttons. Empty link rows cannot be submitted.
- Containers store an optional accent color, spoiler setting, and child components. Containers cannot contain nested containers. Empty containers cannot be submitted.
- Sections store one to three text entries, a thumbnail URL, and thumbnail spoiler setting.
- Image galleries store up to ten image URLs. Each image may be marked as a spoiler. Empty image galleries cannot be submitted.

Draft messages can contain up to forty rendered Components V2 components. Message Builder counts the literal component objects it sends, including section wrappers, section text displays, and section thumbnails. Sections require thumbnails because Discord sections require an accessory. Each top-level component list and each container child list can contain up to twenty-four selectable builder components so the controller can include the extra root/container select option within Discord's select menu limit.

## Consumer Contract

Consumers call:

```js
services.messageBuilder.start(context, {
    label,
    submitLabel,
    mode,
    components,
    authorize
});
```

`start` responds to the opening interaction with the builder display and controls. It resolves when the user submits the builder or when a newer builder session supersedes the active one.

- `label` names the target being edited or sent to.
- `submitLabel` names the final submit button.
- `mode: services.messageBuilder.OpenModes.Resume` starts from the saved current draft when one exists.
- `mode: services.messageBuilder.OpenModes.Replace` starts from supplied `components` or an empty draft.
- `authorize` is re-checked for every builder interaction.

Message Builder validates the draft before submit and only returns submitted results with a sendable Discord message payload.

When the user submits, consumers receive:

```js
{
    type: services.messageBuilder.SubmitResults.Submitted,
    context,
    message,
    confirm,
    reject
}
```

- `context` is the submit interaction context.
- `message` is the final Discord message payload. It already reflects the draft's mention toggle.
- `confirm(text)` closes the submitted builder session when it is still active and updates the controller with success text.
- `reject(text)` responds with an ephemeral error, keeps the builder session active, and resolves with the next builder result when the user submits again or opens a newer builder.

When a newer builder session supersedes the active one, consumers receive:

```js
{
    type: services.messageBuilder.SubmitResults.Cancelled
}
```

The consumer owns the final action, such as sending, editing, or saving the returned message payload.

## Persistence

Drafts are saved in Snail Mongo under the shared user record. Saved drafts survive process restarts.

Saved drafts are checked before resume. If a saved draft cannot be opened with the current builder rules, Message Builder starts with a fresh empty draft.

The active session is not saved. It contains Discord interaction tokens, freshness IDs, selection state, and the pending builder result that only make sense while the current process is running.

## Hydration

Message Builder can hydrate Snail-authored plain-content messages and supported Components V2 messages for editing.

Hydration supports:

- plain message content as a text component
- text displays
- separators
- action rows containing only link buttons
- containers with supported non-container children
- sections with text displays and thumbnails
- media galleries with image URLs

Hydration rejects messages with embeds, attachments, stickers, polls, interactive components, unsupported component shapes, nested containers, empty image galleries, unsupported section accessories, or more editable components than Message Builder supports.

Hydrated drafts default to mentions off.
