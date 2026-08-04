import afk from './commands/afk.js';
import giveItem from './commands/giveItem.js';
import nick from './commands/nick.js';
import sendUserData from './commands/sendUserData.js';
import snail from './commands/snail.js';
import createMessageBuilder from './systems/messageBuilder/index.js';

/**
 * A camel-cased Discord interaction received through Discordeno Gateway.
 *
 * @typedef {import('@discordeno/types').Camelize<import('@discordeno/types').DiscordInteraction>} Interaction
 */

/**
 * A Discord interaction handler contributed by a package.
 *
 * @typedef {object} InteractionContext
 * @property {Interaction} interaction Raw Discord interaction.
 * @property {(message: string | import('@discordeno/types').InteractionCallbackData, options?: { ephemeral?: boolean }) => Promise<unknown>} respond Sends, edits, or follows up according to the interaction's response state.
 * @property {(options?: { ephemeral?: boolean }) => Promise<unknown>} defer Defers the initial interaction response.
 * @property {() => Promise<unknown>} deferUpdate Defers an update to a component's message.
 * @property {(message: string | import('@discordeno/types').InteractionCallbackData, options?: { ephemeral?: boolean }) => Promise<unknown>} editResponse Edits an acknowledged interaction's original response.
 * @property {(message: string | import('@discordeno/types').InteractionCallbackData) => Promise<unknown>} update Updates the message that produced a component or modal interaction.
 * @property {(modal: import('@discordeno/types').InteractionCallbackData) => Promise<unknown>} openModal Opens a modal in response to an interaction.
 */

/**
 * @typedef {(context: InteractionContext) => void | Promise<void>} InteractionHandler
 */

/**
 * A command contributed by a package.
 *
 * @typedef {object} PackageCommand
 * @property {import('@discordeno/types').CreateApplicationCommand} definition Discord application command definition.
 * @property {boolean} [global] Whether the command is synchronized globally instead of to the configured guild.
 * @property {boolean} [staff] Whether Discord should limit default visibility to staff.
 * @property {(interaction: Interaction, config: Record<string, unknown>) => boolean | Promise<boolean>} [authorize] Runtime authorization check.
 * @property {InteractionHandler} handle
 */

/**
 * A component or modal contributed by a package.
 *
 * @typedef {object} PackageInteraction
 * @property {string} [id] Exact Discord custom ID.
 * @property {string} [prefix] Discord custom-ID prefix.
 * @property {(interaction: Interaction, config: Record<string, unknown>) => boolean | Promise<boolean>} [authorize] Runtime authorization check.
 * @property {InteractionHandler} handle
 */

/**
 * A gateway event contributed by a feature.
 *
 * @typedef {object} FeatureEvent
 * @property {string} event Gateway dispatch event name.
 * @property {(data: object) => void | Promise<void>} handle
 */

/**
 * Optional feature identity and live event behavior owned by a package.
 *
 * Packages that do not need a feature ID omit this property.
 *
 * @typedef {object} PackageFeature
 * @property {string} id Stable feature ID.
 * @property {FeatureEvent[]} [events]
 */

/**
 * Contributions returned by a package setup function.
 *
 * `missing` applies to every contribution in the package. Unavailable commands,
 * components, and modals remain registered, while feature events are omitted.
 *
 * @typedef {object} Package
 * @property {string} name Human-readable name used in diagnostics.
 * @property {string[]} [missing] Missing configuration or dependency names.
 * @property {PackageCommand[]} [commands]
 * @property {PackageInteraction[]} [components]
 * @property {PackageInteraction[]} [modals]
 * @property {PackageFeature} [feature]
 */

/**
 * Dependencies available while setting up a package.
 *
 * @typedef {object} PackageContext
 * @property {Record<string, unknown>} config Public configuration values.
 * @property {object} logging Logging manager.
 * @property {ReturnType<import('./discord/rest.js').createRest>} rest Discord REST manager.
 * @property {import('./services/index.js').Services} services Initialized external services grouped by owner.
 * @property {{ snail: { mongo?: string[] }; owo: { api?: string[]; mysql?: string[] } }} unavailable Normalized dependency failure reasons grouped like `services`.
 * @property {ReturnType<typeof createMessageBuilder>} messageBuilder Shared Message Builder system.
 */

