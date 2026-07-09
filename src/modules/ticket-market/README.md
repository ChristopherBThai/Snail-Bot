# Ticket Market

## Purpose

Ticket Market owns Snail-managed access to the ticket market, Snail-posted seller ads, active ad availability, Ticket Trading lock state, and ticket market audit logs.

This is a runtime module because it owns Discord interaction routes, module lifecycle behavior, persistent ad state, channel permission changes, control messages, timers, and gateway event handling. The feature should not depend on reading arbitrary user message content.

## Ownership

This module owns:

- Auto-posting and maintaining the combined rules/ad controls message.
- Market rules agreement and market access role assignment.
- Seller rules agreement state.
- Seller ad creation through a Snail form.
- Snail-authored seller ad messages in a consistent format.
- Seller/staff ad deletion.
- Active ad state.
- Ticket Trading lock/unlock behavior.
- Ticket market audit logs.
- Optional seller availability timers.
- Ticket inventory verification before an ad is posted.

This module does not own:

- Reaction-based agreement.
- Free-form user ad parsing.
- Message-content automod for arbitrary user-authored messages.
- Live ad count updates after trades in the first version.
- Staff punishment policy.

Delegate to:

- `systems/discord/` for Discord gateway routing, REST methods, components, modals, and permission overwrites.
- `Module#getConfig` and `Module#setConfig` for individual module settings.
- `database/snail/` for durable shared user records plus ticket market ad and cooldown persistence.
- `database/owo/` for read-only Wrapped Ticket inventory checks through OwO MySQL.
- OwO integration services only if a later version reacts to ticket trades.

## User Workflows

- Controls publish: on startup or enable, Snail posts one combined rules/ad controls message if a controls channel is configured and no saved controls message exists.
- Control message repair: if the saved rules/ad controls message can be edited, Snail updates it in place. If it was deleted or cannot be edited, Snail posts a replacement and stores the new message ID.
- Market access: a user completes the market rules agreement flow and receives the configured market access role.
- Seller access: a user completes the seller rules agreement flow before they can post ads.
- Post ad: an accepted seller uses a Snail form to provide ticket count, price, and optional note. Snail validates the fields, verifies the user has at least that many Wrapped Tickets, and posts the ad.
- Delete ad: the seller or staff deletes a Snail-posted ad. Snail marks it ended, records who deleted it, logs the details, and reconciles Ticket Trading.
- Market availability: Ticket Trading locks when there are no active ads and unlocks when at least one active ad exists.

## Rules and UX

Market rules copy and seller rules copy are manager-configurable. Both should default to obvious placeholder text such as "Replace me with the Ticket Market rules." and "Replace me with the Seller Rules." until admins configure the real text for the first time.

Discord channel, message, and role IDs are required setup values, not defaults. Leave them unset until managers configure the module, and fail closed when required IDs are missing.

The market access role must be a normal role with no server-level permissions. Ticket Market access should come from Snail-managed channel overwrites, not from inherent role permissions, so the module should reject managed roles and roles with any non-zero permission bit.

The current seller rules are:

1. Users can only advertise Wrapped Tickets (ID: 10). Joke or unrelated ads are not allowed.
2. Users must use the ad form.
3. Users cannot charge more than 2,000,000 cowoncy per ticket.
4. Users must not send buyers to DMs or another server.
5. Users must not advertise for other people.
6. Users must use the trade command.

Snail can enforce structured fields such as ticket count and price because the seller uses a form. Snail should also verify the seller has at least the number of Wrapped Tickets they claim to sell before posting the ad. Snail cannot fully enforce optional note content without message-content moderation, but optional notes are allowed because they are useful for sellers.

The market rules agreement is intentionally one button for now.

The rules/control UI should be one message with one container, one section for market rules, one section for seller rules, and one section for posting ads. Use section components with button accessories for compact rule accept/post controls where that fits the final UI.

The module settings panel should follow the Quest List pattern: one visible control should configure one setting or one coherent setting group. Do not ask staff to paste multiple Discord IDs into one modal, because a clipboard can only hold one ID at a time and blank fields are easy to interpret as accidental clears. Prefer channel selects, role selects, and small single-purpose controls over packed ID modals. If a module panel grows large enough to fight Discord component limits or fill more than one comfortable screen, split it into pages instead of compressing unrelated controls together.

## Commands and Interactions

| Route | Audience | Purpose | Notes |
| --- | --- | --- | --- |
| Market rules agree control | users | Complete market rules agreement | Grants market access role |
| Seller rules agree control | users | Complete seller rules agreement | Stores seller eligibility |
| Post ad control | accepted sellers | Open ad form | Enforces seller agreement and cooldown |
| Ad form modal | accepted sellers | Create Snail-posted seller ad | Validates ticket count, price cap, optional note length, and inventory |
| Delete ad control | seller/staff | End active ad | Records deleter ID and timestamps |
| Still Selling control | seller | Reset seller availability timer | Optional feature controlled by module setting |
| Module panel controls | managers | Configure channels, role, cooldowns, timers, and the combined controls message | Staff-only |
| Repair rules/ad controls | managers | Edit the saved controls message when possible, or post/store a replacement when necessary | Single repair path |

