import { ComponentType, InteractionResponseType, MessageFlags } from 'discord-api-types/v10';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createDiscordRest } from './rest.js';

const discordenoRest = vi.hoisted(() => ({
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
    patch: vi.fn(),
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
        },
        guilds: {
            roles: {
                member: vi.fn(() => 'member-role-route')
            },
            members: {
                bot: vi.fn(() => 'bot-member-route')
            }
        },
        channels: {
            message: vi.fn(() => 'channel-message-route'),
            messages: vi.fn(() => 'channel-messages-route')
        },
        webhooks: {
            message: vi.fn(() => 'webhook-message-route'),
            original: vi.fn(() => 'webhook-original-route'),
            webhook: vi.fn(() => 'webhook-route')
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

    test('responds with ephemeral string messages as Components V2 text displays', async () => {
        discordenoRest.post.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });
        const interaction = {
            id: 'interaction-id',
            token: 'interaction-token'
        };

        await rest.respond(interaction, 'Private response.', { ephemeral: true });

        expect(discordenoRest.post).toHaveBeenCalledWith('interaction-callback-route', {
            body: {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: {
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                    components: [
                        {
                            type: ComponentType.TextDisplay,
                            content: 'Private response.'
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

    test('adds ephemeral response options to explicit message payloads', async () => {
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

        await rest.respond(interaction, message, { ephemeral: true });

        expect(discordenoRest.post).toHaveBeenCalledWith('interaction-callback-route', {
            body: {
                type: InteractionResponseType.ChannelMessageWithSource,
                data: {
                    ...message,
                    flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
                }
            },
            runThroughQueue: false,
            unauthorized: true
        });
    });

    test('updates interaction messages', async () => {
        discordenoRest.post.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });
        const interaction = {
            id: 'interaction-id',
            token: 'interaction-token'
        };

        await rest.updateMessage(interaction, 'Updated message.');

        expect(discordenoRest.post).toHaveBeenCalledWith('interaction-callback-route', {
            body: {
                type: InteractionResponseType.UpdateMessage,
                data: {
                    flags: MessageFlags.IsComponentsV2,
                    components: [
                        {
                            type: ComponentType.TextDisplay,
                            content: 'Updated message.'
                        }
                    ]
                }
            },
            runThroughQueue: false,
            unauthorized: true
        });
    });

    test('opens interaction modals', async () => {
        discordenoRest.post.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });
        const interaction = {
            id: 'interaction-id',
            token: 'interaction-token'
        };
        const modal = {
            title: 'Modal',
            custom_id: 'modal-id',
            components: []
        };

        await rest.openModal(interaction, modal);

        expect(discordenoRest.post).toHaveBeenCalledWith('interaction-callback-route', {
            body: {
                type: InteractionResponseType.Modal,
                data: modal
            },
            runThroughQueue: false,
            unauthorized: true
        });
    });

    test('responds to autocomplete interactions with choices', async () => {
        discordenoRest.post.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });
        const interaction = {
            id: 'interaction-id',
            token: 'interaction-token'
        };
        const choices = [{ name: 'rules', value: 'rules' }];

        await rest.autocomplete(interaction, choices);

        expect(discordenoRest.post).toHaveBeenCalledWith('interaction-callback-route', {
            body: {
                type: InteractionResponseType.ApplicationCommandAutocompleteResult,
                data: {
                    choices
                }
            },
            runThroughQueue: false,
            unauthorized: true
        });
    });

    test('sends string messages through the channel message collection route', async () => {
        discordenoRest.post.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });

        await rest.sendMessage('channel-id', 'Public message.');

        expect(discordenoRest.routes.channels.messages).toHaveBeenCalledWith('channel-id');
        expect(discordenoRest.post).toHaveBeenCalledWith('channel-messages-route', {
            body: {
                flags: MessageFlags.IsComponentsV2,
                components: [
                    {
                        type: ComponentType.TextDisplay,
                        content: 'Public message.'
                    }
                ]
            }
        });
    });

    test('edits channel messages through the channel message route', async () => {
        discordenoRest.patch.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });

        await rest.editMessage('channel-id', 'message-id', 'Edited message.');

        expect(discordenoRest.routes.channels.message).toHaveBeenCalledWith('channel-id', 'message-id');
        expect(discordenoRest.patch).toHaveBeenCalledWith('channel-message-route', {
            body: {
                flags: MessageFlags.IsComponentsV2,
                components: [
                    {
                        type: ComponentType.TextDisplay,
                        content: 'Edited message.'
                    }
                ]
            }
        });
    });

    test('creates ephemeral interaction follow-up messages', async () => {
        const message = {
            id: 'display-message-id'
        };
        discordenoRest.post.mockResolvedValueOnce(message);

        const rest = createDiscordRest(config, { logger });
        const interaction = {
            token: 'interaction-token'
        };

        const result = await rest.createFollowupMessage(interaction, 'Preview.', { ephemeral: true });

        expect(result).toBe(message);
        expect(discordenoRest.routes.webhooks.webhook).toHaveBeenCalledWith(
            config.discord.applicationId,
            interaction.token,
            { wait: true }
        );
        expect(discordenoRest.post).toHaveBeenCalledWith('webhook-route', {
            body: {
                flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
                components: [
                    {
                        type: ComponentType.TextDisplay,
                        content: 'Preview.'
                    }
                ]
            },
            unauthorized: true
        });
    });

    test('edits interaction follow-up messages', async () => {
        discordenoRest.patch.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });

        await rest.editFollowupMessage('interaction-token', 'display-message-id', 'Updated preview.');

        expect(discordenoRest.routes.webhooks.message).toHaveBeenCalledWith(
            config.discord.applicationId,
            'interaction-token',
            'display-message-id'
        );
        expect(discordenoRest.patch).toHaveBeenCalledWith('webhook-message-route', {
            body: {
                flags: MessageFlags.IsComponentsV2,
                components: [
                    {
                        type: ComponentType.TextDisplay,
                        content: 'Updated preview.'
                    }
                ]
            },
            unauthorized: true
        });
    });

    test('edits original interaction responses', async () => {
        discordenoRest.patch.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });

        await rest.editOriginalResponse('interaction-token', 'Updated preview.');

        expect(discordenoRest.routes.webhooks.original).toHaveBeenCalledWith(
            config.discord.applicationId,
            'interaction-token'
        );
        expect(discordenoRest.patch).toHaveBeenCalledWith('webhook-original-route', {
            body: {
                flags: MessageFlags.IsComponentsV2,
                components: [
                    {
                        type: ComponentType.TextDisplay,
                        content: 'Updated preview.'
                    }
                ]
            },
            unauthorized: true
        });
    });

    test('updates the bot nickname through the current bot member route', async () => {
        discordenoRest.patch.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });

        await rest.editBotNickname('guild-id', 'Snail Jr');

        expect(discordenoRest.routes.guilds.members.bot).toHaveBeenCalledWith('guild-id');
        expect(discordenoRest.patch).toHaveBeenCalledWith('bot-member-route', {
            body: {
                nick: 'Snail Jr'
            }
        });
    });

    test('adds member roles through the guild member role route', async () => {
        discordenoRest.put.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });

        await rest.addMemberRole('guild-id', 'user-id', 'role-id', 'reason');

        expect(discordenoRest.routes.guilds.roles.member).toHaveBeenCalledWith('guild-id', 'user-id', 'role-id');
        expect(discordenoRest.put).toHaveBeenCalledWith('member-role-route', {
            reason: 'reason'
        });
    });

    test('removes member roles through the guild member role route', async () => {
        discordenoRest.delete.mockResolvedValueOnce(undefined);

        const rest = createDiscordRest(config, { logger });

        await rest.removeMemberRole('guild-id', 'user-id', 'role-id', 'reason');

        expect(discordenoRest.routes.guilds.roles.member).toHaveBeenCalledWith('guild-id', 'user-id', 'role-id');
        expect(discordenoRest.delete).toHaveBeenCalledWith('member-role-route', {
            reason: 'reason'
        });
    });

    test('logs and rethrows Discord REST failures', async () => {
        const error = new Error('Discord REST failed');
        error.cause = {
            status: 500,
            body: {
                message: 'Internal Server Error'
            }
        };
        discordenoRest.post.mockRejectedValueOnce(error);

        const rest = createDiscordRest(config, { logger });
        const interaction = {
            id: 'interaction-id',
            token: 'interaction-token'
        };

        await expect(rest.respond(interaction, '🐌')).rejects.toBe(error);

        expect(logger.error).toHaveBeenCalledWith('interaction_response.failed', {
            errorName: 'Error',
            errorMessage: 'Discord REST failed',
            status: 500,
            body: {
                message: 'Internal Server Error'
            }
        });
    });
});
