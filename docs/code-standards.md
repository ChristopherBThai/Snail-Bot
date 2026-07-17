# Code Standards

This is the repo-wide code-quality standard for Snail. `AGENTS.md` points here so agents and humans can use one shared checklist before implementing or reviewing non-trivial changes.

Use this document before architecture, runtime, Discord route, feature package, data, logging, or configuration work. Feature-specific UI layout, copy, settings, admin pages, and workflow details belong in the owning feature README.

## Goal

Snail code should be easy to read, easy to navigate, and organized around the real owner of each behavior. Do not trade clear ownership for speculative extension points, helper noise, defensive checks around code Snail controls, or abstractions that only exist because an earlier design shape suggested them.

## Non-Negotiable Rules

1. **Ownership first.** Before adding data, copy, helpers, conditionals, lookup maps, validation, or logging, identify the owning feature or runtime folder.
2. **Feature behavior belongs to features.** Product decisions, user workflows, long-term feature state, and feature policy belong in `src/features/<feature-id>/`.
3. **Runtime infrastructure stays reusable.** `runtime/`, `discord/`, `config/`, `logging/`, and `data/` provide infrastructure and shared contracts, not feature-specific policy.
4. **Routes stay thin.** Routes are feature-owned inbound handlers. Commands, components, modals, autocomplete handlers, context commands, and gateway handlers parse input, authorize, call the owner, and return output.
5. **Renderers render.** Renderers may own display copy, labels, layout, component ordering, and presentation choices. They must not own database access, feature rules, state transitions, or saved-record semantics.
6. **Database code stores and loads.** Shared database modules expose clients, shared models, and narrow database services. Feature-specific queries belong in the owning feature repository.
7. **Trust Snail-created runtime objects after startup.** Do not add fallback defaults or optional chaining around required config, loggers, databases, feature services, or interaction context fields that Snail creates and requires.
8. **Validate at trust boundaries.** Validate Discord payloads, custom IDs, environment values, database rows, serialized records, external service payloads, and user input. Do not defensively normalize values the current code just created.
9. **Helpers must pass the deletion test.** If deleting a helper makes the caller simpler or only moves a one-line expression back to one call site, delete it.
10. **No speculative architecture.** Add folders, services, fields, config, indexes, extension points, and docs for current features or concrete planned features, not vague future categories. Concrete planned features are named product behavior, route kinds, databases, admin surfaces, or runtime capabilities already described by project docs.
11. **No compatibility shims for unshipped work.** Prefer one clean canonical shape unless the maintainer explicitly asks for migration, backfill, or compatibility behavior.
12. **Components V2 is the Discord message default.** Bot-authored Discord messages should use Components V2 unless a Discord limitation or compatibility exception is documented with the owning feature or runtime code.
13. **Tests use production seams.** Do not split code into tiny helpers just to test them. Test the feature, route, registry, renderer, repository, or runtime interface that production callers use.
14. **Tests live near the code they cover.** Feature tests belong in that feature package. Runtime, Discord, config, logging, and data tests belong beside the owning runtime code.

## Style

- Use modern ESM JavaScript.
- Use relative imports. Do not add project import aliases without an ADR.
- Use the package formatter/checker scripts. Biome is the project formatter/checker; see [ADR 7](adr/0007-biome-formatting-and-checking.md).
- Keep files focused on one clear responsibility.
- Prefer explicit names over clever abbreviations.
- Add comments only for non-obvious decisions, invariants, or operational risks.
- Avoid unrelated formatting churn.

These style rules support ownership and readability. They are not a reason to preserve a bad shape.

## Feature Package Shape

Substantial features should use boring, predictable files when those files have real work:

- `index.js`: compose and export the registered package contribution.
- `routes.js`: adapt Discord inputs and call feature services.
- `service.js`: own workflows, lifecycle behavior, runtime state, and feature policy.
- `admin.js`: contribute Admin Console pages and admin route helpers.
- `render.js`: build Discord output from prepared state.
- `repository.js`: own feature-specific database queries.
- `rules.js`: hold pure feature decisions when separating them improves clarity or tests.

