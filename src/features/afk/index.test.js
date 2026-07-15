import { describe, expect, test, vi } from 'vitest';
import { hasStaffAccess } from '../../discord/auth.js';
import afk from './index.js';

const route = afk.routes[0];

describe('afk command route', () => {
    test('uses staff access authorization', () => {
        expect(route.authorize).toBe(hasStaffAccess);
    });

    test('rejects usage outside a server', async () => {
        const context = createContext({
            guildId: null,
            memberRoles: ['helper-role']
        });

        await route.handle(context);

        expect(context.addMemberRole).not.toHaveBeenCalled();
        expect(context.removeMemberRole).not.toHaveBeenCalled();
        expect(context.respond).toHaveBeenCalledWith('This command can only be used in a sever!', { ephemeral: true });
    });

    test('adds the highest staff member list role', async () => {
        const context = createContext({
            memberRoles: ['helper-role', 'manager-role']
        });

        await route.handle(context);

        expect(context.addMemberRole).toHaveBeenCalledWith('guild-id', 'user-id', 'manager-display', '/afk added');
        expect(context.removeMemberRole).not.toHaveBeenCalled();
        expect(context.respond).toHaveBeenCalledWith('You have been added to the member list.', { ephemeral: true });
    });

    test('treats the owner as admin for member list role selection', async () => {
        const context = createContext({
            memberRoles: ['helper-role'],
            userId: 'owner-id'
        });

        await route.handle(context);

        expect(context.addMemberRole).toHaveBeenCalledWith('guild-id', 'owner-id', 'admin-display', '/afk added');
        expect(context.removeMemberRole).not.toHaveBeenCalled();
        expect(context.respond).toHaveBeenCalledWith('You have been added to the member list.', { ephemeral: true });
    });

    test('removes the current member list role', async () => {
        const context = createContext({
            memberRoles: ['helper-role', 'helper-display']
        });

        await route.handle(context);

        expect(context.removeMemberRole).toHaveBeenCalledWith('guild-id', 'user-id', 'helper-display', '/afk removed');
        expect(context.addMemberRole).not.toHaveBeenCalled();
        expect(context.respond).toHaveBeenCalledWith('You have been removed from the member list.', {
            ephemeral: true
        });
    });

    test('removes stale member list roles before adding the current one', async () => {
        const context = createContext({
            memberRoles: ['admin-role', 'helper-display', 'manager-display']
        });

        await route.handle(context);

        expect(context.removeMemberRole).toHaveBeenCalledWith(
            'guild-id',
            'user-id',
            'manager-display',
            '/afk removed stale display role'
        );
        expect(context.removeMemberRole).toHaveBeenCalledWith(
            'guild-id',
            'user-id',
            'helper-display',
            '/afk removed stale display role'
        );
        expect(context.addMemberRole).toHaveBeenCalledWith('guild-id', 'user-id', 'admin-display', '/afk added');
        expect(context.respond).toHaveBeenCalledWith('You have been added to the member list.', { ephemeral: true });
    });
});

function createContext({
    config = {
        roles: {
            helper: { permission: 'helper-role', display: 'helper-display' },
            manager: { permission: 'manager-role', display: 'manager-display' },
            admin: { permission: 'admin-role', display: 'admin-display' }
        },
        users: {
            owner: 'owner-id'
        }
    },
    guildId = 'guild-id',
    memberRoles = [],
    userId = 'user-id'
} = {}) {
    return {
        addMemberRole: vi.fn(),
        config,
        guildId,
        memberRoles,
        removeMemberRole: vi.fn(),
        respond: vi.fn(),
        userId
    };
}
