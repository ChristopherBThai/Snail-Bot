import { describe, expect, test } from 'vitest';
import { hasManagerAccess } from './auth.js';

describe('hasManagerAccess', () => {
    test('allows the configured owner', () => {
        expect(hasManagerAccess(createContext({ userId: 'owner-id' }))).toBe(true);
    });

    test('allows configured admins and managers', () => {
        expect(hasManagerAccess(createContext({ memberRoles: ['admin-role'] }))).toBe(true);
        expect(hasManagerAccess(createContext({ memberRoles: ['manager-role'] }))).toBe(true);
    });

    test('rejects users without configured staff access', () => {
        expect(hasManagerAccess(createContext({ memberRoles: ['other-role'] }))).toBe(false);
        expect(hasManagerAccess(createContext({ userId: 'normal-user', memberRoles: [] }))).toBe(false);
    });
});

function createContext({ memberRoles = [], userId = 'normal-user' } = {}) {
    return {
        config: {
            roles: {
                admin: ['admin-role'],
                manager: ['manager-role']
            },
            users: {
                owner: 'owner-id'
            }
        },
        memberRoles,
        userId
    };
}