Not every feature needs every file. Tiny features may stay in `index.js` until they grow multiple responsibilities.

Creating a feature package does not register it. Snail does not scan `src/features/` at startup. Add the contribution to `PACKAGE_REGISTRY` in `src/runtime/registry.js` when it should participate in startup, command sync, routing, admin discovery, and registry tests. Registered packages may export route-only contribution objects or setup functions that return contributions. A package that needs runtime context should export the setup function directly, not wrap it in an object property. Package setup composes services, repositories, routes, and contribution metadata; it should not perform database reads, database writes, Discord API calls, or other startup I/O. If a package later needs saved startup state, add an explicit package initialization phase that runs after the registry is fully composed. Packages are registered in `PACKAGE_REGISTRY` order; services exposed by earlier packages are available to later setup functions. Add `feature` metadata only when the contribution is product/admin-visible. When adding, removing, or changing a registered package contribution, run the registry tests so registered-contribution and route expectations still hold.

Route IDs are Snail's internal identity for logs, diagnostics, tests, admin references, and future state keys. Discord matching belongs to route-specific fields such as `command.name` or, when those route kinds exist, custom ID fields and event names. Do not add runtime support for a route kind until registry indexing, Discord sync when needed, gateway dispatch, focused tests, and docs all support it.

## Do / Don't Examples

### Do Not Add Future Buckets

Do not add a generic folder because Snail might need that category later:

```text
src/integrations/
```

Do keep concrete current behavior in the folder that owns it:

```text
src/data/owo/
```

Add a new top-level category only when a current feature or explicit plan needs behavior that no existing owner should hold.

### Do Not Split Old Concepts Back Out

Do not model one feature as separate module, command, and system owners:

```js
registerModule(ticketMarketModule);
registerCommand(ticketMarketCommand);
registerSystem(ticketMarketSystem);
```

Do let one feature contribute the runtime surfaces it owns:

```js
export default function setupTicketMarket(context) {
    const service = createTicketMarketService(context);

    return {
        feature: {
            id: 'ticket_market',
            name: 'Ticket Market',
            description: 'Manages ticket market behavior.'
        },
        routes: ticketMarketRoutes(service),
        admin: ticketMarketAdmin(service)
    };
}
```

### Keep Routes Thin

Do not put feature policy in a route handler:

```js
async function handleButton(context) {
    if (context.userTickets < 25 || context.marketClosed) {
        return context.respond('You cannot post here.');
    }

    await saveSellerAd(context.user.id, context.fields);
}
```

Do delegate the decision to the owning feature:

```js
async function handleButton(context) {
    const result = await service.createSellerAd(context.user.id, context.fields);
    return context.respond(renderSellerAdResult(result));
}
```

### Keep Renderers Out Of Feature Rules

Do not calculate eligibility, state transitions, or database reads in a renderer:

```js
export function renderQuestList(user, quests) {
    const eligible = quests.filter((quest) => quest.level <= user.level);
    return buildQuestMessage(eligible);
}
```

Do pass prepared display state into the renderer:

```js
export function renderQuestList(view) {
    return buildQuestMessage(view.visibleQuests);
}
```

### Validate Boundaries, Not Internal Echoes

Do validate external input before it enters Snail-owned behavior:

```js
const route = registry.routes.getCommand(interaction.data.name);
```

Do not re-check values that were created by Snail during the same flow unless there is a real invariant worth enforcing:

```js
const logger = context.logger;
logger.info('ticket_market.loaded');
```

### Runtime Checks Vs Tests

Do not treat every startup assertion as boundary validation. Some values and objects are static source contracts controlled by Snail; others are runtime inputs or composition conflicts that can silently change behavior.

Use tests for static source config shape and source-owned values:

```js
expect(config.discord.applicationId).toMatch(/^\d{17,20}$/);
expect(config.discord.guildId).toMatch(/^\d{17,20}$/);
```

