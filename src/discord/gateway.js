import { createGatewayManager } from '@discordeno/gateway';
import { GatewayDispatchEvents, InteractionType } from 'discord-api-types/v10';
import { componentsMessage, textDisplay } from './components.js';

export async function startGateway({ config, logger, routes, rest }) {
    const gateway = createGatewayManager({
        token: config.discord.token,
        preferSnakeCase: true,
        resharding: { enabled: false },
        events: {
            async message(_shard, payload) {
                if (payload.t === GatewayDispatchEvents.Ready) {
                    logger.info('ready.received', {
                        id: payload.d.user.id,
                        username: payload.d.user.username
                    });
                    return;
                }

                if (payload.t !== GatewayDispatchEvents.InteractionCreate) {
                    return;
                }

                const interaction = payload.d;
                const route =
                    interaction.type === InteractionType.ApplicationCommand
                        ? routes.getCommand(interaction.data?.name)
                        : undefined;

                if (!route) {
                    logger.warn('interaction_route.missing', {
                        interactionId: interaction.id,
                        interactionType: interaction.type,
                        commandName: interaction.data?.name
                    });
                    await respondWithErrorMessage({
                        interaction,
                        logger,
                        rest,
                        content: 'That interaction is no longer available.'
                    });
                    return;
                }

                try {
                    await route.handle(createInteractionContext({ interaction, rest }));
                } catch (error) {
                    logger.error('interaction_handler.failed', {
                        commandName: interaction.data?.name,
                        error
                    });
                    await respondWithErrorMessage({
                        interaction,
                        logger,
                        rest,
                        content: 'Something went wrong while handling that interaction.'
                    });
                }
            }
        }
    });

    await gateway.spawnShards();

    return gateway;
}

async function respondWithErrorMessage({ interaction, logger, rest, content }) {
    try {
        await rest.respond(
            interaction,
            componentsMessage([textDisplay(content)], {
                ephemeral: true
            })
        );
    } catch (error) {
        logger.error('interaction_error_response.failed', {
            commandName: interaction.data?.name,
            error
        });
    }
}

function createInteractionContext({ interaction, rest }) {
    const data = interaction.data ?? {};

    return Object.freeze({
        data,
        interaction,
        commandName: data.name,
        channelId: interaction.channel_id,
        guildId: interaction.guild_id,
        userId: interaction.member?.user?.id ?? interaction.user?.id,
        respond(message) {
            return rest.respond(interaction, message);
        }
    });
}
