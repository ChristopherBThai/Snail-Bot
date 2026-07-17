import { beforeEach, describe, expect, test, vi } from 'vitest';
import { hasManagerAccess } from '../../discord/auth.js';
import setupEcho from './index.js';

const messageBuilder = {
    start: vi.fn()
};
const route = setupEcho({ services: { messageBuilder } }).routes[0];

describe('echo command route', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('uses manager access authorization', () => {
        expect(route.authorize).toBe(hasManagerAccess);
    });

    test('sends trimmed text to the selected channel', async () => {
        const context = createContext({
            options: [
                {
                    name: 'channel',
                    value: 'channel-id'
                },
                {
                    name: 'message',
                    value: '  Hello there.  '
                }
            ]
        });

        await route.handle(context);

        expect(context.sendMessage).toHaveBeenCalledWith('channel-id', 'Hello there.');
        expect(context.respond).toHaveBeenCalledWith(
            'Echoed message https://discord.com/channels/guild-id/channel-id/message-id',
            { ephemeral: true }
        );
    });

    test('opens Message Builder when message is omitted', async () => {
        const context = createContext({
            options: [
                {
                    name: 'channel',
                    value: 'channel-id'
                }
            ]
        });
        messageBuilder.start.mockImplementationOnce(async (builderContext, options) => {
            const result = await options.submit({ context: builderContext, message: 'compiled message' });
            expect(result).toBe('Echoed message https://discord.com/channels/guild-id/channel-id/message-id');
        });

        await route.handle(context);

        expect(messageBuilder.start).toHaveBeenCalledWith(
            context,
            expect.objectContaining({
                authorize: hasManagerAccess,
                label: 'Send to <#channel-id>',
                submitError: 'Could not send that message.',
                submitLabel: 'Send Message'
            })
        );
        expect(context.sendMessage).toHaveBeenCalledWith('channel-id', 'compiled message');
    });
});

function createContext({ options, sendMessage } = {}) {
    return {
        data: {
            options
        },
        guildId: 'guild-id',
        respond: vi.fn(),
        sendMessage:
            sendMessage ??
            vi.fn(() => ({
                id: 'message-id',
                channel_id: 'channel-id'
            }))
    };
}