/** @typedef {(context: PackageContext) => Package} PackageSetup */

/** @type {PackageSetup[]} */
const PACKAGES = [snail, nick, afk, giveItem, sendUserData];

/**
 * Sets up installed packages and indexes their Discord contributions.
 */
export function setupPackages({ config, logging, log, rest, services, unavailable }) {
    const commands = new Map();
    const components = new Map();
    const modals = new Map();
    const componentSources = new Map();
    const modalSources = new Map();
    const events = [];
    const features = new Set();

    const messageBuilder = createMessageBuilder({ config, logging, rest, services, unavailable });
    let packageCount = 0;

    for (const package_ of createPackages({ config, logging, rest, services, unavailable, messageBuilder })) {
        packageCount += 1;
        const missing = package_.missing ?? [];

        for (const command of package_.commands ?? []) {
            const name = command.definition.name;

            if (commands.has(name)) {
                throw new Error(`Duplicate command: ${name}`);
            }

            if (command.staff && typeof command.authorize !== 'function') {
                throw new Error(`Staff command requires authorization: ${name}`);
            }

            commands.set(name, { ...command, missing });
        }

        for (const [index, component] of (package_.components ?? []).entries()) {
            addInteraction({
                interactions: components,
                sources: componentSources,
                interaction: component,
                missing,
                packageName: package_.name,
                index,
                type: 'component',
            });
        }

        for (const [index, modal] of (package_.modals ?? []).entries()) {
            addInteraction({
                interactions: modals,
                sources: modalSources,
                interaction: modal,
                missing,
                packageName: package_.name,
                index,
                type: 'modal',
            });
        }

        if (package_.feature) {
            if (features.has(package_.feature.id)) {
                throw new Error(`Duplicate feature: ${package_.feature.id}`);
            }

            features.add(package_.feature.id);

            if (!missing.length) {
                for (const event of package_.feature.events ?? []) {
                    events.push({ ...event, featureId: package_.feature.id });
                }
            }
        }

        if (missing.length) {
            log.warn(`${package_.name} unavailable`, {
                ...(package_.feature ? { feature: package_.feature.id } : {}),
                missing,
            });
        }
    }

    log.debug('Loaded packages', {
        packages: packageCount,
        features: features.size,
        commands: commands.size,
        components: components.size,
        modals: modals.size,
        events: events.length,
    });

    return {
        commands,
        components,
        modals,
        events,
    };
}

function* createPackages(context) {
    yield context.messageBuilder;
    for (const setup of PACKAGES) yield setup(context);
}

function addInteraction({ interactions, sources, interaction, missing, packageName, index, type }) {
    const number = index + 1;
    const hasId = Boolean(interaction.id);
    const hasPrefix = Boolean(interaction.prefix);

    if (hasId === hasPrefix) {
        const received = hasId
            ? `received id "${interaction.id}" and prefix "${interaction.prefix}"`
            : 'received neither';

        throw new Error(`${packageName} ${type} #${number} must define exactly one of id or prefix; ${received}`);
    }

    const key = interaction.id ?? interaction.prefix;
    const kind = interaction.id ? 'id' : 'prefix';

    for (const [existingKey, existing] of interactions) {
        const overlaps =
            key === existingKey ||
            (interaction.prefix && existingKey.startsWith(interaction.prefix)) ||
            (existing.prefix && key.startsWith(existing.prefix));

        if (!overlaps) continue;

        const existingSource = sources.get(existingKey);
        throw new Error(
            `${packageName} ${type} #${number} ${kind} "${key}" overlaps ` +
                `${existingSource.packageName} ${type} #${existingSource.number} ` +
                `${existingSource.kind} "${existingKey}"`,
        );
    }

    interactions.set(key, { ...interaction, missing });
    sources.set(key, { packageName, number, kind });
}
