import afk from './commands/afk.js';
import giveItem from './commands/giveItem.js';
import nick from './commands/nick.js';
import sendUserData from './commands/sendUserData.js';
import snail from './commands/snail.js';

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
 * @property {string} id Discord custom ID.
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
 * @property {{ owo: { api?: string[]; mysql?: string[] } }} unavailable Normalized dependency failure reasons grouped like `services`.
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
    const events = [];
    const features = new Set();

    for (const setup of PACKAGES) {
        const package_ = setup({ config, logging, rest, services, unavailable });
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

        for (const component of package_.components ?? []) {
            if (components.has(component.id)) {
                throw new Error(`Duplicate component: ${component.id}`);
            }

            components.set(component.id, { ...component, missing });
        }

        for (const modal of package_.modals ?? []) {
            if (modals.has(modal.id)) {
                throw new Error(`Duplicate modal: ${modal.id}`);
            }

            modals.set(modal.id, { ...modal, missing });
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
        packages: PACKAGES.length,
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
