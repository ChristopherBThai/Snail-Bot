import {
    ApplicationCommandOptionType,
    ApplicationCommandType,
    ButtonStyle,
    ComponentType,
    MessageFlags,
    SeparatorSpacingSize,
} from 'discord-api-types/v10';
import { hasManagerAccess } from '../discord/auth.js';
import { getCommandOptionValue, getCustomIdSuffix, getSelectValue } from '../discord/interactions.js';
import { suppressMentions } from '../discord/messages.js';

const AUTOCOMPLETE_LIMIT = 25;
const FEATURES_PER_PAGE = 5;
const IDS = Object.freeze({
    home: 'settings:home',
    featureOpen: 'settings:open:',
    listPage: 'settings:list:',
    page: 'settings:page:',
    toggle: 'settings:toggle:',
});

const SETTINGS_COMMAND_DEFINITION = {
    type: ApplicationCommandType.ChatInput,
    name: 'settings',
    description: 'Open Snail settings.',
    options: [
        {
            type: ApplicationCommandOptionType.String,
            name: 'feature',
            description: 'Feature to configure.',
            autocomplete: true,
        },
    ],
};

/** @type {import('../packages.js').PackageSetup} */
export default function setup({ features, logging, unavailable }) {
    const log = logging.createLogger('settings');

    return {
        name: 'Settings Command',
        missing: unavailable.snail.mongo ?? [],
        commands: [
            {
                definition: SETTINGS_COMMAND_DEFINITION,
                staff: true,
                authorize: hasManagerAccess,
                autocomplete,
                async handle(context) {
                    const feature = features.get(getCommandOptionValue(context.interaction, 'feature'));
                    const message = feature?.renderSettings
                        ? await feature.renderSettings()
                        : renderSettingsHome(features);
                    await context.respond(message, { ephemeral: true });
                },
            },
        ],
        components: [
            interaction(IDS.home, openHome),
            interaction(IDS.featureOpen, openFeature, true),
            interaction(IDS.listPage, selectListPage, true),
            interaction(IDS.page, selectPage, true),
            interaction(IDS.toggle, toggleFeature, true),
        ],
    };

    function interaction(id, handle, prefix = false) {
        return {
            [prefix ? 'prefix' : 'id']: id,
            authorize: hasManagerAccess,
            handle,
        };
    }

    function autocomplete(context) {
        const value = String(getCommandOptionValue(context.interaction, 'feature') ?? '').toLowerCase();

        return getFeatures(features)
            .filter((feature) => feature.name.toLowerCase().includes(value) || feature.id.toLowerCase().includes(value))
            .slice(0, AUTOCOMPLETE_LIMIT)
            .map((feature) => ({ name: feature.name, value: feature.id }));
    }

    async function openHome(context) {
        await context.update(renderSettingsHome(features));
    }

    async function openFeature(context) {
        const featureId = getCustomIdSuffix(context.interaction, IDS.featureOpen);
        const feature = features.get(featureId);
        await context.update(feature?.renderSettings ? await feature.renderSettings() : renderSettingsHome(features));
    }

    async function selectListPage(context) {
        const listPage = getCustomIdSuffix(context.interaction, IDS.listPage);
        await context.update(renderSettingsHome(features, listPage));
    }

    async function selectPage(context) {
        const featureId = getCustomIdSuffix(context.interaction, IDS.page);
        const feature = features.get(featureId);
        await context.update(
            feature?.renderSettings
                ? await feature.renderSettings(getSelectValue(context.interaction))
                : renderSettingsHome(features),
        );
    }

    async function toggleFeature(context) {
        const [featureId, pageId, action] = getCustomIdSuffix(context.interaction, IDS.toggle).split(':');
        const feature = features.get(featureId);

        if (typeof feature?.setEnabled !== 'function' || !['disable', 'enable'].includes(action)) {
            await context.respond('That feature cannot be toggled.', { ephemeral: true });
            return;
        }

        if (!feature.available) {
            await context.respond(
                `${feature.name} is unavailable. Missing: ${feature.missing.map((value) => `\`${value}\``).join(', ')}`,
                { ephemeral: true },
            );
            return;
        }

        const timer = log.time();
        await context.deferUpdate();
        await feature.setEnabled(action === 'enable');
        timer.checkpoint('stateChange');
        const message = await feature.renderSettings(pageId);
        timer.checkpoint('render');
        await context.editResponse(message);
        timer.checkpoint('discord');
        timer.info('Changed feature enabled state', { featureId, enabled: action === 'enable' });
    }
}

/**
 * Renders one compiled feature's Settings detail panel.
 *
 * @param {import('../packages.js').Feature} feature
 * @param {string} [pageId]
 * @returns {Promise<import('@discordeno/types').InteractionCallbackData>}
 */
export async function renderFeatureSettings(feature, pageId) {
    if (!feature.available) return renderUnavailableFeature(feature);

    const page = getPage(feature, pageId);
    const content = page ? await page.render() : [];

    return panel([
        featureHeader(feature, page),
        ...(feature.settings?.pages.length > 1
            ? [
                  select(
                      `${IDS.page}${feature.id}`,
                      'Choose a page',
                      feature.settings.pages.map((candidate) => ({
                          label: candidate.label,
                          value: candidate.id,
                          default: candidate === page,
                      })),
                  ),
              ]
            : []),
        ...(page ? [separator(true), ...content] : []),
        separator(true),
        homeNavigation(),
    ]);
}

function featureHeader(feature, page) {
    const content = `# ${feature.name}\n-# ${feature.description}`;
    if (typeof feature.setEnabled !== 'function') return text(content);

    return {
        type: ComponentType.Section,
        components: [text(content)],
        accessory: {
            type: ComponentType.Button,
            customId: `${IDS.toggle}${feature.id}:${page?.id ?? ''}:${feature.enabled ? 'disable' : 'enable'}`,
            label: feature.available ? (feature.enabled ? 'Disable' : 'Enable') : 'Unavailable',
            style: !feature.available || feature.enabled ? ButtonStyle.Danger : ButtonStyle.Success,
            disabled: !feature.available,
        },
    };
}

function renderUnavailableFeature(feature) {
    return panel([
        featureHeader(feature),
        separator(true),
        text(
            `## ⚠️ Feature Unavailable\n` +
                `This feature cannot be configured or enabled because it is missing:\n` +
                feature.missing.map((missing) => `- ${missing}`).join('\n'),
        ),
        separator(true),
        homeNavigation(),
    ]);
}

function homeNavigation() {
    return {
        type: ComponentType.ActionRow,
        components: [
            {
                type: ComponentType.Button,
                customId: IDS.home,
                label: 'All Features',
                style: ButtonStyle.Secondary,
            },
        ],
    };
}

function getFeatures(features) {
    return [...features.values()]
        .filter((feature) => typeof feature.renderSettings === 'function')
        .toSorted((left, right) => left.name.localeCompare(right.name));
}

function getPage(feature, pageId) {
    return feature.settings?.pages.find((page) => page.id === pageId) ?? feature.settings?.pages[0];
}

function renderSettingsHome(features, requestedPage) {
    const configurable = getFeatures(features);
    if (!configurable.length) return panel([text('## Settings\nNo feature settings are available.')]);

    const pages = Math.ceil(configurable.length / FEATURES_PER_PAGE);
    const requested = Number.parseInt(requestedPage, 10) || 1;
    const page = Math.min(Math.max(requested, 1), pages);
    const start = (page - 1) * FEATURES_PER_PAGE;
    const visible = configurable.slice(start, start + FEATURES_PER_PAGE);

    return panel([
        text(`## Settings\n-# ${configurable.length} configurable features`),
        separator(true),
        ...visible.flatMap((feature, index) => [
            featureSection(feature),
            ...(index < visible.length - 1 ? [separator(false)] : []),
        ]),
        ...(pages > 1
            ? [
                  separator(true),
                  {
                      type: ComponentType.ActionRow,
                      components: [
                          {
                              type: ComponentType.Button,
                              customId: `${IDS.listPage}${page - 1}`,
                              label: 'Previous',
                              style: ButtonStyle.Secondary,
                              disabled: page === 1,
                          },
                          {
                              type: ComponentType.Button,
                              customId: `${IDS.listPage}${page + 1}`,
                              label: 'Next',
                              style: ButtonStyle.Secondary,
                              disabled: page === pages,
                          },
                      ],
                  },
                  text(`-# Page ${page}/${pages}`),
              ]
            : []),
    ]);
}

function featureSection(feature) {
    const status = feature.available
        ? feature.enabled
            ? 'Enabled'
            : 'Disabled'
        : `Unavailable · Missing ${feature.missing.join(', ')}`;

    return {
        type: ComponentType.Section,
        components: [text(`### ${feature.name}\n${feature.description}\n-# Status: ${status}`)],
        accessory: {
            type: ComponentType.Button,
            customId: `${IDS.featureOpen}${feature.id}`,
            label: 'Open',
            style: ButtonStyle.Secondary,
        },
    };
}

function panel(components) {
    return suppressMentions({
        flags: MessageFlags.IsComponentsV2,
        components: [{ type: ComponentType.Container, components }],
    });
}

function text(content) {
    return { type: ComponentType.TextDisplay, content };
}

function select(customId, placeholder, options) {
    return {
        type: ComponentType.ActionRow,
        components: [{ type: ComponentType.StringSelect, customId, placeholder, options }],
    };
}

function separator(divider) {
    return { type: ComponentType.Separator, divider, spacing: SeparatorSpacingSize.Small };
}
