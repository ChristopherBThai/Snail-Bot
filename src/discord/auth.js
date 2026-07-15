export function hasOwnerAccess(context) {
    return context.userId === context.config.users.owner;
}

export function hasAdminAccess(context) {
    return hasOwnerAccess(context) || hasRole(context.memberRoles, context.config.roles.admin);
}

export function hasManagerAccess(context) {
    return hasAdminAccess(context) || hasRole(context.memberRoles, context.config.roles.manager);
}

export function hasHelperAccess(context) {
    return hasManagerAccess(context) || hasRole(context.memberRoles, context.config.roles.helper);
}

export function hasStaffAccess(context) {
    return hasHelperAccess(context);
}

function hasRole(memberRoles, allowedRoles) {
    return memberRoles.includes(allowedRoles.permission);
}
