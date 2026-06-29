import { createRestManager } from '@discordeno/rest';
import { InteractionResponseType, MessageFlags } from 'discord-api-types/v10';
import { getCommandDefinition } from './commands.js';
import { componentsMessage, textDisplay } from './components.js';

export function createDiscordRest(token, { applicationId, logger } = {}) {
    const rest = createRestManager({ token }).preferSnakeCase(true);
    rest.applicationId = applicationId;
    const logAndThrow = (type) => (error) => {
        logger.error(type, {
            error,
            status: error?.cause?.status,
            body: error?.cause?.body
        });
        throw error;
    };

    return {
        async syncGuildCommands(applicationId, guildId, commands) {
            return await rest
                .put(rest.routes.interactions.commands.guilds.all(applicationId, guildId), {
                    body: commands.map(getCommandDefinition)
                })
                .catch(logAndThrow('discord.command_sync.failed'));
        },

        async respond(interaction, message) {
            const { files, ...responseData } = normalizeMessage(message);

            await rest
                .post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                    body: {
                        type: InteractionResponseType.ChannelMessageWithSource,
                        data: responseData
                    },
                    files,
                    runThroughQueue: false,
                    unauthorized: true
                })
                .catch(logAndThrow('discord.interaction.respond_failed'));
        },

        async autocomplete(interaction, choices) {
            await rest
                .post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                    body: {
                        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
                        data: { choices }
                    },
                    runThroughQueue: false,
                    unauthorized: true
                })
                .catch(logAndThrow('discord.interaction.autocomplete_failed'));
        },

        async defer(interaction, { ephemeral = false } = {}) {
            await rest
                .post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                    body: {
                        type: InteractionResponseType.DeferredChannelMessageWithSource,
                        data: ephemeral ? { flags: MessageFlags.Ephemeral } : undefined
                    },
                    runThroughQueue: false,
                    unauthorized: true
                })
                .catch(logAndThrow('discord.interaction.defer_failed'));
        },

        async deferUpdate(interaction) {
            await rest
                .post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                    body: {
                        type: InteractionResponseType.DeferredMessageUpdate
                    },
                    runThroughQueue: false,
                    unauthorized: true
                })
                .catch(logAndThrow('discord.interaction.defer_update_failed'));
        },

        async editReply(interaction, message) {
            return await rest
                .editOriginalInteractionResponse(interaction.token, normalizeMessage(message))
                .catch(logAndThrow('discord.interaction.edit_reply_failed'));
        },

        async followUp(interaction, message) {
            return await rest
                .sendFollowupMessage(interaction.token, normalizeMessage(message))
                .catch(logAndThrow('discord.interaction.followup_failed'));
        },

        async edit(interaction, message) {
            const { files, ...responseData } = normalizeMessage(message);

            await rest
                .post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                    body: {
                        type: InteractionResponseType.UpdateMessage,
                        data: responseData
                    },
                    files,
                    runThroughQueue: false,
                    unauthorized: true
                })
                .catch(logAndThrow('discord.interaction.edit_failed'));
        },

        async openModal(interaction, modal) {
            await rest
                .post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                    body: {
                        type: InteractionResponseType.Modal,
                        data: modal
                    },
                    runThroughQueue: false,
                    unauthorized: true
                })
                .catch(logAndThrow('discord.interaction.modal_failed'));
        },

        async sendMessage(channelID, message) {
            return await rest
                .sendMessage(channelID, normalizeMessage(message))
                .catch(logAndThrow('discord.message.send_failed'));
        },

        async editMessage(channelID, messageID, message) {
            return await rest
                .editMessage(channelID, messageID, normalizeMessage(message))
                .catch(logAndThrow('discord.message.edit_failed'));
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
        attachments:
            normalized.attachments ??
            normalized.files.map((file, index) => ({
                id: index.toString(),
                filename: file.name
            }))
    };
}
