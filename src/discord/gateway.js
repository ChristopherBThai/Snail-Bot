import { createGatewayManager } from '@discordeno/gateway';
import { GatewayDispatchEvents, InteractionType } from 'discord-api-types/v10';

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

                const context = createInteractionContext({ config, interaction, rest });

                try {
                    if (route.authorize && !(await route.authorize(context))) {
                        logger.warn('interaction_route.unauthorized', {
                            interactionId: interaction.id,
                            commandName: interaction.data?.name,
                            routeId: route.id,
                            userId: context.userId
                        });
                        await respondWithErrorMessage({
                            interaction,
                            logger,
                            rest,
                            content: 'You do not have permission to use that command.'
                        });
                        return;
                    }

                    await route.handle(context);
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
        await rest.respond(interaction, content, { ephemeral: true });
    } catch (error) {
        logger.error('interaction_error_response.failed', {
            commandName: interaction.data?.name,
            error
        });
    }
}

function createInteractionContext({ config, interaction, rest }) {
    const data = interaction.data ?? {};

    return Object.freeze({
        config,
        data,
        interaction,
        commandName: data.name,
        channelId: interaction.channel_id,
        guildId: interaction.guild_id,
        memberRoles: interaction.member?.roles ?? [],
        userId: interaction.member?.user?.id ?? interaction.user?.id,
        editBotNickname(guildId, nickname) {
            return rest.editBotNickname(guildId, nickname);
        },
        addMemberRole(guildId, userId, roleId, reason) {
            return rest.addMemberRole(guildId, userId, roleId, reason);
        },
        removeMemberRole(guildId, userId, roleId, reason) {
            return rest.removeMemberRole(guildId, userId, roleId, reason);
        },
        respond(message, options) {
            return rest.respond(interaction, message, options);
        }
    });
}
