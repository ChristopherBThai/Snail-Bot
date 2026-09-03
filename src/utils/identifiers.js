import { ComponentType, MessageFlags } from 'discord-api-types/v10';

export const IDENTIFIERS_MAX_LENGTH = 4_000;

export function parseIdentifiers(value, normalize) {
    const identifiers = [];
    const invalid = [];

    const tokens =
        String(value ?? '')
            .toLowerCase()
            .match(/\S+/g) ?? [];
    for (const input of new Set(tokens)) {
        const identifier = normalize(input);
        if (identifier) identifiers.push(identifier);
        else invalid.push(input);
    }

    return { identifiers, invalid };
}

export function buildIdentifierBatchResponse(entries) {
    const components = [];

    for (const [label, values] of entries) {
        if (!values.length) continue;

        let content = `**${label}:**`;
        for (const value of values) {
            const text = String(value);
            const display = text.length <= 64 ? text : `${text.slice(0, 63)}…`;
            const entry = `\`${display}\``;
            const addition = `${content.endsWith('**') ? ' ' : ', '}${entry}`;

            if (content.length + addition.length <= 4_000) {
                content += addition;
            } else {
                components.push({ type: ComponentType.TextDisplay, content });
                content = `**${label} (continued):** ${entry}`;
            }
        }
        components.push({ type: ComponentType.TextDisplay, content });
    }

    return {
        flags: MessageFlags.IsComponentsV2,
        components: components.length
            ? components
            : [{ type: ComponentType.TextDisplay, content: 'No valid identifiers were provided.' }],
    };
}
