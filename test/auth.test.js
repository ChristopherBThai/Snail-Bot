import { expect, test } from 'vitest';
import { isAdmin, isHelper, isManager, isOwner, isStaff } from '../src/utils.js';

const config = {
    roles: {
        helper: ['helper-role'],
        manager: ['manager-role'],
        admin: ['admin-role']
    },
    users: {
        owner: 'owner-user'
    }
};

test('staff role authorization follows owner admin manager helper hierarchy', () => {
    expect(authFor('owner-user', [])).toEqual({
        owner: true,
        admin: true,
        manager: true,
        helper: true,
        staff: true
    });
    expect(authFor('admin-user', ['admin-role'])).toEqual({
        owner: false,
        admin: true,
        manager: true,
        helper: true,
        staff: true
    });
    expect(authFor('manager-user', ['manager-role'])).toEqual({
        owner: false,
        admin: false,
        manager: true,
        helper: true,
        staff: true
    });
    expect(authFor('helper-user', ['helper-role'])).toEqual({
        owner: false,
        admin: false,
        manager: false,
        helper: true,
        staff: true
    });
    expect(authFor('member-user', [])).toEqual({
        owner: false,
        admin: false,
        manager: false,
        helper: false,
        staff: false
    });
});

function authFor(userID, memberRoles) {
    const context = { config, memberRoles, userID };

    return {
        owner: isOwner(context),
        admin: isAdmin(context),
        manager: isManager(context),
        helper: isHelper(context),
        staff: isStaff(context)
    };
}
