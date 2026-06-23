import { createRestManager } from '@discordeno/rest';
import { InteractionResponseType, MessageFlags } from 'discord-api-types/v10';
import { getCommandDefinition } from './commands.js';
import { componentsMessage, textDisplay } from './components.js';

export function createDiscordRest(token) {
    const rest = createRestManager({ token }).preferSnakeCase(true);

    return {
        async syncGuildCommands(applicationId, guildId, commands) {
            await rest.put(rest.routes.interactions.commands.guilds.all(applicationId, guildId), {
                body: commands.map(getCommandDefinition)
            });
        },

        async respond(interaction, message) {
            const { files, ...responseData } = normalizeMessage(message);

            await rest.post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                body: {
                    type: InteractionResponseType.ChannelMessageWithSource,
                    data: responseData
                },
                files,
                runThroughQueue: false,
                unauthorized: true
            });
        },

        async autocomplete(interaction, choices) {
            await rest.post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                body: {
                    type: InteractionResponseType.ApplicationCommandAutocompleteResult,
                    data: { choices }
                },
                runThroughQueue: false,
                unauthorized: true
            });
        },

        async defer(interaction, { ephemeral = false } = {}) {
            await rest.post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                body: {
                    type: InteractionResponseType.DeferredChannelMessageWithSource,
                    data: ephemeral ? { flags: MessageFlags.Ephemeral } : undefined
                },
                runThroughQueue: false,
                unauthorized: true
            });
        },

        async editReply(interaction, message) {
            return await rest.editOriginalInteractionResponse(interaction.token, normalizeMessage(message));
        },

        async edit(interaction, message) {
            const { files, ...responseData } = normalizeMessage(message);

            await rest.post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                body: {
                    type: InteractionResponseType.UpdateMessage,
                    data: responseData
                },
                files,
                runThroughQueue: false,
                unauthorized: true
            });
        },

        async openModal(interaction, modal) {
            await rest.post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                body: {
                    type: InteractionResponseType.Modal,
                    data: modal
                },
                runThroughQueue: false,
                unauthorized: true
            });
        },

        async sendMessage(channelID, message) {
            return await rest.sendMessage(channelID, normalizeMessage(message));
        },

        async editMessage(channelID, messageID, message) {
            return await rest.editMessage(channelID, messageID, normalizeMessage(message));
        }
    };
}

export function normalizeMessage(message) {
    const normalized = typeof message === 'string' ? componentsMessage(textDisplay(message)) : message;

    if (!normalized.files?.length) {
        return normalized;
    }

    return {
        ...normalized,
        attachments: normalized.files.map((file, index) => ({
            id: index.toString(),
            filename: file.name
        }))
    };
}
