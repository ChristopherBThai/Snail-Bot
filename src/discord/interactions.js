/**
 * A camel-cased Discord interaction received through Discordeno Gateway.
 *
 * @typedef {import('@discordeno/types').Camelize<import('@discordeno/types').DiscordInteraction>} Interaction
 */

/**
 * Gets the user who invoked an interaction in either a guild or user context.
 *
 * @param {Interaction} interaction
 */
export function getInteractionUser(interaction) {
    return interaction.member?.user ?? interaction.user;
}

/**
 * Gets the resolved user targeted by a user context command.
 *
 * @param {Interaction} interaction
 */
export function getTargetUser(interaction) {
    const targetId = interaction.data?.targetId;
    return targetId ? interaction.data.resolved?.users?.[targetId] : undefined;
}

/**
 * Gets a text input value from a submitted modal, including inputs nested under
 * Labels or legacy Action Rows.
 *
 * @param {Interaction} interaction
 * @param {string} customId
 */
export function getModalValue(interaction, customId) {
    return findComponent(interaction.data?.components ?? [], customId)?.value;
}

function findComponent(components, customId) {
    for (const component of components) {
        if (component.customId === customId) return component;

        const children = component.components ?? (component.component ? [component.component] : []);
        const match = findComponent(children, customId);
        if (match) return match;
    }
}
