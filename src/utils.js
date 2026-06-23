export const auth = Object.freeze({
    admin: (context) => isAdmin(context),
    helper: (context) => isHelper(context),
    manager: (context) => isManager(context),
    staff: (context) => isStaff(context),
    owner: (context) => isOwner(context)
});

export function lines(...values) {
    return values.join('\n');
}

export function getColor(context, key) {
    return context.config.colors[key];
}

export function isOwner(context) {
    return Boolean(context.config.users.owner && context.userID === context.config.users.owner);
}

export function isHelper(context) {
    return hasRole(context, context.config.roles.helper) || isManager(context);
}

export function isManager(context) {
    return hasRole(context, context.config.roles.manager) || isAdmin(context);
}

export function isAdmin(context) {
    return hasRole(context, context.config.roles.admin) || isOwner(context);
}

export function isStaff(context) {
    return isHelper(context);
}

function hasRole(context, roleIDs) {
    return roleIDs.some((roleID) => context.memberRoles.includes(roleID));
}

export function getOptionValue(data, name) {
    return getCommandOptions(data).find((option) => option.name === name)?.value;
}

export function getCommandOptions(data) {
    return getSubcommand(data)?.options ?? data.options ?? [];
}

export function getSubcommand(data) {
    return data.options?.find((option) => option.type === 1 || option.type === 2);
}
