import { ComponentType, MessageFlags } from 'discord-api-types/v10';

export function normalizeMessage(message, { ephemeral = false } = {}) {
    if (typeof message === 'string') {
        return {
            allowedMentions: { parse: [] },
            components: [{ type: ComponentType.TextDisplay, content: message }],
            flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
        };
    }

    return {
        ...message,
        allowedMentions: message.allowedMentions ?? { parse: [] },
        flags: (message.flags ?? 0) | (ephemeral ? MessageFlags.Ephemeral : 0),
    };
}

export function getMessageJumpLink({ guildId, channelId, messageId }) {
    return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}

export function suppressMentions(message) {
    return {
        ...message,
        allowedMentions: { parse: [] },
    };
}
