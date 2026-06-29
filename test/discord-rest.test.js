import { InteractionResponseType, MessageFlags, PermissionFlagsBits } from 'discord-api-types/v10';
import { beforeEach, expect, test, vi } from 'vitest';
import { componentsMessage, fileDisplay } from '../src/systems/discord/components.js';
import { createDiscordRest, normalizeMessage } from '../src/systems/discord/rest.js';

const restMock = vi.hoisted(() => ({
    editMessage: vi.fn(),
    editOriginalInteractionResponse: vi.fn(),
    post: vi.fn(),
    preferSnakeCase: vi.fn(),
    put: vi.fn(),
    sendFollowupMessage: vi.fn(),
    sendMessage: vi.fn(),
    routes: {
        interactions: {
            commands: {
                guilds: {
                    all: vi.fn((applicationId, guildId) => `/applications/${applicationId}/guilds/${guildId}/commands`)
                }
            },
            responses: {
                callback: vi.fn((interactionId, token) => `/interactions/${interactionId}/${token}/callback`)
            }
        }
    }
}));

vi.mock('@discordeno/rest', () => ({
    createRestManager: vi.fn(() => restMock)
}));

beforeEach(() => {
    for (const value of Object.values(restMock)) {
        if (typeof value?.mockClear === 'function') {
            value.mockClear();
        }
    }

    restMock.preferSnakeCase.mockReturnValue(restMock);
    restMock.editOriginalInteractionResponse.mockResolvedValue({ id: 'edited-original' });
    restMock.post.mockResolvedValue({});
    restMock.put.mockResolvedValue({});
    restMock.sendFollowupMessage.mockResolvedValue({ id: 'followup-message' });
    restMock.sendMessage.mockResolvedValue({ id: 'sent-message' });
    restMock.editMessage.mockResolvedValue({ id: 'edited-message' });
});

test('file components include upload attachment metadata', () => {
    const filename = 'quest_list-logs.json';
    const file = {
        name: filename,
        blob: new Blob(['[]'], { type: 'application/json' })
    };
    const message = normalizeMessage({
        ...componentsMessage(fileDisplay(filename)),
        files: [file]
    });

    expect(message.files).toEqual([file]);
    expect(message.attachments).toEqual([
        {
            id: '0',
            filename
        }
    ]);
});

test('file normalization preserves explicit attachment lists', () => {
    const file = {
        name: 'new.png',
        blob: new Blob(['new'], { type: 'image/png' })
    };
    const attachments = [
        { id: 'existing-attachment', filename: 'old.png' },
        { id: '0', filename: 'new.png' }
    ];
    const message = normalizeMessage({
        ...componentsMessage(fileDisplay(file.name)),
        attachments,
        files: [file]
    });

    expect(message.attachments).toBe(attachments);
    expect(message.files).toEqual([file]);
});

test('respond sends interaction callback with normalized string message', async () => {
    const rest = createDiscordRest('token');

    await rest.respond(interaction(), 'hello');

    expect(restMock.post).toHaveBeenCalledWith('/interactions/interaction-1/token-1/callback', {
        body: {
            type: InteractionResponseType.ChannelMessageWithSource,
            data: expect.objectContaining({
                components: expect.arrayContaining([expect.objectContaining({ content: 'hello' })])
            })
        },
        files: undefined,
        runThroughQueue: false,
        unauthorized: true
    });
});

test('respond separates upload files from interaction response data', async () => {
    const rest = createDiscordRest('token');
    const file = {
        name: 'logs.json',
        blob: new Blob(['[]'], { type: 'application/json' })
    };

    await rest.respond(interaction(), {
        ...componentsMessage(fileDisplay(file.name)),
        files: [file]
    });

    expect(restMock.post).toHaveBeenCalledWith('/interactions/interaction-1/token-1/callback', {
        body: {
            type: InteractionResponseType.ChannelMessageWithSource,
            data: expect.objectContaining({
                attachments: [{ id: '0', filename: file.name }]
            })
        },
        files: [file],
        runThroughQueue: false,
        unauthorized: true
    });
});

test('defer uses ephemeral flags only when requested', async () => {
    const rest = createDiscordRest('token');

    await rest.defer(interaction(), { ephemeral: true });
    await rest.defer(interaction());

    expect(restMock.post).toHaveBeenNthCalledWith(1, '/interactions/interaction-1/token-1/callback', {
        body: {
            type: InteractionResponseType.DeferredChannelMessageWithSource,
            data: { flags: MessageFlags.Ephemeral }
        },
        runThroughQueue: false,
        unauthorized: true
    });
    expect(restMock.post).toHaveBeenNthCalledWith(2, '/interactions/interaction-1/token-1/callback', {
        body: {
            type: InteractionResponseType.DeferredChannelMessageWithSource,
            data: undefined
        },
        runThroughQueue: false,
        unauthorized: true
    });
});

test('autocomplete sends autocomplete result choices', async () => {
    const rest = createDiscordRest('token');
    const choices = [{ name: 'Quest List', value: 'quest_list' }];

    await rest.autocomplete(interaction(), choices);

    expect(restMock.post).toHaveBeenCalledWith('/interactions/interaction-1/token-1/callback', {
        body: {
            type: InteractionResponseType.ApplicationCommandAutocompleteResult,
            data: { choices }
        },
        runThroughQueue: false,
        unauthorized: true
    });
});

test('guild command sync applies staff visibility permissions', async () => {
    const rest = createDiscordRest('token');
    const commands = [
        {
            staff: true,
            definition: {
                name: 'module',
                description: 'Open module status and settings.'
            }
        },
        {
            definition: {
                name: 'snail',
                description: 'snail'
            }
        }
    ];

    await rest.syncGuildCommands('application-1', 'guild-1', commands);

    expect(restMock.put).toHaveBeenCalledWith('/applications/application-1/guilds/guild-1/commands', {
        body: [
            {
                name: 'module',
                description: 'Open module status and settings.',
                default_member_permissions: PermissionFlagsBits.BypassSlowmode.toString()
            },
            {
                name: 'snail',
                description: 'snail'
            }
        ]
    });
});

test('rest failures log original error objects with discord metadata', async () => {
    const error = new Error('Failed to send request to discord.');
    const logger = {
        error: vi.fn()
    };

    error.cause = {
        status: 404,
        body: '{"message":"Unknown interaction"}'
    };
    restMock.post.mockRejectedValueOnce(error);

    const rest = createDiscordRest('token', { logger });

    await expect(rest.respond(interaction(), 'hello')).rejects.toBe(error);
    expect(logger.error).toHaveBeenCalledWith('discord.interaction.respond_failed', {
        error,
        status: 404,
        body: '{"message":"Unknown interaction"}'
    });
});

function interaction() {
    return {
        id: 'interaction-1',
        token: 'token-1'
    };
}
