import { createGatewayManager } from '@discordeno/gateway';
import {
    ComponentType,
    GatewayDispatchEvents,
    InteractionResponseType,
    InteractionType,
    MessageFlags,
} from 'discord-api-types/v10';
import { getInteractionUser } from './interactions.js';
import { createDiscordenoLogger } from './logger.js';

/**
 * Creates Snail's Discord gateway manager and interaction dispatcher.
 */
export function createGateway({ config, token, logging, log, packages, rest }) {
    return createGatewayManager({
        token,
        logger: createDiscordenoLogger(logging.createLogger('gateway', true)),
        resharding: { enabled: false },
        events: {
            async message(_, payload) {
                for (const event of packages.events) {
                    if (event.event !== payload.t) continue;

                    try {
                        await event.handle(payload.d);
                    } catch (error) {
                        log.error('Feature event handler failed', {
                            error,
                            event: event.event,
                            feature: event.featureId,
                        });
                    }
                }

                if (payload.t === GatewayDispatchEvents.Ready) {
                    log.info('Gateway ready', {
                        userId: payload.d.user.id,
                        username: payload.d.user.username,
                    });
                    return;
                }

                if (payload.t !== GatewayDispatchEvents.InteractionCreate) return;

                const interaction = payload.d;
                const context = createInteractionContext(rest, interaction);
                let handler;
                let handlerId;
                let handlerType;

                if (interaction.type === InteractionType.ApplicationCommand) {
                    handlerId = interaction.data.name;
                    handler = packages.commands.get(handlerId);
                    handlerType = 'command';
                } else if (interaction.type === InteractionType.MessageComponent) {
                    handlerId = interaction.data.customId;
                    handler = packages.components.get(handlerId);
                    handlerType = 'component';
                } else if (interaction.type === InteractionType.ModalSubmit) {
                    handlerId = interaction.data.customId;
                    handler = packages.modals.get(handlerId);
                    handlerType = 'modal';
                }

                log.debug('Received interaction', {
                    type: interaction.type,
                    handlerId,
                });

                if (!handler) {
                    log.warn('No handler registered for interaction', {
                        type: interaction.type,
                        handlerId,
                    });
                    return;
                }

                try {
                    if (handler.missing.length) {
                        await context.respond(
                            `This interaction is unavailable. Missing: ${handler.missing.map((value) => `\`${value}\``).join(', ')}`,
                            { ephemeral: true },
                        );
                        return;
                    }

                    if (handler.authorize && !(await handler.authorize(interaction, config))) {
                        log.warn('Interaction unauthorized', {
                            type: handlerType,
                            id: handlerId,
                            userId: getInteractionUser(interaction)?.id,
                        });
                        await context.respond('You are not authorized to use this interaction.', {
                            ephemeral: true,
                        });
                        return;
                    }

                    await handler.handle(context);
                } catch (error) {
                    log.error('Interaction handler failed', {
                        error,
                        handlerId,
                    });

                    try {
                        await context.respond('Something went wrong while handling this interaction.', {
                            ephemeral: true,
                        });
                    } catch (responseError) {
                        log.error('Interaction error response failed', {
                            error: responseError,
                            handlerId,
                        });
                    }
                }
            },
        },
    });
}

function createInteractionContext(rest, interaction) {
    let responseState = 'pending';

    return {
        interaction,
        async respond(message, options) {
            const data = normalizeMessage(message, options);

            if (responseState === 'deferred') {
                const response = await rest.editOriginalInteractionResponse(interaction.token, data);
                responseState = 'responded';
                return response;
            }

            if (responseState === 'responded') {
                return rest.sendFollowupMessage(interaction.token, data);
            }

            const response = await rest.sendInteractionResponse(interaction.id, interaction.token, {
                type: InteractionResponseType.ChannelMessageWithSource,
                data,
            });
            responseState = 'responded';
            return response;
        },
        async defer({ ephemeral = false } = {}) {
            if (responseState !== 'pending') {
                throw new Error('Interaction has already been acknowledged');
            }

            const response = await rest.sendInteractionResponse(interaction.id, interaction.token, {
                type: InteractionResponseType.DeferredChannelMessageWithSource,
                data: ephemeral ? { flags: MessageFlags.Ephemeral } : undefined,
            });
            responseState = 'deferred';
            return response;
        },
        async deferUpdate() {
            if (responseState !== 'pending') {
                throw new Error('Interaction has already been acknowledged');
            }

            const response = await rest.sendInteractionResponse(interaction.id, interaction.token, {
                type: InteractionResponseType.DeferredMessageUpdate,
            });
            responseState = 'responded';
            return response;
        },
        async editResponse(message, options) {
            if (responseState === 'pending') {
                throw new Error('Interaction has not been acknowledged');
            }

            const response = await rest.editOriginalInteractionResponse(
                interaction.token,
                normalizeMessage(message, options),
            );
            responseState = 'responded';
            return response;
        },
        async update(message) {
            if (responseState !== 'pending') {
                throw new Error('Interaction has already been acknowledged');
            }

            const response = await rest.sendInteractionResponse(interaction.id, interaction.token, {
                type: InteractionResponseType.UpdateMessage,
                data: normalizeMessage(message),
            });
            responseState = 'responded';
            return response;
        },
        async openModal(modal) {
            if (responseState !== 'pending') {
                throw new Error('Interaction has already been acknowledged');
            }

            const response = await rest.sendInteractionResponse(interaction.id, interaction.token, {
                type: InteractionResponseType.Modal,
                data: modal,
            });
            responseState = 'responded';
            return response;
        },
    };
}

function normalizeMessage(message, { ephemeral = false } = {}) {
    if (typeof message === 'string') {
        return {
            components: [{ type: ComponentType.TextDisplay, content: message }],
            flags: MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
        };
    }

    return {
        ...message,
        flags: (message.flags ?? 0) | (ephemeral ? MessageFlags.Ephemeral : 0),
    };
}
