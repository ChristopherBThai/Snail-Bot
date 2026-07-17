import { createRestManager } from '@discordeno/rest';
import { InteractionResponseType, MessageFlags } from 'discord-api-types/v10';
import { componentsMessage, textDisplay } from './components.js';

export function createDiscordRest(config, { logger }) {
    const rest = createRestManager({ token: config.discord.token }).preferSnakeCase(true);

    return Object.freeze({
        syncGuildCommands(commands) {
            return request('guild_command_sync.failed', () =>
                rest.put(
                    rest.routes.interactions.commands.guilds.all(config.discord.applicationId, config.discord.guildId),
                    {
                        body: commands
                    }
                )
            );
        },
        syncGlobalCommands(commands) {
            return request('global_command_sync.failed', () =>
                rest.put(rest.routes.interactions.commands.commands(config.discord.applicationId), {
                    body: commands
                })
            );
        },
        respond(interaction, message, options) {
            return request('interaction_response.failed', () =>
                rest.post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                    body: {
                        type: InteractionResponseType.ChannelMessageWithSource,
                        data: normalizeMessage(message, options)
                    },
                    runThroughQueue: false,
                    unauthorized: true
                })
            );
        },
        updateMessage(interaction, message) {
            return request('interaction_message_update.failed', () =>
                rest.post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                    body: {
                        type: InteractionResponseType.UpdateMessage,
                        data: normalizeMessage(message)
                    },
                    runThroughQueue: false,
                    unauthorized: true
                })
            );
        },
        openModal(interaction, modal) {
            return request('interaction_modal_open.failed', () =>
                rest.post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                    body: {
                        type: InteractionResponseType.Modal,
                        data: modal
                    },
                    runThroughQueue: false,
                    unauthorized: true
                })
            );
        },
        autocomplete(interaction, choices) {
            return request('autocomplete_response.failed', () =>
                rest.post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                    body: {
                        type: InteractionResponseType.ApplicationCommandAutocompleteResult,
                        data: {
                            choices
                        }
                    },
                    runThroughQueue: false,
                    unauthorized: true
                })
            );
        },
        sendMessage(channelId, message) {
            return request('channel_message_send.failed', () =>
                rest.post(rest.routes.channels.messages(channelId), {
                    body: normalizeMessage(message)
                })
            );
        },
        editMessage(channelId, messageId, message) {
            return request('channel_message_update.failed', () =>
                rest.patch(rest.routes.channels.message(channelId, messageId), {
                    body: normalizeMessage(message)
                })
            );
        },
        createFollowupMessage(interaction, message, options) {
            return request('interaction_followup_send.failed', () =>
                rest.post(
                    rest.routes.webhooks.webhook(config.discord.applicationId, interaction.token, { wait: true }),
                    {
                        body: normalizeMessage(message, options),
                        unauthorized: true
                    }
                )
            );
        },
        editFollowupMessage(token, messageId, message) {
            return request('interaction_followup_update.failed', () =>
                rest.patch(rest.routes.webhooks.message(config.discord.applicationId, token, messageId), {
                    body: normalizeMessage(message),
                    unauthorized: true
                })
            );
        },
        editOriginalResponse(token, message) {
            return request('interaction_original_response_update.failed', () =>
                rest.patch(rest.routes.webhooks.original(config.discord.applicationId, token), {
                    body: normalizeMessage(message),
                    unauthorized: true
                })
            );
        },
        editBotNickname(guildId, nickname) {
            return request('bot_nickname_update.failed', () =>
                rest.patch(rest.routes.guilds.members.bot(guildId), {
                    body: {
                        nick: nickname
                    }
                })
            );
        },
        addMemberRole(guildId, userId, roleId, reason) {
            return request('member_role_add.failed', () =>
                rest.put(rest.routes.guilds.roles.member(guildId, userId, roleId), {
                    reason
                })
            );
        },
        removeMemberRole(guildId, userId, roleId, reason) {
            return request('member_role_remove.failed', () =>
                rest.delete(rest.routes.guilds.roles.member(guildId, userId, roleId), {
                    reason
                })
            );
        }
    });

    async function request(event, callback) {
        try {
            return await callback();
        } catch (error) {
            logger.error(event, {
                errorName: error.name,
                errorMessage: error.message,
                status: error.cause?.status,
                body: error.cause?.body
            });
            throw error;
        }
    }
}

function normalizeMessage(message, options) {
    if (typeof message === 'string') {
        return componentsMessage([textDisplay(message)], options);
    }

    if (options?.ephemeral) {
        return {
            ...message,
            flags: (message.flags ?? 0) | MessageFlags.Ephemeral
        };
    }

    return message;
}
