/**
 * @typedef {import('@discordeno/types').Camelize<import('@discordeno/types').DiscordInteraction>} Interaction
 */

export function hasOwnerAccess(interaction, config) {
    const ownerId = config.users?.owner;
    const userId = interaction.member?.user?.id ?? interaction.user?.id;

    return Boolean(ownerId && userId === ownerId);
}

export function hasAdminAccess(interaction, config) {
    return hasRole(interaction, config.roles?.admin?.permission) || hasOwnerAccess(interaction, config);
}

export function hasManagerAccess(interaction, config) {
    return hasRole(interaction, config.roles?.manager?.permission) || hasAdminAccess(interaction, config);
}

export function hasHelperAccess(interaction, config) {
    return hasRole(interaction, config.roles?.helper?.permission) || hasManagerAccess(interaction, config);
}

/**
 * @param {Interaction} interaction
 * @param {string | undefined} roleId
 */
function hasRole(interaction, roleId) {
    return Boolean(roleId && interaction.member?.roles.includes(roleId));
}