Do not copy every config literal into a test unless the exact value is the behavior Snail needs to protect. Test environment values through the production config loader, grouped by the destination config object they populate.

Use startup checks for machine-local environment requirements:

```js
if (!config.discord.token) {
    throw new Error('BOT_TOKEN is required to initialize Discord REST and gateway.');
}
```

Use registry tests for source-owned composition conflicts that would overwrite or misroute behavior:

```js
expect(new Set(commandNames).size).toBe(commandNames.length);
```

Avoid registry checks that only re-prove source-authored contribution objects. Test the registered feature and route lists directly for source-owned feature metadata, route identity, implemented route contracts, and command name uniqueness.

Registry tests should stay structural unless a specific package is the behavior under test. Do not assert that `/snail`, `snail:command`, or another concrete package route exists just to prove the registry works; iterate over registered routes and features instead.

### Helpers Must Earn Their Keep

Do not add a helper that only renames one call:

```js
function getFeatureLogger(context) {
    return context.logger;
}
```

Do keep helpers that centralize validation, ownership policy, logging shape, routing shape, or repeated Discord payload rules.

### Keep Log Events Source-Local

Logger child sources carry ownership. Event names should describe what happened inside that source, not repeat the source name.

Do not duplicate the logger source in the event name:

```js
logger.child('discord').error('discord.global_command_sync.failed');
```

Do use source-local event names with dot-separated result phases:

```js
logger.child('discord').error('global_command_sync.failed');
```

Use consistent event phases such as `.planned`, `.completed`, and `.failed` when one workflow logs multiple outcomes.

### Use Components V2 By Default

Do not send bot-authored messages as plain `content` unless the owning feature or runtime code documents a Discord limitation or compatibility exception:

```js
return context.respond({ content: 'Saved.' });
```

Do use the shared Discord helpers or response normalization that produce Components V2 payloads:

```js
return context.respond('Saved.');
```

## Anti-Patterns

Reject these during implementation and review:

- Feature policy in route handlers, renderers, shared database setup, or generic runtime services.
- Shared modules that expose feature-specific query helpers.
- Global utility files that collect unrelated feature behavior.
- Thin wrappers that only rename or proxy one existing call.
- Static facades or factories that only hide ordinary construction.
- New abstractions introduced before Snail has enough real usage to justify them.
- Optional branches around required runtime objects.
- Defensive normalization against data shapes the current code cannot produce.
- Hidden mode behavior where one mode silently behaves like another because of specific target or option combinations.
- Speculative indexes, config values, services, or extension points with no current read path or caller.
- Standalone contribution fields for future admin or status ideas when current `state`, `admin`, or route contributions can carry the known behavior.
- Stale artifacts such as old names, old log events, old terminology, or unused compatibility branches after the current direction changes.
- Debug-only shortcuts that can leak into production.

## Enforce With Code

Important standards should become focused tests or helper validation when the relevant code exists.

- Registered feature list tests should reject invalid feature metadata shape and feature ID naming.
- Registered feature list tests should reject duplicate feature IDs.
- Registry tests should verify package registry order when order is behavior.
- Contribution-specific validation belongs to the owning registry or helper for that contribution.
- Registered route tests should reject duplicate route IDs.
- Registered route tests should reject duplicate Discord command names across registered command routes.
- Command sync should treat guild commands as the default and require global commands to opt in with `command.global: true` on the owning command route.
- Staff command visibility should use `command.staff: true`; runtime `authorize` remains the access check.
- Component and modal helpers should make invalid Discord payloads hard to construct.
- Render tests should count complete Discord payloads for component-heavy messages that can approach Discord limits.
- Render tests should assert rendered `custom_id` values are unique per message.
- Database setup should expose clients and shared models, not feature-specific query helpers.
- Config tests should verify static config exports include required values and expected value shapes.

Do not add tests that only prove a library constructor, parser, or one-line pass-through works. Add tests where Snail owns validation, routing, translation, limits, ownership rules, or production-sensitive behavior.

## Review Rubric

A code architecture review should request changes when any answer below is bad:

