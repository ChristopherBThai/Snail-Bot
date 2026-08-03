import { ApplicationCommandType } from 'discord-api-types/v10';
import { hasAdminAccess, hasHelperAccess, hasManagerAccess } from '../discord/auth.js';

const AFK_COMMAND_DEFINITION = {
    type: ApplicationCommandType.ChatInput,
    name: 'afk',
    description: 'Toggle your presence on the member list.',
};

export default function setup({ config, rest }) {
    const roles = config.roles ?? {};
    const displayRoles = [roles.admin?.display, roles.manager?.display, roles.helper?.display];
    const missing = [];

    for (const name of ['helper', 'manager', 'admin']) {
        if (!roles[name]?.permission) missing.push(`roles.${name}.permission (config)`);
        if (!roles[name]?.display) missing.push(`roles.${name}.display (config)`);
    }

    return {
        name: 'AFK Command',
        missing,
        commands: [
            {
                definition: AFK_COMMAND_DEFINITION,
                staff: true,
                authorize: hasHelperAccess,
                async handle({ interaction, respond }) {
                    const guildId = interaction.guildId;
                    const userId = interaction.member?.user?.id ?? interaction.user?.id;

                    if (!guildId || !interaction.member || !userId) {
                        await respond('This command can only be used in a server.', {
                            ephemeral: true,
                        });
                        return;
                    }

                    const staffRole = getHighestStaffRole(interaction, config);
                    if (!staffRole) {
                        throw new Error(`Could not determine staff role for user: ${userId}`);
                    }

                    const memberRoles = interaction.member.roles;
                    const hasDisplayRole = memberRoles.includes(staffRole.display);
                    const staleDisplayRoles = displayRoles.filter(
                        (roleId) => roleId !== staffRole.display && memberRoles.includes(roleId),
                    );

                    for (const roleId of staleDisplayRoles) {
                        await rest.removeRole(guildId, userId, roleId, '/afk removed stale display role');
                    }

                    if (hasDisplayRole) {
                        await rest.removeRole(guildId, userId, staffRole.display, '/afk removed');
                        await respond('You have been removed from the member list.', {
                            ephemeral: true,
                        });
                        return;
                    }

                    await rest.addRole(guildId, userId, staffRole.display, '/afk added');
                    await respond('You have been added to the member list.', { ephemeral: true });
                },
            },
        ],
    };
}

function getHighestStaffRole(interaction, config) {
    if (hasAdminAccess(interaction, config)) return config.roles.admin;
    if (hasManagerAccess(interaction, config)) return config.roles.manager;
    if (hasHelperAccess(interaction, config)) return config.roles.helper;
    return undefined;
}
