# Message Builder

Message Builder lets staff make polished Discord messages without writing JSON. Use it when you want text, separators, buttons, containers, sections, or image galleries in one message.

## Open It

- Use `/echo` without filling in the message option to build and send a new message to the selected channel.
- Right-click a Snail message, choose Apps, then choose `edit` to update that message in Message Builder.

Only you can use your builder controls. If you open Message Builder again, the newest builder replaces the old one.

## What You See

Message Builder opens two private messages:

- The first message is the preview.
- The second message has the controls.

The preview shows what the message will look like. The controls let you choose a component, edit it, add more components, move things, clear the draft, and submit.

## Add Components

Use Add Component to build the message.

- Text adds normal text.
- Separator adds a divider.
- Link Row adds up to five link buttons.
- Container groups other components together.
- Section adds text with a required thumbnail image.
- Image Gallery adds up to ten image URLs.

When you add a component, Message Builder adds it to the current parent. If you are working at the message root, it adds to the main message. If you are working inside a container, it adds inside that container.

## Select And Edit

Use the top select menus to choose what you want to work on.

- The first menu selects the message root or a top-level component.
- The second menu selects something inside the selected container.

After selecting a component, use the available buttons to edit, move, or delete it. Some buttons are disabled when that action is not available.

## Mentions

The preview does not ping anyone. Mentions are off by default for the final message too.

Use the Mentions button in Finish Builder if the final sent or edited message should allow pings.

## Submit

Use Submit when the preview looks right.

- For `/echo`, Submit sends the built message to the selected channel.
- For `edit`, Submit updates the selected Snail message.

If something fails, Message Builder keeps your draft open so you can try again.

## Editing Existing Messages

The `edit` command works on Snail-authored messages that Message Builder can understand.

It can edit:

- plain message text
- text displays
- separators
- link buttons
- containers
- sections with thumbnails
- image galleries

It cannot edit messages with embeds, attachments, stickers, polls, interactive buttons, unsupported component layouts, nested containers, or messages that are too complex for Message Builder.

## Tips

- Keep public messages short enough to scan.
- Use containers to group related information.
- Use link buttons for forms, guides, and sources.
- Use image galleries only when the images add useful context.
- Check the preview before submitting.
