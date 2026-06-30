# Message Builder Guide

Message Builder is Snail's staff tool for making reusable Components V2 tag messages without writing raw JSON.

## The Big Idea

You have one working draft. Snail keeps that draft for you, so if the builder goes inactive or the bot restarts, your next new builder session can pick up where you left off.

Editing an existing tag intentionally replaces your draft with that tag's current blocks.

## Opening the Builder

When you open Message Builder from a create-style command, Snail resumes your current draft when it can. When you open it from an edit-style command, Snail loads the thing you are editing so you do not accidentally overwrite it with an unrelated draft.

Only one builder is active for you at a time. If you open a new builder, the old panel expires and the new one becomes the place to keep working.

## Blocks

A message is made from blocks:

- Text: normal message text.
- Separator: a visual divider.
- Link row: one row of link buttons.
- Container: a framed group that can hold other blocks.
- Section: text with a thumbnail.
- Image gallery: one or more image links.

Select a block before editing, moving, or deleting it. Select the message root when you want to add something at the top level.

## Links and Images

Use link rows for websites, docs, files, forms, and other external resources. The builder does not upload or store files for you.

For image galleries and section thumbnails, use a direct image URL when possible.

## Saving

Saving does whatever the command that opened the builder promised:

- For tag create, submitting creates the tag.
- For tag edit, submitting updates the tag.
- For echo, submitting sends the built message to the selected channel.

If submitting fails, your draft stays open so you can try again after fixing the problem.

## Tips

- Keep support tags short enough to scan quickly.
- Use containers for grouped information, not for every line.
- Use link buttons when a source or guide is more useful than a pasted wall of text.
- Use image galleries only when the images clarify the answer.
- Avoid mentions in tags. Snail suppresses tag mentions by default so public tags cannot unexpectedly ping people or roles.
