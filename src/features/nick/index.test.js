import { describe, expect, test, vi } from 'vitest';
import { hasManagerAccess } from '../../discord/auth.js';
import nick from './index.js';

const route = nick.routes[0];

describe('nick command route', () => {
    test('uses manager access authorization', () => {
        expect(route.authorize).toBe(hasManagerAccess);
    });

    test('rejects usage outside a server', async () => {
        const context = createContext({
            data: {
                options: [{ name: 'nickname', value: 'Snail Jr' }]
            },
            guildId: null
        });

        await route.handle(context);

        expect(context.editBotNickname).not.toHaveBeenCalled();
        expect(context.respond).toHaveBeenCalledWith('This command can only be used in a sever!', { ephemeral: true });
    });

    test('resets the bot nickname when no nickname is provided', async () => {
        const context = createContext();

        await route.handle(context);

        expect(context.editBotNickname).toHaveBeenCalledWith('guild-id', null);
        expect(context.respond).toHaveBeenCalledWith('I have reset my nickname.', { ephemeral: true });
    });

    test('resets the bot nickname when the nickname is blank', async () => {
        const context = createContext({
            data: {
                options: [{ name: 'nickname', value: '   ' }]
            }
        });

        await route.handle(context);

        expect(context.editBotNickname).toHaveBeenCalledWith('guild-id', null);
        expect(context.respond).toHaveBeenCalledWith('I have reset my nickname.', { ephemeral: true });
    });

    test('sets the bot nickname', async () => {
        const context = createContext({
            data: {
                options: [{ name: 'nickname', value: '  Snail Jr  ' }]
            }
        });

        await route.handle(context);

        expect(context.editBotNickname).toHaveBeenCalledWith('guild-id', 'Snail Jr');
        expect(context.respond).toHaveBeenCalledWith('I have set my nickname to `Snail Jr`.', { ephemeral: true });
    });

    test('sets reset as a normal nickname', async () => {
        const context = createContext({
            data: {
                options: [{ name: 'nickname', value: 'RESET' }]
            }
        });

        await route.handle(context);

        expect(context.editBotNickname).toHaveBeenCalledWith('guild-id', 'RESET');
        expect(context.respond).toHaveBeenCalledWith('I have set my nickname to `RESET`.', { ephemeral: true });
    });
});

function createContext({
    config = {
        roles: {
            admin: ['admin-role'],
            manager: ['manager-role']
        },
        users: {
            owner: 'owner-id'
        }
    },
    data = { options: [] },
    guildId = 'guild-id',
    memberRoles = [],
    userId = 'normal-user'
} = {}) {
    return {
        config,
        data,
        editBotNickname: vi.fn(),
        guildId,
        memberRoles,
        respond: vi.fn(),
        userId
    };
}