## State and Persistence

Use module config helpers for individual settings, and use a dedicated Snail persistence boundary for long-lived feature data such as ads and user state.

- Snail state:
  - rules/ad controls message ID
  - module settings stored as individual module config keys through `Module#getConfig` and `Module#setConfig`
  - shared Snail user records keyed by Discord user ID
  - ticket market user state under `User.ticketMarket`
  - market agreement timestamp
  - seller agreement timestamp
  - current market ban timestamp
  - active and ended ads
  - ad poster ID, deleter ID, timestamps, ticket count, price, and optional note
  - per-user ad post cooldowns
  - trading lock state
  - optional seller availability deadlines
- Module settings:
  - rules/ad controls channel ID
  - seller ads channel ID
  - ticket trading channel ID
  - ticket market log channel ID
  - market access role ID
  - market rules copy
  - seller rules copy
  - maximum price per ticket
  - ad post cooldown duration, suggested starting point 15 minutes
  - seller availability timeout duration, where 0 disables the feature
- OwO reads:
  - Wrapped Ticket inventory for the seller before an ad is posted
  - source database: OwO MySQL database `owo`
  - source tables: `user` and `user_item`
  - Discord user ID maps through `user.id` to internal `user.uid`
  - Wrapped Ticket item key: `common_tickets`
  - Unwrapped Ticket item key exists as `unwrapped_common_tickets` but must not count for this market
- OwO writes through named services:
  - none
- Cache/invalidation:
  - load active ads and user state on enable
  - reconcile Ticket Trading permissions after load, after ad state changes, and after disable

Persist configurable durations as milliseconds, for example `adCooldown` and `availabilityTimeout`. Do not use persisted duration field names with unit suffixes such as `Ms`; manager-facing forms can still accept friendlier units and convert before saving.

## Authorization

- User actions:
  - Users can complete the market rules agreement flow.
  - Users can complete the seller rules agreement flow.
  - Only seller-agreed users can post ads.
  - Sellers can have only one active ad at a time.
  - Sellers can delete their own ads.
  - Sellers can press their own Still Selling button when the availability feature is enabled.
- Staff actions:
  - Helpers and above can delete any ad.
  - Staff can inspect logs and active ad state.
- Manager actions:
  - Managers and above can configure module settings and repair the combined controls message.
- Auth edge cases:
  - Missing configured IDs fail closed with clear ephemeral responses.
  - Disabled module controls should respond with a clear market closed message.

## Admin Panel

The module panel should expose Ticket Market feature pages. Shared enable/disable, log export, state export, and log level controls live on the shared Runtime page.

- Overview page: trading lock state, combined rules message link, repair button, price cap, ad post cooldown, seller availability timeout, market rules copy length, and seller rules copy length.
- Access page: current market access role and role select.
- Channels page: current configured channels with one channel select per setting.
- Separate manager controls for price cap, seller timing, market rules copy, and seller rules copy.
- One button to repair/update the combined controls message, posting a replacement only when repair is not possible.
- Buttons to export state/logs.

Planned admin controls:

- Revoke market access for a user by removing the market access role and clearing the relevant agreement timestamp.
- Revoke seller access for a user by clearing `ticketMarket.sellerAgreedAt` while keeping moderation logs for audit.
- Ban a user from the market by setting `ticketMarket.marketBannedAt` on their shared user record, preventing market agreement, seller agreement, and ad posting.
- Unban a user by clearing `ticketMarket.marketBannedAt`; admins can decide whether that should also restore previous agreement timestamps or require the user to agree again.
- Log all revoke, ban, and unban actions with admin mention, raw IDs, optional summary, and timestamp.

## Logging

Ticket market logs should be readable for staff and useful for later moderation.

Durable user history belongs in the shared `UserLog` collection. The shared `User` document should store only current state needed for quick checks, such as agreement and ban timestamps. Actor IDs, action kinds, optional human summaries, repeated revoke/ban history, ad IDs, and other action details should be written as append-only `UserLog` entries.

Log events:

- Market rules agreement.
- Seller rules agreement.
- Ad posted.
- Ad deleted or ended.
- Ticket Trading locked.
- Ticket Trading unlocked.
- Seller availability timer reset.
- Seller availability timeout auto-delete.
- Module disabled market closure.

Ad logs should include:

- seller mention and user ID
- deleter mention and user ID when applicable
- ad message ID
- ticket count
- price per ticket
- total price
- optional note
- posted timestamp
- deleted or ended timestamp

