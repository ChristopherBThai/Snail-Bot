import nick from '../features/nick/index.js';
import snail from '../features/snail/index.js';

export const PACKAGE_REGISTRY = Object.freeze([snail, nick]);

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
    const routesById = new Map();
    const commandRoutesByName = new Map();

    for (const contribution of featureContributions) {
        featuresById.set(contribution.feature.id, contribution);
    }

    for (const route of registeredRoutes) {
        routesById.set(route.id, route);

        if (route.kind === 'command') {
            commandRoutesByName.set(route.command.name, route);
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
            commandRoutes() {
                return [...registeredCommandRoutes];
            }
        })
    });
}
