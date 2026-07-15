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
        editBotNickname(guildId, nickname) {
            return request('bot_nickname_update.failed', () =>
                rest.patch(rest.routes.guilds.members.bot(guildId), {
                    body: {
                        nick: nickname
                    }
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
