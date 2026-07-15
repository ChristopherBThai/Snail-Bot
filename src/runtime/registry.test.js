import { ApplicationCommandType } from 'discord-api-types/v10';
import { describe, expect, test } from 'vitest';
import { createRegistry, PACKAGE_REGISTRY } from './registry.js';

const FEATURE_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;
const ROUTE_ID_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*:[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

describe('createRegistry', () => {
    const context = {};

    test('allows registered packages to contribute routes without feature metadata', () => {
        const registry = createRegistry(context);
        const routeOnlyPackages = PACKAGE_REGISTRY.filter(
            (registeredPackage) => !registeredPackage.feature && typeof registeredPackage !== 'function'
        );
        const routeOnlyRouteIds = routeOnlyPackages.flatMap(
            (registeredPackage) => registeredPackage.routes?.map((route) => route.id) ?? []
        );
        const registeredRouteIds = registry.routes.list().map((route) => route.id);
        const visibleFeatureRouteIds = registry.features
            .list()
            .flatMap((contribution) => contribution.routes?.map((route) => route.id) ?? []);

        expect(routeOnlyPackages.length).toBeGreaterThan(0);
        expect(routeOnlyRouteIds.length).toBeGreaterThan(0);
        expect(registeredRouteIds).toEqual(expect.arrayContaining(routeOnlyRouteIds));
        expect(visibleFeatureRouteIds).not.toEqual(expect.arrayContaining(routeOnlyRouteIds));
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
});