- **Ownership:** Can each behavior be traced to the feature or runtime folder that owns it?
- **Interface depth:** Did the change create useful modules with simple caller knowledge, or shallow pass-through wrappers?
- **Helpers:** Are helpers shared because multiple owners need them, or because code was split before it earned the split?
- **Routes:** Do routes adapt Discord input/output and delegate feature behavior?
- **Renderers:** Are renderers free of database access, state transitions, and feature rules?
- **Data:** Do shared database modules expose shared clients/models/services instead of feature-specific policy?
- **Runtime objects:** Are required runtime objects trusted after startup instead of treated as optional throughout the code?
- **Tests:** Do tests exercise production interfaces instead of private helper seams?
- **Test location:** Are tests colocated with the owner they exercise instead of collected in a detached global test folder?
- **Compatibility:** Did the change avoid legacy shims and fallback paths unless the task explicitly requires them?
- **Speculation:** Is every new folder, field, service, option, and extension point tied to current or explicitly planned behavior?

## Feedback Closure

If the maintainer or a reviewer names specific architecture concerns, those concerns become blocking acceptance criteria for the task.

Before reporting completion, create a short feedback closure check that maps every named concern to source evidence:

- original concern
- broader smell category, such as ownership, route-owned policy, renderer-owned rules, helper noise, defensive internals, speculative architecture, stale terminology, or database ownership
- status: fixed, still present, or intentionally deferred
- exact files or symbols checked
- searches or inspections performed
- remaining violations, if any

Do not claim work is fixed, ready, or aligned while a named architecture concern is still present unless the maintainer explicitly accepts the deferral. Passing tests does not replace source-level verification.

Derive verification from the current feedback instead of maintaining a permanent checklist of one-off symbol names. Use concrete symbols from the current task as evidence, but keep the lasting standard focused on the smell category.

## Required Workflow For Big Tasks

1. Read `AGENTS.md`, this standards doc, and the closest relevant architecture, database, configuration, or feature README.
2. Inspect or sketch the proposed module shape before implementation.
3. Implement one coherent slice at a time.
4. Run focused checks for the touched area.
5. Review the diff for ownership, helper noise, defensive internals, speculative structure, and stale terminology before reporting completion.
6. If the maintainer or reviewer gave specific architecture feedback, complete the feedback closure check before reporting completion.
7. Fix architecture regressions directly instead of adding comments that explain bad structure.

## PR Checklist

Use this checklist for non-trivial work:

- [ ] Behavior lives with the owning feature or runtime folder.
- [ ] Routes are thin adapters.
- [ ] Renderers are presentation-only.
- [ ] Shared data modules do not contain feature policy.
- [ ] Helpers pass the deletion test.
- [ ] Required runtime objects are trusted after startup.
- [ ] Validation happens at trust boundaries.
- [ ] New structure is tied to current or explicitly planned behavior.
- [ ] Stale names, compatibility branches, and old terminology were removed.
- [ ] Tests cover public production behavior where risk justifies them.
- [ ] Tests are colocated with the feature or runtime owner they cover.
- [ ] Named architecture feedback has source-backed closure, or the maintainer accepted deferral.

## Tests And Type Checks

Keep tests close to the code they cover:

- Feature tests live under `src/features/<feature-id>/`.
- Runtime tests live under `src/runtime/`.
- Discord infrastructure tests live under `src/discord/`.
- Config, logging, data, and utility tests live beside those owners.

Test with intention. Prefer tests for Snail-owned contracts, production seams, validation, routing, translation, ownership rules, data safety, and bugs whose cause would realistically regress. Do not add visual or UX tests just because copy or layout changed; test visual/UX behavior only when Snail owns an invariant such as payload limits, unique `custom_id` values, disabled dangerous controls, or a required response shape.

Use the package scripts for verification and formatting:

- `npm run check`: run Biome checks.
- `npm run check:fix`: run Biome checks and safe writes.
- `npm run format`: run Biome formatting checks.
- `npm run format:fix`: run Biome formatting writes.
- `npm test`: run tests.