Discord does not currently expose a bot message component that copies arbitrary text to a user's clipboard. Keep logs easy to copy on desktop and mobile by using mentions for people and channels plus code-spanned raw IDs, because mobile users can hold the code-formatted text to copy it. For bulk staff review, export logs/state as JSON.

## Market Locking

Ticket Trading is open when at least one active ad exists. It is closed when no active ads exist.

When opening Ticket Trading for the market access role, allow at least:

- View Channel
- Send Messages

When closing Ticket Trading, deny at least:

- View Channel
- Send Messages

On module disable, fully hide Seller Ads and Ticket Trading and make module-owned rules/control interactions respond with a clear market closed message. This prevents stale controls from continuing market activity while the module is intentionally disabled.

## Seller Ads

Snail should post all ads. User-authored ad messages should not be part of the normal flow.

Each seller can have only one active ad at a time.

Ad form fields:

- Ticket count
- Price per ticket, default maximum 2,000,000 unless managers configure a different limit
- Optional note

Ad message should include:

- Seller mention
- Wrapped Ticket count
- Price per ticket
- Total price
- Optional note
- Delete Ad button
- Optional Still Selling button when enabled
- Availability expiration timestamp when enabled

The module should enforce a configurable delay between ad posts per seller. Default: 15 minutes. Staff can tune this after seeing real use.

Before posting an ad, Snail must verify the seller has at least the requested number of Wrapped Tickets. If no inventory row exists for the user, treat the count as 0.

Inventory query by Discord user ID:

```sql
SELECT COALESCE(ui.count, 0) AS wrapped_ticket_count
FROM user u
LEFT JOIN user_item ui
    ON ui.uid = u.uid
    AND ui.name = 'common_tickets'
WHERE u.id = ?;
```

Inventory query by internal OwO UID:

```sql
SELECT COALESCE(count, 0) AS wrapped_ticket_count
FROM user_item
WHERE uid = ?
  AND name = 'common_tickets';
```

## Seller Availability

Optional future feature:

- Each ad can include a "Still Selling" button.
- A configurable timer tracks seller availability.
- The ad message shows the expiration using Discord timestamp rendering.
- If the timer reaches 0, Snail auto-deletes or ends the ad without sending a warning message.
- If the timeout setting is 0, the feature is disabled.
- Sending any message in Ticket Trading by the seller resets the timer to the configured limit because it indicates the seller is active.
- Pressing the "Still Selling" button resets the timer to the configured limit.

This feature requires gateway message events for Ticket Trading, but it does not require reading message content.

Default seller availability timeout: 15 minutes.

## Failure Modes

- Missing config: user-facing actions fail closed with clear ephemeral messages.
- Database unavailable: module startup should fail visibly if durable ticket market state cannot load.
- Discord API failure: log through the REST wrapper and surface a safe user-facing failure.
- Partial ad post failure: do not mark an ad active unless the Snail ad message was created.
- Partial delete failure: record enough state to retry or inspect the mismatch.
- Stale control messages: controls should either repair state or explain that the market is closed/unavailable.
- Rules update failure: if the saved rules/control message is missing, post a replacement and store the new message ID.
- Module disabled: close market channels and reject stale controls with a market closed response.
- Inventory verification unavailable: fail closed and tell the seller inventory verification is temporarily unavailable.

## Test Plan

- Unit:
  - ad form validation
  - price cap
  - optional note handling
  - ad cooldown decisions
  - one-active-ad-per-seller decision
  - Wrapped Ticket inventory eligibility
  - active ad count and trading lock decision
  - seller availability timer reset and expiry decisions
- Integration:
  - market rules agreement assigns role
  - seller rules agreement stores user ID
  - ad form creates persisted ad and Snail message
  - ad form rejects sellers with insufficient Wrapped Tickets
  - ad form rejects sellers who already have an active ad
  - delete button ends ad and records deleter ID
  - seller activity in Ticket Trading resets the ad expiration timestamp
  - Still Selling button resets the ad expiration timestamp
  - expired availability timer auto-deletes the ad
  - trading lock updates after ad create/delete
  - disabled module rejects controls and closes channels
- Manual:
  - startup posts the missing combined rules/ad controls message
  - startup repairs the saved combined controls message when it exists
  - startup posts a replacement combined controls message when the saved one was deleted
  - managers repair/update the combined controls message
  - seller posts ad through form
  - seller deletes own ad
  - staff deletes someone else's ad
  - Ticket Trading opens and closes correctly for the market access role
  - logs are readable and IDs are easy to copy
- Regression:
  - no arbitrary user message content is read
  - no reaction events are required
  - no OwO writes happen

## Open Questions

- Should sellers be allowed to edit their active ads?

## ADR Links

- None.
