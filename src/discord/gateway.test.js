import { createGatewayManager } from '@discordeno/gateway';
import { GatewayDispatchEvents, InteractionType } from 'discord-api-types/v10';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { startGateway } from './gateway.js';

vi.mock('@discordeno/gateway', () => ({
    createGatewayManager: vi.fn()
}));

describe('startGateway', () => {
    beforeEach(() => {
        createGatewayManager.mockReset();
    });

    test('starts Discordeno gateway with runtime options', async () => {
        const { gateway } = await startGatewayForTest();

        expect(createGatewayManager).toHaveBeenCalledWith(
            expect.objectContaining({
                token: 'token',
                preferSnakeCase: true,
                resharding: { enabled: false },
                events: {
                    message: expect.any(Function)
                }
            })
        );
        expect(gateway.spawnShards).toHaveBeenCalled();
    });

    test('dispatches application command routes', async () => {
        const handle = vi.fn();
        const { emitGatewayMessage } = await startGatewayForTest({
            routes: {
                getCommand(commandName) {
                    return commandName === 'snail'
                        ? {
                              id: 'snail:command',
                              handle
                          }
                        : undefined;
                }
            }
        });
        const payload = {
            t: GatewayDispatchEvents.InteractionCreate,
            d: {
                id: 'interaction-id',
                type: InteractionType.ApplicationCommand,
                channel_id: 'channel-id',
                guild_id: 'guild-id',
                member: {
                    user: {
                        id: 'user-id'
                    }
                },
                data: {
                    name: 'snail'
                }
            }
        };

        await emitGatewayMessage(payload);

        expect(handle).toHaveBeenCalledWith(
            expect.objectContaining({
                commandName: 'snail',
                channelId: 'channel-id',
                guildId: 'guild-id',
                memberRoles: [],
                userId: 'user-id',
                config: expect.objectContaining({
                    discord: expect.objectContaining({
                        token: 'token'
                    })
                }),
                data: payload.d.data,
                interaction: payload.d,
                addMemberRole: expect.any(Function),
                createFollowupMessage: expect.any(Function),
                customId: undefined,
                applicationId: undefined,
                editFollowupMessage: expect.any(Function),
                editMessage: expect.any(Function),
                editOriginalResponse: expect.any(Function),
                editBotNickname: expect.any(Function),
                modalValues: {},
                values: [],
                openModal: expect.any(Function),
                removeMemberRole: expect.any(Function),
                sendMessage: expect.any(Function),
                target: {
                    id: undefined,
                    member: undefined,
                    message: undefined,
                    user: undefined
                },
                updateMessage: expect.any(Function),
                respond: expect.any(Function)
            })
        );
    });

    test('dispatches component routes', async () => {
        const handle = vi.fn();
        const { emitGatewayMessage } = await startGatewayForTest({
            routes: {
                getComponent(customId) {
                    return customId === 'message_builder:action:session-id'
                        ? {
                              id: 'message_builder:action',
                              handle
                          }
                        : undefined;
                }
            }
        });
        const payload = {
            t: GatewayDispatchEvents.InteractionCreate,
            d: {
                id: 'interaction-id',
                type: InteractionType.MessageComponent,
                data: {
                    custom_id: 'message_builder:action:session-id',
                    values: ['add_text']
                }
            }
        };

        await emitGatewayMessage(payload);

        expect(handle).toHaveBeenCalledWith(
            expect.objectContaining({
                customId: 'message_builder:action:session-id',
                values: ['add_text']
            })
        );
    });

    test('exposes message context command targets', async () => {
        const handle = vi.fn();
        const { emitGatewayMessage } = await startGatewayForTest({
            config: {
                discord: {
                    applicationId: 'application-id',
                    token: 'token'
                }
            },
            routes: {
                getCommand(commandName) {
                    return commandName === 'edit'
                        ? {
                              id: 'edit:command',
                              handle
                          }
                        : undefined;
                }
            }
        });
        const message = {
            id: 'message-id',
            content: 'Editable'
        };

        await emitGatewayMessage({
            t: GatewayDispatchEvents.InteractionCreate,
            d: {
                id: 'interaction-id',
                channel_id: 'channel-id',
                guild_id: 'guild-id',
                type: InteractionType.ApplicationCommand,
                data: {
                    name: 'edit',
                    target_id: 'message-id',
                    resolved: {
                        messages: {
                            'message-id': message
                        }
                    }
                }
            }
        });

        expect(handle).toHaveBeenCalledWith(
            expect.objectContaining({
                applicationId: 'application-id',
                target: {
                    id: 'message-id',
                    member: undefined,
                    message,
                    user: undefined
                }
            })
        );
    });

    test('dispatches modal routes with modal values', async () => {
        const handle = vi.fn();
        const { emitGatewayMessage } = await startGatewayForTest({
            routes: {
                getModal(customId) {
                    return customId === 'message_builder:text_modal:session-id'
                        ? {
                              id: 'message_builder:text_modal',
                              handle
                          }
                        : undefined;
                }
            }
        });
        const payload = {
            t: GatewayDispatchEvents.InteractionCreate,
            d: {
                id: 'interaction-id',
                type: InteractionType.ModalSubmit,
                data: {
                    custom_id: 'message_builder:text_modal:session-id',
                    components: [
                        {
                            component: {
                                custom_id: 'message_builder:text',
                                value: 'Hello'
                            }
                        },
                        {
                            component: {
                                custom_id: 'message_builder:section_thumbnail_spoiler',
                                values: ['spoiler']
                            }
                        }
                    ]
                }
            }
        };

        await emitGatewayMessage(payload);

        expect(handle).toHaveBeenCalledWith(
            expect.objectContaining({
                customId: 'message_builder:text_modal:session-id',
                modalValues: {
                    'message_builder:section_thumbnail_spoiler': ['spoiler'],
                    'message_builder:text': 'Hello'
                }
            })
        );
    });

    test('dispatches autocomplete routes with choices', async () => {
        const autocomplete = vi.fn(() => [{ name: 'rules', value: 'rules' }]);
        const { emitGatewayMessage, rest } = await startGatewayForTest({
            routes: {
                getCommand(commandName) {
                    return commandName === 'tag'
                        ? {
                              id: 'tag:command',
                              autocomplete,
                              handle: vi.fn()
                          }
                        : undefined;
                }
            }
        });
        const interaction = {
            id: 'interaction-id',
            type: InteractionType.ApplicationCommandAutocomplete,
            data: {
                name: 'tag'
            }
        };

        await emitGatewayMessage({
            t: GatewayDispatchEvents.InteractionCreate,
            d: interaction
        });

        expect(autocomplete).toHaveBeenCalledWith(expect.objectContaining({ commandName: 'tag' }));
        expect(rest.autocomplete).toHaveBeenCalledWith(interaction, [{ name: 'rules', value: 'rules' }]);
    });

    test('rejects unauthorized routes before calling the handler', async () => {
        const handle = vi.fn();
        const authorize = vi.fn(() => false);
        const { emitGatewayMessage, logger, rest } = await startGatewayForTest({
            routes: {
                getCommand() {
                    return {
                        id: 'nick:command',
                        authorize,
                        handle
                    };
                }
            }
        });
        const interaction = {
            id: 'interaction-id',
            type: InteractionType.ApplicationCommand,
            member: {
                user: {
                    id: 'user-id'
                },
                roles: []
            },
            data: {
                name: 'nick'
            }
        };

        await emitGatewayMessage({
            t: GatewayDispatchEvents.InteractionCreate,
            d: interaction
        });

        expect(authorize).toHaveBeenCalledWith(
            expect.objectContaining({
                commandName: 'nick',
                userId: 'user-id',
                memberRoles: []
            })
        );
        expect(handle).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith('interaction_route.unauthorized', {
            interactionId: 'interaction-id',
            commandName: 'nick',
            routeId: 'nick:command',
            userId: 'user-id'
        });
        expect(rest.respond).toHaveBeenCalledWith(interaction, 'You do not have permission to use that command.', {
            ephemeral: true
        });
    });

    test('logs ready payloads without requiring event routes', async () => {
        const { emitGatewayMessage, logger } = await startGatewayForTest();
        const payload = {
            t: GatewayDispatchEvents.Ready,
            d: {
                user: {
                    id: 'bot-user',
                    username: 'Snail'
                }
            }
        };

        await emitGatewayMessage(payload);

        expect(logger.info).toHaveBeenCalledWith('ready.received', {
            id: 'bot-user',
            username: 'Snail'
        });
    });

    test('logs unrouted interactions', async () => {
        const { emitGatewayMessage, logger, rest } = await startGatewayForTest();
        const payload = {
            t: GatewayDispatchEvents.InteractionCreate,
            d: {
                id: 'interaction-id',
                type: InteractionType.ApplicationCommand,
                data: {
                    name: 'missing'
                }
            }
        };

        await emitGatewayMessage(payload);

        expect(logger.warn).toHaveBeenCalledWith('interaction_route.missing', {
            interactionId: 'interaction-id',
            interactionType: InteractionType.ApplicationCommand,
            commandName: 'missing'
        });
        expect(rest.respond).toHaveBeenCalledWith(payload.d, 'That interaction is no longer available.', {
            ephemeral: true
        });
    });

    test.each([
        {
            name: 'unrouted interaction',
            commandName: 'missing',
            routes: {
                getCommand() {
                    return undefined;
                }
            }
        },
        {
            name: 'handler error',
            commandName: 'snail',
            routes: {
                getCommand() {
                    return {
                        id: 'snail:command',
                        handle() {
                            throw new Error('handler failed');
                        }
                    };
                }
            }
        }
    ])('logs failed fallback responses for $name', async ({ commandName, routes }) => {
        const responseError = new Error('response failed');
        const { emitGatewayMessage, logger } = await startGatewayForTest({
            rest: {
                respond: vi.fn().mockRejectedValue(responseError)
            },
            routes
        });

        await emitGatewayMessage({
            t: GatewayDispatchEvents.InteractionCreate,
            d: {
                id: 'interaction-id',
                type: InteractionType.ApplicationCommand,
                data: {
                    name: commandName
                }
            }
        });

        expect(logger.error).toHaveBeenCalledWith('interaction_error_response.failed', {
            commandName,
            error: responseError
        });
    });

    test('responds with an ephemeral error when a route handler fails', async () => {
        const error = new Error('boom');
        const { emitGatewayMessage, logger, rest } = await startGatewayForTest({
            routes: {
                getCommand() {
                    return {
                        id: 'snail:command',
                        handle() {
                            throw error;
                        }
                    };
                }
            }
        });
        const interaction = {
            id: 'interaction-id',
            type: InteractionType.ApplicationCommand,
            data: {
                name: 'snail'
            }
        };

        await emitGatewayMessage({
            t: GatewayDispatchEvents.InteractionCreate,
            d: interaction
        });

        expect(logger.error).toHaveBeenCalledWith('interaction_handler.failed', {
            commandName: 'snail',
            error
        });
        expect(rest.respond).toHaveBeenCalledWith(
            interaction,
            'Something went wrong while handling that interaction.',
            {
                ephemeral: true
            }
        );
    });

    test('logs handler failures when the route response fails', async () => {
        const responseError = new Error('response failed');
        const rest = {
            respond: vi.fn().mockRejectedValueOnce(responseError).mockResolvedValueOnce(undefined)
        };
        const { emitGatewayMessage, logger } = await startGatewayForTest({
            rest,
            routes: {
                getCommand() {
                    return {
                        id: 'snail:command',
                        handle(context) {
                            return context.respond('explicit');
                        }
                    };
                }
            }
        });
        const interaction = {
            id: 'interaction-id',
            type: InteractionType.ApplicationCommand,
            data: {
                name: 'snail'
            }
        };

        await emitGatewayMessage({
            t: GatewayDispatchEvents.InteractionCreate,
            d: interaction
        });

        expect(logger.error).toHaveBeenCalledWith('interaction_handler.failed', {
            commandName: 'snail',
            error: responseError
        });
        expect(rest.respond).toHaveBeenNthCalledWith(1, interaction, 'explicit', undefined);
        expect(rest.respond).toHaveBeenNthCalledWith(
            2,
            interaction,
            'Something went wrong while handling that interaction.',
            {
                ephemeral: true
            }
        );
    });
});

