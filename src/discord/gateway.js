import { createGatewayManager } from '@discordeno/gateway';
import {
    GatewayDispatchEvents,
    GatewayIntentBits,
    InteractionResponseType,
    InteractionType,
    MessageFlags,
} from 'discord-api-types/v10';
import { getInteractionUser } from './interactions.js';
import { createDiscordenoLogger } from './logger.js';
import { normalizeMessage } from './messages.js';

/**
 * Creates Snail's Discord gateway manager and interaction dispatcher.
 */
export function createGateway({ config, token, logging, log, packages, rest }) {
    return createGatewayManager({
        token,
        intents: GatewayIntentBits.Guilds | GatewayIntentBits.GuildMessages,
        logger: createDiscordenoLogger(logging.createLogger('gateway', true)),
        resharding: { enabled: false },
        events: {
            async message(_, payload) {
                for (const event of packages.events) {
                    if (event.event !== payload.t) continue;
                    const feature = packages.features.get(event.featureId);
                    if (!feature.enabled) continue;

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
                const autocomplete = interaction.type === InteractionType.ApplicationCommandAutocomplete;
                let handler;
                let handlerId;
                let handlerType;

                if (interaction.type === InteractionType.ApplicationCommand || autocomplete) {
                    handlerId = interaction.data.name;
                    handler = packages.commands.get(handlerId);
                    handlerType = 'command';
                } else if (interaction.type === InteractionType.MessageComponent) {
                    handlerId = interaction.data.customId;
                    handler = getInteractionHandler(packages.components, handlerId);
                    handlerType = 'component';
                } else if (interaction.type === InteractionType.ModalSubmit) {
                    handlerId = interaction.data.customId;
                    handler = getInteractionHandler(packages.modals, handlerId);
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
                    if (autocomplete) await context.autocomplete([]);
                    return;
                }

                try {
                    if (handler.missing.length) {
                        if (autocomplete) {
                            await context.autocomplete([]);
                            return;
                        }

                        await context.respond(
                            `This interaction is unavailable. Missing: ${handler.missing.map((value) => `\`${value}\``).join(', ')}`,
                            { ephemeral: true },
                        );
                        return;
                    }

                    if (handler.authorize && !(await handler.authorize(interaction, config))) {
                        if (autocomplete) {
                            await context.autocomplete([]);
                            return;
                        }

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

                    const feature = packages.features.get(handler.featureId);
                    if (feature && !feature.enabled && !handler.availableWhenDisabled) {
                        if (autocomplete) {
                            await context.autocomplete([]);
                            return;
                        }

                        await context.respond(`${feature.name} is disabled.`, { ephemeral: true });
                        return;
                    }

                    if (autocomplete) {
                        await context.autocomplete((await handler.autocomplete?.(context)) ?? []);
                        return;
                    }

                    await handler.handle(context);
                } catch (error) {
                    log.error('Interaction handler failed', {
                        error,
                        handlerId,
                    });

                    try {
                        if (autocomplete) {
                            await context.autocomplete([]);
                        } else {
                            await context.respond('Something went wrong while handling this interaction.', {
                                ephemeral: true,
                            });
                        }
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

function getInteractionHandler(interactions, customId) {
    const exact = interactions.get(customId);
    if (exact) return exact;

    for (const interaction of interactions.values()) {
        if (interaction.prefix && customId.startsWith(interaction.prefix)) {
            return interaction;
        }
    }
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
        async autocomplete(choices) {
            if (responseState !== 'pending') {
                throw new Error('Interaction has already been acknowledged');
            }

            const response = await rest.sendInteractionResponse(interaction.id, interaction.token, {
                type: InteractionResponseType.ApplicationCommandAutocompleteResult,
                data: { choices },
            });
            responseState = 'responded';
            return response;
        },
    };
}
