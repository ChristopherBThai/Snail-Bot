import { ComponentType, InteractionResponseType, MessageFlags } from 'discord-api-types/v10';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createDiscordRest } from './rest.js';

const discordenoRest = vi.hoisted(() => ({
    put: vi.fn(),
    post: vi.fn(),
    routes: {
        interactions: {
            commands: {
                commands: vi.fn(() => 'global-command-route'),
                guilds: {
                    all: vi.fn(() => 'guild-command-route')
                }
            },
            responses: {
                callback: vi.fn(() => 'interaction-callback-route')
            }
        }
    }
}));

vi.mock('@discordeno/rest', () => ({
    createRestManager: vi.fn(() => ({
        preferSnakeCase: vi.fn(() => discordenoRest)
    }))
}));

beforeEach(() => {
    vi.clearAllMocks();
});

describe('createDiscordRest', () => {
    const config = {
        discord: {
            token: 'test-token',
            applicationId: '123456789012345678',
            guildId: '987654321098765432'
        }
    };
    const logger = {
        error: vi.fn()
    };

    test('syncs guild commands through the guild command collection route', async () => {
        discordenoRest.put.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });

        await rest.syncGuildCommands([]);

        expect(discordenoRest.routes.interactions.commands.guilds.all).toHaveBeenCalledWith(
            config.discord.applicationId,
            config.discord.guildId
        );
        expect(discordenoRest.put).toHaveBeenCalledWith('guild-command-route', { body: [] });
    });

    test('syncs global commands through the global command collection route', async () => {
        discordenoRest.put.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });

        await rest.syncGlobalCommands([]);

        expect(discordenoRest.routes.interactions.commands.commands).toHaveBeenCalledWith(config.discord.applicationId);
        expect(discordenoRest.put).toHaveBeenCalledWith('global-command-route', {
            body: []
        });
    });

    test('responds with string messages as Components V2 text displays', async () => {
        discordenoRest.post.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });
        const interaction = {
            id: 'interaction-id',
            token: 'interaction-token'
        };

        await rest.respond(interaction, '🐌');

        expect(discordenoRest.routes.interactions.responses.callback).toHaveBeenCalledWith(
            interaction.id,
            interaction.token
        );
        expect(discordenoRest.post).toHaveBeenCalledWith('interaction-callback-route', {
            body: {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: {
                    flags: MessageFlags.IsComponentsV2,
                    components: [
                        {
                            type: ComponentType.TextDisplay,
                            content: '🐌'
                        }
                    ]
                }
            },
            runThroughQueue: false,
            unauthorized: true
        });
    });

    test('responds with explicit message payloads unchanged', async () => {
        discordenoRest.post.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });
        const interaction = {
            id: 'interaction-id',
            token: 'interaction-token'
        };
        const message = {
            flags: MessageFlags.IsComponentsV2,
            components: [
                {
                    type: ComponentType.TextDisplay,
                    content: 'Explicit response payload.'
                }
            ]
        };

        await rest.respond(interaction, message);

        expect(discordenoRest.post).toHaveBeenCalledWith('interaction-callback-route', {
            body: {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: message
            },
            runThroughQueue: false,
            unauthorized: true
        });
    });

    test.each([
        {
            name: 'global command sync',
            event: 'global_command_sync.failed',
            fail(error) {
                discordenoRest.put.mockRejectedValueOnce(error);
            },
            run(rest) {
                return rest.syncGlobalCommands([]);
            }
        },
        {
            name: 'interaction response',
            event: 'interaction_response.failed',
            fail(error) {
                discordenoRest.post.mockRejectedValueOnce(error);
            },
            run(rest) {
                return rest.respond(
                    {
                        id: 'interaction-id',
                        token: 'interaction-token'
                    },
                    '🐌'
                );
            }
        }
    ])('logs and rethrows $name failures', async ({ event, fail, run }) => {
        const error = new Error('Discord REST failed');
        error.cause = {
            status: 500,
            body: {
                message: 'Internal Server Error'
            }
        };
        fail(error);

        const rest = createDiscordRest(config, { logger });

        await expect(run(rest)).rejects.toBe(error);

        expect(logger.error).toHaveBeenCalledWith(event, {
            errorName: 'Error',
            errorMessage: 'Discord REST failed',
            status: 500,
            body: {
                message: 'Internal Server Error'
            }
        });
    });
});
