import { describe, expect, test } from 'vitest';
import { hasAdminAccess, hasHelperAccess, hasManagerAccess, hasOwnerAccess, hasStaffAccess } from './auth.js';

describe('Discord route authorization', () => {
    test('follows the owner admin manager helper staff hierarchy', () => {
        expect(accessFor({ userId: 'owner-id' })).toEqual({
            owner: true,
            admin: true,
            manager: true,
            helper: true,
            staff: true
        });
        expect(accessFor({ memberRoles: ['admin-role'] })).toEqual({
            owner: false,
            admin: true,
            manager: true,
            helper: true,
            staff: true
        });
        expect(accessFor({ memberRoles: ['manager-role'] })).toEqual({
            owner: false,
            admin: false,
            manager: true,
            helper: true,
            staff: true
        });
        expect(accessFor({ memberRoles: ['helper-role'] })).toEqual({
            owner: false,
            admin: false,
            manager: false,
            helper: true,
            staff: true
        });
        expect(accessFor({ memberRoles: ['other-role'] })).toEqual({
            owner: false,
            admin: false,
            manager: false,
            helper: false,
            staff: false
        });
    });
});

function accessFor({ memberRoles = [], userId = 'normal-user' } = {}) {
    const context = {
        config: {
            roles: {
                helper: {
                    permission: 'helper-role'
                },
                manager: {
                    permission: 'manager-role'
                },
                admin: {
                    permission: 'admin-role'
                }
            },
            users: {
                owner: 'owner-id'
            }
        },
        memberRoles,
        userId
    };

    return {
        owner: hasOwnerAccess(context),
        admin: hasAdminAccess(context),
        manager: hasManagerAccess(context),
        helper: hasHelperAccess(context),
        staff: hasStaffAccess(context)
    };
}
