import { createGatewayManager } from '@discordeno/gateway';
import { GatewayDispatchEvents, InteractionType } from 'discord-api-types/v10';
import { getModalValues } from './utils.js';

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
                const route = getInteractionRoute(routes, interaction);

                if (!route) {
                    logger.warn('interaction_route.missing', {
                        interactionId: interaction.id,
                        interactionType: interaction.type,
                        commandName: interaction.data?.name
                    });
                    if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
                        await rest.autocomplete(interaction, []);
                        return;
                    }
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
                        if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
                            await rest.autocomplete(interaction, []);
                            return;
                        }
                        await respondWithErrorMessage({
                            interaction,
                            logger,
                            rest,
                            content: 'You do not have permission to use that command.'
                        });
                        return;
                    }

                    if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
                        await rest.autocomplete(interaction, await route.autocomplete(context));
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
        applicationId: config.discord.applicationId,
        customId: data.custom_id,
        data,
        interaction,
        commandName: data.name,
        channelId: interaction.channel_id,
        guildId: interaction.guild_id,
        memberRoles: interaction.member?.roles ?? [],
        modalValues: getModalValues(data.components ?? []),
        target: getInteractionTarget(data),
        userId: interaction.member?.user?.id ?? interaction.user?.id,
        values: data.values ?? [],
        editBotNickname(guildId, nickname) {
            return rest.editBotNickname(guildId, nickname);
        },
        addMemberRole(guildId, userId, roleId, reason) {
            return rest.addMemberRole(guildId, userId, roleId, reason);
        },
        removeMemberRole(guildId, userId, roleId, reason) {
            return rest.removeMemberRole(guildId, userId, roleId, reason);
        },
        sendMessage(channelId, message) {
            return rest.sendMessage(channelId, message);
        },
        editMessage(channelId, messageId, message) {
            return rest.editMessage(channelId, messageId, message);
        },
        createFollowupMessage(message, options) {
            return rest.createFollowupMessage(interaction, message, options);
        },
        editFollowupMessage(messageId, message, token = interaction.token) {
            return rest.editFollowupMessage(token, messageId, message);
        },
        editOriginalResponse(message, token = interaction.token) {
            return rest.editOriginalResponse(token, message);
        },
        updateMessage(message) {
            return rest.updateMessage(interaction, message);
        },
        openModal(modal) {
            return rest.openModal(interaction, modal);
        },
        respond(message, options) {
            return rest.respond(interaction, message, options);
        },
        autocomplete(choices) {
            return rest.autocomplete(interaction, choices);
        }
    });
}

function getInteractionTarget(data) {
    return {
        id: data.target_id,
        member: data.target_id ? data.resolved?.members?.[data.target_id] : undefined,
        message: data.target_id ? data.resolved?.messages?.[data.target_id] : undefined,
        user: data.target_id ? data.resolved?.users?.[data.target_id] : undefined
    };
}

function getInteractionRoute(routes, interaction) {
    if (
        interaction.type === InteractionType.ApplicationCommand ||
        interaction.type === InteractionType.ApplicationCommandAutocomplete
    ) {
        return routes.getCommand(interaction.data?.name);
    }

    if (interaction.type === InteractionType.MessageComponent) {
        return routes.getComponent(interaction.data?.custom_id);
    }

    if (interaction.type === InteractionType.ModalSubmit) {
        return routes.getModal(interaction.data?.custom_id);
    }

    return undefined;
}
