import { createGatewayManager } from '@discordeno/gateway';
import { createRestManager } from '@discordeno/rest';
import {
    ComponentType,
    GatewayDispatchEvents,
    InteractionResponseType,
    InteractionType,
    MessageFlags,
    PermissionFlagsBits,
} from 'discord-api-types/v10';

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
        commandCount: commands.size,
    });
    await rest.upsertGuildApplicationCommands(
        guildId,
        [...commands.values()].map((command) => ({
            ...command.definition,
            ...(command.staff ? { defaultMemberPermissions: PermissionFlagsBits.BypassSlowmode.toString() } : {}),
        })),
    );
    log.info('Guild application commands synchronized', {
        guildId,
        commandCount: commands.size,
    });
}

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
                            userId: interaction.member?.user.id ?? interaction.user?.id,
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
    return {
        interaction,
        respond(message, options) {
            return rest.sendInteractionResponse(interaction.id, interaction.token, {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: normalizeMessage(message, options),
            });
        },
    };
}

function normalizeMessage(message, { ephemeral = false } = {}) {
    const data =
        typeof message === 'string' ? { components: [{ type: ComponentType.TextDisplay, content: message }] } : message;

    return {
        ...data,
        flags: (data.flags ?? 0) | MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0),
    };
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
