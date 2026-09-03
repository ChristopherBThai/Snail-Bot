import { ButtonStyle, ComponentType } from 'discord-api-types/v10';

export const TAG_ID_MAX_LENGTH = 64;

export function normalizeTagId(value) {
    const tagId = String(value ?? '')
        .trim()
        .toLowerCase();
    return tagId.length <= TAG_ID_MAX_LENGTH && /^[a-z]+$/.test(tagId) ? tagId : undefined;
}

export function extractMessageText(message) {
    return collectText(message.components ?? [])
        .join('\n')
        .trim();
}

function collectText(components) {
    const lines = [];

    for (const component of components) {
        if (component.type === ComponentType.TextDisplay && component.content?.trim()) {
            lines.push(component.content.trim());
        }
        if (component.type === ComponentType.Button && component.style === ButtonStyle.Link && component.url) {
            lines.push(`${component.label ?? component.url}: ${component.url}`);
        }
        if (component.components) lines.push(...collectText(component.components));
        if (component.accessory) lines.push(...collectText([component.accessory]));
    }

    return lines;
}
