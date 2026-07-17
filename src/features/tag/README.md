# Tags

Tags let staff save reusable Discord messages and let users request them through `/tag`.

Tags is an installed route/data contribution. It does not expose feature metadata yet because it has no admin-visible package panel or feature-level runtime controls.

## Commands

- `/tag get name:<tag>` sends a saved tag.
- `/tag list` shows the available tag names.
- `/tag-manage create name:<tag> message:<text>` creates a plain text tag.
- `/tag-manage create name:<tag>` opens Message Builder and saves the submitted message as the tag.
- `/tag-manage edit name:<tag> message:<text>` replaces a tag with plain text.
- `/tag-manage edit name:<tag>` opens Message Builder from the saved tag message.
- `/tag-manage delete name:<tag>` deletes a tag.
- `/tag-manage public name:<tag> public:<true|false> channel:<optional>` controls whether one tag is public in one channel.
- `/tag-manage public-default public:<true|false> channel:<optional>` controls whether all tags are public by default in one channel.
- `/tag-manage public-list name:<optional> channel:<optional>` shows public settings. Provide `name` to list the channels where that tag has a tag-specific public setting. Omit `name` to show the selected channel's public-by-default setting and tag-specific public settings in that channel.

`/tag-manage` requires manager access and is registered as a staff command.

## Tag Names

Tag names use lowercase ASCII letters and numbers only.

Autocomplete returns up to 25 matching tag names. The feature keeps an in-memory name cache after the first database read and updates that cache after successful create/delete operations.

## Public Behavior

Tags are private by default. A tag response is public only when:

- the tag has a tag-specific public setting for the current channel, or
- the current channel has public-by-default tags enabled.

Tag messages always suppress mentions, including public tag messages. Message Builder sessions opened by Tags lock mentions off so staff cannot accidentally save a tag that pings users or roles.

## Data

Tag records store:

- `_id`: tag name
- `message`: raw Discord message payload saved from Message Builder or plain text creation
- `data`: legacy plain text read for compatibility only
- `publicChannelIds`: channels where this tag is public
- `createdBy`: Discord user ID that created the tag
- `updatedBy`: Discord user ID that last changed the tag
- `uses`: number of successful `/tag get` sends
- `lastUsedAt`: when the tag was most recently sent

Channel records store:

- `_id`: Discord channel ID
- `tagsPublicByDefault`: whether all tags are public by default in that channel

The shared data layer owns model registration. The Tags repository owns tag-specific queries and public-channel policy reads/writes.

New create/edit flows write `message`, not legacy `data`.
