import { ComponentType, MessageFlags } from 'discord-api-types/v10';

export { ComponentType, MessageFlags };

export function componentsMessage(components, { ephemeral = false } = {}) {
    const flags = MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0);

    return {
        flags,
        components
    };
}

export function textDisplay(content) {
    return {
        type: ComponentType.TextDisplay,
        content
    };
}
