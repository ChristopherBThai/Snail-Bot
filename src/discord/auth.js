export function hasManagerAccess(context) {
    return (
        context.userId === context.config.users.owner ||
        hasRole(context.memberRoles, context.config.roles.admin) ||
        hasRole(context.memberRoles, context.config.roles.manager)
    );
}

function hasRole(memberRoles, allowedRoles) {
    return memberRoles.some((roleId) => allowedRoles.includes(roleId));
}
