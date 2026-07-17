import { ApplicationCommandType } from 'discord-api-types/v10';
import { describe, expect, test } from 'vitest';
import { createRegistry } from './registry.js';

const FEATURE_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const ROUTE_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*:[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

describe('createRegistry', () => {
    const context = {
        databases: {
            snail: {
                mongo: {
                    models: {
                        User: {}
                    }
                }
            }
        }
    };

    test('allows registered packages to contribute routes without feature metadata', () => {
        const registry = createRegistry(context);
        const visibleFeatureRouteIds = new Set(
            registry.features.list().flatMap((contribution) => contribution.routes?.map((route) => route.id) ?? [])
        );
        const routeOnlyRouteIds = registry.routes
            .list()
            .map((route) => route.id)
            .filter((routeId) => !visibleFeatureRouteIds.has(routeId));
        const registeredRouteIds = registry.routes.list().map((route) => route.id);

        expect(routeOnlyRouteIds.length).toBeGreaterThan(0);
        expect(registeredRouteIds).toEqual(expect.arrayContaining(routeOnlyRouteIds));
        expect([...visibleFeatureRouteIds]).not.toEqual(expect.arrayContaining(routeOnlyRouteIds));
    });

    test('keeps admin-visible feature metadata complete', () => {
        const registry = createRegistry(context);

        for (const contribution of registry.features.list()) {
            expect(contribution.feature).toMatchObject({
                id: expect.any(String),
                name: expect.any(String),
                description: expect.any(String)
            });
            expect(contribution.feature.id).toMatch(FEATURE_ID_PATTERN);
            expect(contribution.feature.name.trim()).not.toBe('');
            expect(contribution.feature.description.trim()).not.toBe('');
        }
    });

    test('lists admin-visible features by display name', () => {
        const registry = createRegistry(context);
        const featureNames = registry.features.list().map((contribution) => contribution.feature.name);

        expect(featureNames).toEqual([...featureNames].sort((left, right) => left.localeCompare(right)));
    });

    test('keeps admin-visible feature ids unique', () => {
        const registry = createRegistry(context);
        const featureIds = registry.features.list().map((contribution) => contribution.feature.id);

        expect(new Set(featureIds).size).toBe(featureIds.length);
    });

    test('keeps registered route contributions complete', () => {
        const registry = createRegistry(context);

        for (const route of registry.routes.list()) {
            expect(route).toMatchObject({
                id: expect.any(String),
                kind: expect.any(String),
                handle: expect.any(Function)
            });
            expect(route.id).toMatch(ROUTE_ID_PATTERN);

            if (route.kind === 'command') {
                expect(route.command).toMatchObject({
                    type: expect.any(Number),
                    name: expect.any(String)
                });
                expect(route.command.name.trim()).not.toBe('');
                expect(route.command.global === undefined || typeof route.command.global === 'boolean').toBe(true);
                expect(route.command.staff === undefined || typeof route.command.staff === 'boolean').toBe(true);

                if (route.command.type === ApplicationCommandType.ChatInput) {
                    expect(route.command.description).toEqual(expect.any(String));
                    expect(route.command.description.trim()).not.toBe('');
                }
            }

            if (route.kind === 'component' || route.kind === 'modal') {
                expect(route.customIdPrefix).toEqual(expect.any(String));
                expect(route.customIdPrefix.trim()).not.toBe('');
                expect(route.customIdPrefix.startsWith(`${route.id}:`)).toBe(true);
            }
        }
    });

    test('keeps registered route ids unique', () => {
        const registry = createRegistry(context);
        const routeIds = registry.routes.list().map((route) => route.id);

        expect(new Set(routeIds).size).toBe(routeIds.length);
    });

    test('resolves routes by route id', () => {
        const registry = createRegistry(context);

        for (const route of registry.routes.list()) {
            expect(registry.routes.get(route.id)).toBe(route);
        }

        expect(registry.routes.get('missing:route')).toBeUndefined();
    });

    test('keeps registered command names unique', () => {
        const registry = createRegistry(context);
        const commandNames = registry.routes.commandRoutes().map((route) => route.command.name);

        expect(new Set(commandNames).size).toBe(commandNames.length);
    });

    test('resolves command routes by Discord command name', () => {
        const registry = createRegistry(context);

        for (const route of registry.routes.commandRoutes()) {
            expect(registry.routes.getCommand(route.command.name)).toBe(route);
        }

        expect(registry.routes.getCommand('missing')).toBeUndefined();
    });

    test('keeps component route custom ID prefixes unique and non-overlapping', () => {
        const registry = createRegistry(context);
        const customIdPrefixes = registry.routes.componentRoutes().map((route) => route.customIdPrefix);

        expect(new Set(customIdPrefixes).size).toBe(customIdPrefixes.length);
        expect(getOverlappingPrefixPairs(customIdPrefixes)).toEqual([]);
    });

    test('keeps modal route custom ID prefixes unique and non-overlapping', () => {
        const registry = createRegistry(context);
        const customIdPrefixes = registry.routes.modalRoutes().map((route) => route.customIdPrefix);

        expect(new Set(customIdPrefixes).size).toBe(customIdPrefixes.length);
        expect(getOverlappingPrefixPairs(customIdPrefixes)).toEqual([]);
    });

    test('resolves component routes by custom ID prefix', () => {
        const registry = createRegistry(context);

        for (const route of registry.routes.componentRoutes()) {
            expect(registry.routes.getComponent(`${route.customIdPrefix}session-id`)).toBe(route);
        }

        expect(registry.routes.getComponent('missing:component')).toBeUndefined();
    });

    test('resolves modal routes by custom ID prefix', () => {
        const registry = createRegistry(context);

        for (const route of registry.routes.modalRoutes()) {
            expect(registry.routes.getModal(`${route.customIdPrefix}session-id`)).toBe(route);
        }

        expect(registry.routes.getModal('missing:modal')).toBeUndefined();
    });
});

function getOverlappingPrefixPairs(prefixes) {
    return prefixes.flatMap((prefix, index) =>
        prefixes
            .slice(index + 1)
            .filter((candidate) => prefix.startsWith(candidate) || candidate.startsWith(prefix))
            .map((candidate) => [prefix, candidate])
    );
}
