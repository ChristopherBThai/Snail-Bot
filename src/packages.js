import afk from './commands/afk.js';
import echo from './commands/echo.js';
import edit from './commands/edit.js';
import giveItem from './commands/giveItem.js';
import logs from './commands/logs.js';
import nick from './commands/nick.js';
import sendUserData from './commands/sendUserData.js';
import settingsCommand, { renderFeatureSettings } from './commands/settings.js';
import snail from './commands/snail.js';
import questList from './features/questList/index.js';
import ticketMarket from './features/ticketMarket/index.js';
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
 * @property {(choices: import('discord-api-types/v10').APIApplicationCommandOptionChoice[]) => Promise<unknown>} autocomplete Responds to application-command autocomplete.
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
 * @property {(context: InteractionContext) => import('discord-api-types/v10').APIApplicationCommandOptionChoice[] | Promise<import('discord-api-types/v10').APIApplicationCommandOptionChoice[]>} [autocomplete] Returns choices for an autocomplete interaction.
 * @property {InteractionHandler} handle
 */

/**
 * A component or modal contributed by a package.
 *
 * @typedef {object} PackageInteraction
 * @property {string} [id] Exact Discord custom ID.
 * @property {string} [prefix] Discord custom-ID prefix.
 * @property {boolean} [availableWhenDisabled] Whether a feature-owned interaction remains usable while its feature is disabled.
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
 * A page contributed to the shared feature Settings interface.
 *
 * @typedef {object} FeatureSettingsPage
 * @property {string} id Stable page ID within the feature; must not contain `:`.
 * @property {string} label Human-readable page label.
 * @property {() => import('discord-api-types/v10').APIComponentInContainer[] | Promise<import('discord-api-types/v10').APIComponentInContainer[]>} render Builds the page's Components V2 container content.
 */

/**
 * A feature's contribution to the shared Settings interface.
 *
 * @typedef {object} FeatureSettings
 * @property {FeatureSettingsPage[]} pages One to 25 pages, with the default first.
 */

/**
 * Optional feature identity and live event behavior owned by a package.
 *
 * Packages that do not need a feature ID omit this property.
 *
 * @typedef {object} PackageFeature
 * @property {string} id Stable feature ID; configurable feature IDs must not contain `:`.
 * @property {string} description Short human-readable description.
 * @property {boolean} [toggleable] Whether managers may enable and disable the feature.
 * @property {() => void | Promise<void>} [activate] Starts the enabled feature's runtime behavior.
 * @property {() => void | Promise<void>} [deactivate] Stops feature-owned runtime behavior when disabled.
 * @property {FeatureEvent[]} [events]
 * @property {FeatureSettings} [settings] Settings contribution owned by the feature.
 */

/**
 * A registered package feature with normalized runtime state.
 *
 * @typedef {object} Feature
 * @property {string} id Stable feature ID.
 * @property {string} name Human-readable feature name.
 * @property {string} description Short human-readable description.
 * @property {boolean} enabled Current persisted enabled state.
 * @property {boolean} available Whether every direct package dependency is available.
 * @property {string[]} missing Direct unavailable dependency descriptions.
 * @property {(enabled: boolean) => Promise<void>} [setEnabled] Persists and applies a new enabled state.
 * @property {(pageId?: string) => Promise<import('@discordeno/types').InteractionCallbackData>} [renderSettings] Renders this feature's Settings detail panel.
 * @property {() => void | Promise<void>} [activate] Starts the enabled feature's runtime behavior.
 * @property {() => void | Promise<void>} [deactivate] Stops runtime behavior when disabled.
 * @property {FeatureEvent[]} events Gateway events owned by the feature.
 * @property {FeatureSettings} [settings] Settings contribution owned by the feature.
 */

/**
 * Contributions returned by a package setup function.
 *
 * `missing` applies to every contribution in the package. Contributions remain
 * registered so unavailable interactions can explain their missing dependencies;
 * unavailable feature events are skipped at dispatch.
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
 * @property {ReturnType<import('./logging/index.js').createLogging>} logging Logging manager.
 * @property {ReturnType<import('./discord/rest.js').createRest>} rest Discord REST manager.
 * @property {import('./services/index.js').Services} services Initialized external services grouped by owner.
 * @property {{ snail: { mongo?: string[] }; owo: { api?: string[]; mongo?: string[]; mysql?: string[]; redis?: string[] } }} unavailable Normalized dependency failure reasons grouped like `services`.
 * @property {ReturnType<typeof createMessageBuilder>} messageBuilder Shared Message Builder system.
 * @property {Map<string, Feature>} features Registered features by ID.
 */

/** @typedef {(context: PackageContext) => Package} PackageSetup */

/** @type {PackageSetup[]} */
const PACKAGES = [snail, nick, afk, giveItem, sendUserData, echo, edit, logs, settingsCommand, questList, ticketMarket];

/**
 * Sets up installed packages and indexes their Discord contributions.
 */
