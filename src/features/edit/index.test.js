import { ApplicationCommandType } from 'discord-api-types/v10';
import { describe, expect, test, vi } from 'vitest';
import { hasManagerAccess } from '../../discord/auth.js';
import setupEdit from './index.js';

describe('edit message context command', () => {
    test('uses manager authorization and message context command registration', () => {
        const route = createRoute();

        expect(route.authorize).toBe(hasManagerAccess);
        expect(route.command).toMatchObject({
            name: 'edit',
            staff: true,
            type: ApplicationCommandType.Message
        });
    });

    test('rejects missing target messages', async () => {
        const route = createRoute();
        const context = createContext({
            target: {
                id: null,
                message: null
            }
        });

        await route.handle(context);

        expect(context.respond).toHaveBeenCalledWith('Could not read that message.', { ephemeral: true });
    });

    test('rejects messages not authored by Snail', async () => {
        const route = createRoute();
        const context = createContext({
            target: {
                id: 'message-id',
                message: {
                    author: { id: 'someone-else' },
                    channel_id: 'channel-id',
                    id: 'message-id'
                }
            }
        });

        await route.handle(context);

        expect(context.respond).toHaveBeenCalledWith('I can only edit messages sent by Snail.', { ephemeral: true });
    });

    test('rejects messages without a readable channel', async () => {
        const route = createRoute();
        const context = createContext({
            channelId: null,
            target: {
                id: 'message-id',
                message: {
                    author: { id: 'application-id' },
                    id: 'message-id'
                }
            }
        });

        await route.handle(context);

        expect(context.respond).toHaveBeenCalledWith('Could not read that message channel.', { ephemeral: true });
    });

    test('exits when Message Builder cannot open the source message', async () => {
        const messageBuilder = createMessageBuilderStub();
        messageBuilder.start.mockImplementationOnce(async (context) => {
            await context.respond('That message cannot be edited because it has embeds.', { ephemeral: true });
        });
        const route = createRoute({ messageBuilder });
        const context = createContext();

        await route.handle(context);

        expect(context.respond).toHaveBeenCalledWith('That message cannot be edited because it has embeds.', {
            ephemeral: true
        });
        expect(context.editMessage).not.toHaveBeenCalled();
    });

    test('opens Message Builder from a Snail-authored editable message', async () => {
        const messageBuilder = createMessageBuilderStub();
        const route = createRoute({ messageBuilder });
        const context = createContext();
        messageBuilder.start.mockImplementationOnce(async (builderContext, options) => {
            const result = await options.submit({
                context: builderContext,
                message: {
                    flags: 32768,
                    components: [{ type: 10, content: 'Hello <@123456789012345678>' }]
                }
            });
            expect(result).toBe('Updated message https://discord.com/channels/guild-id/target-channel-id/message-id');
        });

        await route.handle(context);

        expect(messageBuilder.start).toHaveBeenCalledWith(
            context,
            expect.objectContaining({
                authorize: hasManagerAccess,
                label: 'Edit message https://discord.com/channels/guild-id/target-channel-id/message-id',
                sourceMessage: context.target.message,
                submitError: 'Could not update that message.',
                submitLabel: 'Update Message'
            })
        );
        expect(context.editMessage).toHaveBeenCalledWith('target-channel-id', 'message-id', {
            content: null,
            embeds: [],
            attachments: [],
            flags: 32768,
            components: [{ type: 10, content: 'Hello <@123456789012345678>' }]
        });
    });
});

function createRoute({ messageBuilder = createMessageBuilderStub() } = {}) {
    return setupEdit({ services: { messageBuilder } }).routes[0];
}

function createMessageBuilderStub() {
    return {
        start: vi.fn()
    };
}

function createContext({
    channelId = 'interaction-channel-id',
    editMessage = vi.fn(),
    target = {
        id: 'message-id',
        member: undefined,
        message: {
            author: { id: 'application-id' },
            channel_id: 'target-channel-id',
            id: 'message-id'
        },
        user: undefined
    }
} = {}) {
    return {
        applicationId: 'application-id',
        channelId,
        editMessage,
        guildId: 'guild-id',
        respond: vi.fn(),
        target,
        userId: 'user-id'
    };
}
