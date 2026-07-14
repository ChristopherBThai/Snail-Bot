import { createRestManager } from '@discordeno/rest';
import { InteractionResponseType } from 'discord-api-types/v10';
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
        respond(interaction, message) {
            return request('interaction_response.failed', () =>
                rest.post(rest.routes.interactions.responses.callback(interaction.id, interaction.token), {
                    body: {
                        type: InteractionResponseType.ChannelMessageWithSource,
                        data: normalizeMessage(message)
                    },
                    runThroughQueue: false,
                    unauthorized: true
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

function normalizeMessage(message) {
    if (typeof message === 'string') {
        return componentsMessage([textDisplay(message)]);
    }

    return message;
}
