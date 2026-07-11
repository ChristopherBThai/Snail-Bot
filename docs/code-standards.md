# Code Standards

This is the repo-wide code-quality standard for Snail. `AGENTS.md` points here so agents and humans can use one shared checklist before implementing or reviewing non-trivial changes.

Use this document before architecture, runtime, Discord route, feature package, data, logging, or configuration work. Feature-specific UI layout, copy, settings, admin pages, and workflow details belong in the owning feature README.

## Goal

Snail code should be easy to read, easy to navigate, and organized around the real owner of each behavior. Do not trade clear ownership for speculative extension points, helper noise, defensive checks around code Snail controls, or abstractions that only exist because an earlier design shape suggested them.

## Non-Negotiable Rules

1. **Ownership first.** Before adding data, copy, helpers, conditionals, lookup maps, validation, or logging, identify the owning feature or runtime folder.
2. **Feature behavior belongs to features.** Product decisions, user workflows, long-term feature state, and feature policy belong in `src/features/<feature-id>/`.
3. **Runtime infrastructure stays reusable.** `runtime/`, `discord/`, `config/`, `logging/`, and `data/` provide infrastructure and shared contracts, not feature-specific policy.
4. **Routes stay thin.** Commands, components, modals, autocomplete handlers, context commands, and gateway handlers parse input, authorize, call the owner, and return output.
5. **Renderers render.** Renderers may own display copy, labels, layout, component ordering, and presentation choices. They must not own database access, feature rules, state transitions, or saved-record semantics.
6. **Database code stores and loads.** Shared database modules expose clients, shared models, and narrow database services. Feature-specific queries belong in the owning feature repository.
7. **Trust Snail-created runtime objects after startup.** Do not add fallback defaults or optional chaining around required config, loggers, databases, feature services, or interaction context fields that Snail creates and requires.
8. **Validate at trust boundaries.** Validate Discord payloads, custom IDs, environment values, database rows, serialized records, external service payloads, and user input. Do not defensively normalize values the current code just created.
9. **Helpers must pass the deletion test.** If deleting a helper makes the caller simpler or only moves a one-line expression back to one call site, delete it.
10. **No speculative architecture.** Add folders, services, fields, config, indexes, extension points, and docs for current features or clearly identified planned features, not vague future categories.
11. **No compatibility shims for unshipped work.** Prefer one clean canonical shape unless the maintainer explicitly asks for migration, backfill, or compatibility behavior.
12. **Tests use production seams.** Do not split code into tiny helpers just to test them. Test the feature, route, registry, renderer, repository, or runtime interface that production callers use.

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

- `index.js`: compose and export the feature definition.
- `routes.js`: adapt Discord inputs and call feature services.
- `service.js`: own workflows, lifecycle behavior, runtime state, and feature policy.
- `admin.js`: contribute Admin Console pages and admin route helpers.
- `render.js`: build Discord output from prepared state.
- `repository.js`: own feature-specific database queries.
- `rules.js`: hold pure feature decisions when separating them improves clarity or tests.

Not every feature needs every file. Tiny features may stay in `index.js` until they grow multiple responsibilities.

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
export default defineFeature({
    id: 'ticket_market',
    setup(context) {
        const service = createTicketMarketService(context);

        return {
            routes: ticketMarketRoutes(service),
            admin: ticketMarketAdmin(service),
            health: () => service.health()
        };
    }
});
```

### Keep Routes Thin

Do not put feature policy in a route handler:

```js
async function handleButton(context) {
    if (context.userTickets < 25 || context.marketClosed) {
        return context.respond({ content: 'You cannot post here.' });
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
const route = routeRegistry.resolveComponent(interaction.data.custom_id);
```

Do not re-check values that were created by Snail during the same flow unless there is a real invariant worth enforcing:

```js
const logger = context.logger;
logger.info('ticket_market.loaded');
```

### Helpers Must Earn Their Keep

Do not add a helper that only renames one call:

```js
function getFeatureLogger(context) {
    return context.logger;
}
```

Do keep helpers that centralize validation, ownership policy, logging shape, routing shape, or repeated Discord payload rules.

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
- Stale artifacts such as old names, old log events, old terminology, or unused compatibility branches after the current direction changes.
- Debug-only shortcuts that can leak into production.

## Enforce With Code

Important standards should become helper validation or focused tests when the relevant code exists.

- Feature definition helpers should reject duplicate feature IDs and invalid contribution shapes.
- Route helpers should reject duplicate route IDs.
- Command route registration should reject duplicate Discord command names within the same scope.
- Command sync should treat guild scope as the default and require global commands to opt in on the owning command route.
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

1. Read `AGENTS.md`, this standards doc, and the closest relevant architecture, database, configuration, workflow, or feature README.
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
- [ ] Named architecture feedback has source-backed closure, or the maintainer accepted deferral.

## Tests And Type Checks

Use the package scripts for verification and formatting:

- `npm run check`: run Biome checks.
- `npm run check:fix`: run Biome checks and safe writes.
- `npm run format`: run Biome formatting checks.
- `npm run format:fix`: run Biome formatting writes.
- `npm test`: run tests.
