import afk from '../features/afk/index.js';
import echo from '../features/echo/index.js';
import edit from '../features/edit/index.js';
import messageBuilder from '../features/message-builder/index.js';
import nick from '../features/nick/index.js';
import snail from '../features/snail/index.js';
import tags from '../features/tag/index.js';

export const PACKAGE_REGISTRY = Object.freeze([snail, nick, afk, messageBuilder, echo, edit, tags]);

export function createRegistry(context) {
    const services = {};
    const contributions = [];

    for (const registeredPackage of PACKAGE_REGISTRY) {
        const contribution =
            typeof registeredPackage === 'function' ? registeredPackage({ ...context, services }) : registeredPackage;

        Object.assign(services, contribution.services);
        contributions.push(contribution);
    }

    const featureContributions = contributions.filter((contribution) => contribution.feature);
    const sortedFeatureContributions = [...featureContributions].sort((left, right) =>
        left.feature.name.localeCompare(right.feature.name)
    );
    const featuresById = new Map();
    const registeredRoutes = contributions.flatMap((contribution) => contribution.routes ?? []);
    const registeredCommandRoutes = registeredRoutes.filter((route) => route.kind === 'command');
    const registeredComponentRoutes = registeredRoutes.filter((route) => route.kind === 'component');
    const registeredModalRoutes = registeredRoutes.filter((route) => route.kind === 'modal');
    const routesById = new Map();
    const commandRoutesByName = new Map();
    const componentRoutesByPrefix = new Map();
    const modalRoutesByPrefix = new Map();

    for (const contribution of featureContributions) {
        featuresById.set(contribution.feature.id, contribution);
    }

    for (const route of registeredRoutes) {
        routesById.set(route.id, route);

        if (route.kind === 'command') {
            commandRoutesByName.set(route.command.name, route);
        }

        if (route.kind === 'component') {
            componentRoutesByPrefix.set(route.customIdPrefix, route);
        }

        if (route.kind === 'modal') {
            modalRoutesByPrefix.set(route.customIdPrefix, route);
        }
    }

    return Object.freeze({
        services: Object.freeze({ ...services }),
        features: Object.freeze({
            list() {
                return [...sortedFeatureContributions];
            },
            get(featureId) {
                return featuresById.get(featureId);
            }
        }),
        routes: Object.freeze({
            list() {
                return [...registeredRoutes];
            },
            get(routeId) {
                return routesById.get(routeId);
            },
            getCommand(commandName) {
                return commandRoutesByName.get(commandName);
            },
            getComponent(customId) {
                return getCustomIdRoute(componentRoutesByPrefix, customId);
            },
            getModal(customId) {
                return getCustomIdRoute(modalRoutesByPrefix, customId);
            },
            commandRoutes() {
                return [...registeredCommandRoutes];
            },
            componentRoutes() {
                return [...registeredComponentRoutes];
            },
            modalRoutes() {
                return [...registeredModalRoutes];
            }
        })
    });
}

function getCustomIdRoute(routesByPrefix, customId) {
    if (typeof customId !== 'string') {
        return undefined;
    }

    for (const [prefix, route] of routesByPrefix) {
        if (customId.startsWith(prefix)) {
            return route;
        }
    }

    return undefined;
}
