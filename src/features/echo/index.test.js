import { beforeEach, describe, expect, test, vi } from 'vitest';
import { hasManagerAccess } from '../../discord/auth.js';
import setupEcho from './index.js';

const messageBuilder = {
    OpenModes: {
        Resume: 'resume'
    },
    SubmitResults: {
        Cancelled: 'cancelled',
        Submitted: 'submitted'
    },
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
                    value: '222222222222222222'
                },
                {
                    name: 'message',
                    value: '  Hello there.  '
                }
            ]
        });

        await route.handle(context);

        expect(context.sendMessage).toHaveBeenCalledWith('222222222222222222', 'Hello there.');
        expect(context.respond).toHaveBeenCalledWith(
            'Echoed message https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333',
            { ephemeral: true }
        );
    });

    test('opens Message Builder when message is omitted', async () => {
        const context = createContext({
            options: [
                {
                    name: 'channel',
                    value: '222222222222222222'
                }
            ]
        });
        const submission = createSubmission(context);
        messageBuilder.start.mockResolvedValueOnce(submission);

        await route.handle(context);

        expect(messageBuilder.start).toHaveBeenCalledWith(
            context,
            expect.objectContaining({
                authorize: hasManagerAccess,
                label: 'Send to <#222222222222222222>',
                mode: messageBuilder.OpenModes.Resume,
                submitLabel: 'Send Message'
            })
        );
        expect(context.sendMessage).toHaveBeenCalledWith('222222222222222222', submission.message);
        expect(submission.confirm).toHaveBeenCalledWith(
            'Echoed message https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333'
        );
    });

    test('waits for the next builder submission when builder send fails', async () => {
        const sendMessage = vi.fn().mockRejectedValueOnce(new Error('Discord failed.')).mockResolvedValueOnce({
            id: '333333333333333333',
            channel_id: '222222222222222222'
        });
        const context = createContext({
            options: [
                {
                    name: 'channel',
                    value: '222222222222222222'
                }
            ],
            sendMessage
        });
        const firstSubmission = createSubmission(context, { message: 'first compiled message' });
        const secondSubmission = createSubmission(context, { message: 'second compiled message' });
        firstSubmission.reject.mockResolvedValueOnce(secondSubmission);
        messageBuilder.start.mockResolvedValueOnce(firstSubmission);

        await route.handle(context);

        expect(sendMessage).toHaveBeenNthCalledWith(1, '222222222222222222', firstSubmission.message);
        expect(firstSubmission.reject).toHaveBeenCalledWith('Could not send that message.');
        expect(sendMessage).toHaveBeenNthCalledWith(2, '222222222222222222', secondSubmission.message);
        expect(secondSubmission.confirm).toHaveBeenCalledWith(
            'Echoed message https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333'
        );
        expect(firstSubmission.confirm).not.toHaveBeenCalled();
    });

    test('exits when Message Builder is superseded before submit', async () => {
        const context = createContext({
            options: [
                {
                    name: 'channel',
                    value: '222222222222222222'
                }
            ]
        });
        messageBuilder.start.mockResolvedValueOnce({
            type: messageBuilder.SubmitResults.Cancelled
        });

        await route.handle(context);

        expect(context.sendMessage).not.toHaveBeenCalled();
    });
});

function createSubmission(context, { message = 'compiled message' } = {}) {
    return {
        confirm: vi.fn(),
        context,
        message,
        reject: vi.fn(),
        type: messageBuilder.SubmitResults.Submitted
    };
}

function createContext({ options, sendMessage } = {}) {
    return {
        data: {
            options
        },
        guildId: '111111111111111111',
        respond: vi.fn(),
        sendMessage:
            sendMessage ??
            vi.fn(() => ({
                id: '333333333333333333',
                channel_id: '222222222222222222'
            }))
    };
}