async function startGatewayForTest({
    config = {
        discord: {
            token: 'token'
        }
    },
    logger = createLoggerStub(),
    rest = createRestStub(),
    routes = createRoutesStub()
} = {}) {
    const gateway = {
        spawnShards: vi.fn().mockResolvedValue(undefined)
    };
    createGatewayManager.mockReturnValueOnce(gateway);

    await startGateway({
        config,
        logger,
        rest,
        routes
    });

    return {
        gateway,
        logger,
        rest,
        emitGatewayMessage(payload) {
            return createGatewayManager.mock.calls[0][0].events.message({}, payload);
        }
    };
}

function createRoutesStub() {
    return {
        getCommand() {},
        getComponent() {},
        getModal() {}
    };
}

function createRestStub() {
    return {
        addMemberRole: vi.fn(),
        autocomplete: vi.fn(),
        createFollowupMessage: vi.fn(),
        editFollowupMessage: vi.fn(),
        editMessage: vi.fn(),
        editOriginalResponse: vi.fn(),
        editBotNickname: vi.fn(),
        openModal: vi.fn(),
        removeMemberRole: vi.fn(),
        sendMessage: vi.fn(),
        updateMessage: vi.fn(),
        respond: vi.fn()
    };
}

function createLoggerStub() {
    return {
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
    };
}