export async function setupPackages({ config, logging, log, rest, services, unavailable }) {
    const commands = new Map();
    const components = new Map();
    const modals = new Map();
    const componentSources = new Map();
    const modalSources = new Map();
    const events = [];
    const Setting = services.snail.mongo?.Setting;
    const enabledByFeatureId = await loadFeatureEnabledStates(Setting);
    /** @type {Map<string, Feature>} */
    const features = new Map();

    const messageBuilder = createMessageBuilder({ config, logging, rest, services, unavailable });
    let packageCount = 0;

    for (const package_ of createPackages({
        config,
        features,
        logging,
        rest,
        services,
        unavailable,
        messageBuilder,
    })) {
        packageCount += 1;
        const missing = package_.missing ?? [];
        const contribution = package_.feature;
        let feature;

        if (contribution) {
            validateFeature(package_.name, contribution);

            if (features.has(contribution.id)) {
                throw new Error(`Duplicate feature: ${contribution.id}`);
            }

            const { toggleable, ...details } = contribution;
            feature = {
                ...details,
                name: package_.name,
                enabled: toggleable === true ? enabledByFeatureId[contribution.id] !== false : true,
                available: !missing.length,
                missing,
                events: contribution.events ?? [],
            };

            if (toggleable === true) {
                feature.setEnabled = async (enabled) => {
                    if (!feature.available) throw new Error(`Feature unavailable: ${feature.id}`);
                    if (feature.enabled === enabled) return;

                    await saveFeatureEnabledState(Setting, feature.id, enabled);
                    feature.enabled = enabled;

                    if (enabled) await feature.activate?.();
                    else await feature.deactivate?.();
                };
            }

            if (toggleable === true || feature.settings) {
                feature.renderSettings = (pageId) => renderFeatureSettings(feature, pageId);
            }

            features.set(feature.id, feature);
        }

        for (const command of package_.commands ?? []) {
            const name = command.definition.name;

            if (commands.has(name)) {
                throw new Error(`Duplicate command: ${name}`);
            }

            if (command.staff && typeof command.authorize !== 'function') {
                throw new Error(`Staff command requires authorization: ${name}`);
            }

            commands.set(name, { ...command, featureId: feature?.id, missing });
        }

        for (const [index, component] of (package_.components ?? []).entries()) {
            addInteraction({
                interactions: components,
                sources: componentSources,
                interaction: component,
                missing,
                packageName: package_.name,
                featureId: feature?.id,
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
                featureId: feature?.id,
                index,
                type: 'modal',
            });
        }

        if (feature?.available) {
            for (const event of feature.events) {
                events.push({ ...event, featureId: feature.id });
            }
        }

        if (missing.length) {
            log.warn(`${package_.name} unavailable`, {
                ...(feature ? { feature: feature.id } : {}),
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

    for (const feature of features.values()) {
        if (feature.available && feature.enabled) await feature.activate?.();
    }

    return {
        commands,
        components,
        modals,
        events,
        features,
    };
}

function validateFeature(packageName, feature) {
    if (typeof feature.id !== 'string' || !feature.id.trim()) {
        throw new Error(`${packageName} feature has an invalid ID: ${feature.id}`);
    }

    if (typeof feature.description !== 'string' || !feature.description.trim()) {
        throw new Error(`${packageName} feature must define a description`);
    }

    if ((feature.toggleable === true || feature.settings) && feature.id.includes(':')) {
        throw new Error(`${packageName} feature ID cannot contain ":": ${feature.id}`);
    }

    if (!feature.settings) return;

    if (!Array.isArray(feature.settings.pages) || !feature.settings.pages.length) {
        throw new Error(`${packageName} feature settings must define at least one page`);
    }
    if (feature.settings.pages.length > 25) {
        throw new Error(`${packageName} feature settings cannot define more than 25 pages`);
    }

    const pageIds = new Set();
    for (const page of feature.settings.pages) {
        if (typeof page.id !== 'string' || !page.id.trim() || page.id.includes(':')) {
            throw new Error(`${packageName} settings page has an invalid ID: ${page.id}`);
        }
        if (pageIds.has(page.id)) {
            throw new Error(`${packageName} has duplicate settings page ID: ${page.id}`);
        }
        if (typeof page.label !== 'string' || !page.label.trim()) {
            throw new Error(`${packageName} settings page ${page.id} must define a label`);
        }
        if (typeof page.render !== 'function') {
            throw new Error(`${packageName} settings page ${page.id} must define a render function`);
        }
        pageIds.add(page.id);
    }
}

function* createPackages(context) {
    yield context.messageBuilder;
    for (const setup of PACKAGES) yield setup(context);
}

function addInteraction({ interactions, sources, interaction, missing, packageName, featureId, index, type }) {
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

    interactions.set(key, { ...interaction, featureId, missing });
    sources.set(key, { packageName, number, kind });
}

const FEATURE_ENABLED_NAMESPACE = 'feature:enabled';

async function loadFeatureEnabledStates(Setting) {
    if (!Setting) return {};

    return Setting.loadValues(FEATURE_ENABLED_NAMESPACE);
}

async function saveFeatureEnabledState(Setting, featureId, enabled) {
    await Setting.saveValue(FEATURE_ENABLED_NAMESPACE, featureId, enabled);
}
