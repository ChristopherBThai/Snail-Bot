import { createGatewayManager } from '@discordeno/gateway';
import { createRestManager } from '@discordeno/rest';
import { GatewayDispatchEvents, InteractionResponseType, InteractionType, MessageFlags } from 'discord-api-types/v10';

/**
 * Creates Snail's Discord REST manager.
 */
export function createRest({ token, logging }) {
    return createRestManager({
        token,
        logger: createDiscordenoLogger(logging.createLogger('rest', true)),
    });
}

/**
 * Synchronizes Snail's global and guild application commands.
 */
export async function synchronizeCommands({ rest, guildId, commands, log }) {
    log.info('Synchronizing global application commands', { commandCount: 0 });
    await rest.upsertGlobalApplicationCommands([]);
    log.info('Global application commands synchronized', { commandCount: 0 });

    log.info('Synchronizing guild application commands', {
        guildId,
        commandCount: commands.length,
    });
    await rest.upsertGuildApplicationCommands(
        guildId,
        commands.map((command) => command.definition),
    );
    log.info('Guild application commands synchronized', {
        guildId,
        commandCount: commands.length,
    });
}

/**
 * Creates Snail's Discord gateway manager and interaction dispatcher.
 */
export function createGateway({ token, logging, log, packages, rest }) {
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
                let handlerName;
                let handler;

                if (interaction.type === InteractionType.ApplicationCommand) {
                    handlerName = interaction.data.name;
                    handler = packages.commandHandlers[handlerName];
                } else if (interaction.type === InteractionType.MessageComponent) {
                    handlerName = interaction.data.customId;
                    handler = packages.componentHandlers[handlerName];
                } else if (interaction.type === InteractionType.ModalSubmit) {
                    handlerName = interaction.data.customId;
                    handler = packages.modalHandlers[handlerName];
                }

                log.debug('Received interaction', {
                    type: interaction.type,
                    handlerName,
                });

                if (!handler) {
                    log.warn('No handler registered for interaction', {
                        type: interaction.type,
                        handlerName,
                    });
                    return;
                }

                try {
                    await handler(interaction);
                } catch (error) {
                    log.error('Interaction handler failed', {
                        error,
                        handlerName,
                    });

                    try {
                        await rest.sendInteractionResponse(interaction.id, interaction.token, {
                            type: InteractionResponseType.ChannelMessageWithSource,
                            data: {
                                content: 'Something went wrong while handling this interaction.',
                                flags: MessageFlags.Ephemeral,
                            },
                        });
                    } catch (responseError) {
                        log.error('Interaction error response failed', {
                            error: responseError,
                            handlerName,
                        });
                    }
                }
            },
        },
    });
}

/**
 * Adapts a Snail logger to Discordeno's variadic logger interface.
 *
 * Discordeno `fatal` records are retained as Snail `error` records.
 */
function createDiscordenoLogger(logger) {
    function adapt(method) {
        return (...args) => {
            const [message, ...details] = args;

            if (message instanceof Error) {
                method(message.message, {
                    error: message,
                    ...(details.length === 0 ? {} : { details }),
                });
                return;
            }

            if (details.length === 1 && details[0] instanceof Error) {
                method(message, { error: details[0] });
                return;
            }

            method(message, details.length > 1 ? details : details[0]);
        };
    }

    return {
        debug: adapt(logger.debug),
        info: adapt(logger.info),
        warn: adapt(logger.warn),
        error: adapt(logger.error),
        fatal: adapt(logger.error),
    };
}
