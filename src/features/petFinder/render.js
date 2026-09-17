import { ButtonStyle, ComponentType, MessageFlags, SeparatorSpacingSize } from 'discord-api-types/v10';
import { COLORS } from '../../discord/colors.js';
import { disableComponents } from '../../discord/interactions.js';
import { suppressMentions } from '../../discord/messages.js';
import { STATS } from './pets.js';

export const PANEL_PREFIX = 'petFinder:';
const customId = (panel, action) => `${PANEL_PREFIX}${panel.id}:${action}`;

export function pageSize(panel) {
    return panel.compact ? 40 : 8;
}

/** Receives prepared matches; rendering does not query or filter the inventory. */
export function buildPanel(panel, emojis) {
    if (panel.expired) return buildExpiredPanel(buildPanel({ ...panel, expired: false }, emojis));
    if (panel.state === 'closed') return message([text(`## Pet Finder\n${panel.notice}`)]);
    if (panel.state === 'pending')
        return message([
            text(
                `## Pet Finder request\n<@${panel.ownerId}>, <@${panel.userId}> wants to view and filter your pets and levels in this channel. Accept to show them here. You can revoke access from this panel.`,
            ),
            separator(),
            row(
                button(panel, 'allow', 'Accept'),
                button(panel, 'decline', 'Decline'),
                button(panel, 'cancel', 'Cancel Request'),
            ),
            text(`-# ${expires(panel)}`),
        ]);
    const size = pageSize(panel);
    const pages = Math.ceil(panel.pets.length / size);
    const owner = panel.all ? 'All pets' : `${escape(panel.ownerName)}’s pets`;
    const filters = formatStats(
        STATS.map((stat) => {
            const range = panel.preset.filters[stat];
            if (!range) return '*';
            if (range.min === range.max) return String(range.min);
            return `${range.min ?? '*'}-${range.max ?? '*'}`;
        }),
        emojis,
    );
    const results = panel.pets
        .slice(panel.page * size, panel.page * size + size)
        .map((pet) =>
            panel.compact
                ? `\`${pet.alias.slice(0, 70).replace(/[`\r\n]/g, ' ')}\``
                : `**${escape(pet.alias)}**` +
                  (panel.all ? '\n' : ` · ${pet.level === undefined ? 'Level unavailable' : `Level ${pet.level}`}\n`) +
                  formatStats(
                      STATS.map((stat) => String(pet[stat])),
                      emojis,
                  ),
        )
        .join(panel.compact ? ' ' : '\n\n');
    return message([
        {
            type: ComponentType.Section,
            components: [text(`## Pet Finder\n${owner} · **${panel.pets.length}/${panel.total} pets match**`)],
            accessory: button(panel, 'help', 'Preset Help'),
        },
        separator(false),
        text(
            results ||
                (panel.total
                    ? 'No pets match these filters.'
                    : panel.all
                      ? 'No pets in the catalog.'
                      : 'No owned pets.'),
        ),
        ...(panel.omitted ? [text(`-# ${panel.omitted} pets could not be loaded.`)] : []),
        ...(pages > 1
            ? [
                  separator(),
                  row(
                      button(panel, 'previous', '← Previous', panel.page === 0),
                      button(panel, 'page', `Page ${panel.page + 1} of ${pages}`, true),
                      button(panel, 'next', 'Next →', panel.page === pages - 1),
                  ),
              ]
            : []),
        separator(true, SeparatorSpacingSize.Large),
        {
            type: ComponentType.Section,
            components: [text(`### Filters\n\`${panel.presetString}\`\n\n${filters}`), text(`-# Sort: ${sortLabel(panel.preset.sort)}`)],
            accessory: button(panel, 'setPreset', 'Set Preset'),
        },
        row(
            button(panel, 'compact', `Compact: ${panel.compact ? 'On' : 'Off'}`),
            ...(!panel.all && panel.ownerId !== panel.userId ? [button(panel, 'revoke', 'Revoke Access')] : []),
        ),
        text(`-# ${expires(panel)}`),
    ]);
}

export function buildPresetHelp() {
    return message([
        text(
            '## Pet Presets\n' +
                'Use `/pets` with an optional `preset` to set filters and sorting.\n\n' +
                '**Order:** `HP ATT PR WP MAG MR [sort]`\n' +
                'Include all six stats, separated by spaces. Up to 50 characters.\n\n' +
                '- `*` — any value\n' +
                '- `5` — exactly 5\n' +
                '- `4-8` — 4 through 8\n' +
                '- `5-*` — at least 5\n' +
                '- `*-3` — at most 3\n\n' +
                '**Sorting (optional):** `name.asc`, `level.asc`, `level.desc`, or any stat followed by `.asc` or `.desc`.\n' +
                'Ascending puts lower values first; descending puts higher values first. Defaults to `name.asc`.\n\n' +
                'Use `all: true` to search the full catalog. Catalog pets have no levels, so use name or stat sorting.\n\n' +
                '**Example:**\n```text\n5 4-8 * 2 * *-3 level.desc\n```\n' +
                'Omit the preset to show all pets. Use **Set Preset** to import different filters and reload your pets.',
        ),
    ]);
}

function formatStats(values, emojis) {
    const widths = values.slice(0, 3).map((value, column) => Math.max(value.length, values[column + 3].length));
    const cells = STATS.map((stat, index) => `${emojis[stat]} \`${values[index].padEnd(widths[index % 3])}\``);
    return `${cells.slice(0, 3).join(' ')}\n${cells.slice(3).join(' ')}`;
}

function sortLabel(sort) {
    if (sort === 'name.asc') return 'Name A–Z';
    const [key, direction] = sort.split('.');
    return `${key === 'level' ? 'Level' : key.toUpperCase()} ${direction === 'asc' ? 'low to high' : 'high to low'}`;
}

function message(components) {
    return suppressMentions({
        flags: MessageFlags.IsComponentsV2,
        components: [{ type: ComponentType.Container, accentColor: COLORS.primary, components }],
    });
}
function text(content) {
    return { type: ComponentType.TextDisplay, content };
}
function row(...components) {
    return { type: ComponentType.ActionRow, components };
}
function separator(divider = true, spacing = SeparatorSpacingSize.Small) {
    return { type: ComponentType.Separator, divider, spacing };
}
function button(panel, action, label, disabled = false) {
    return {
        type: ComponentType.Button,
        customId: customId(panel, action),
        label,
        disabled,
        style: action === 'allow' ? ButtonStyle.Primary : ButtonStyle.Secondary,
    };
}
function expires(panel) {
    return `Expires <t:${Math.floor(panel.expiresAt / 1000)}:R>`;
}
function escape(value) {
    return value
        .slice(0, 70)
        .replace(/[\\`*_~|<>\[\]#]/g, '\\$&')
        .replace(/[\r\n]/g, ' ');
}

export function buildExpiredPanel(panelMessage) {
    const components = disableComponents(panelMessage.components);
    const content = components[0].components;
    const footer = content.find((component) => component.content?.startsWith('-# Expires '));
    if (footer) footer.content = '-# Expired';
    else content.push(text('-# Expired'));
    return suppressMentions({ flags: MessageFlags.IsComponentsV2, components });
}
