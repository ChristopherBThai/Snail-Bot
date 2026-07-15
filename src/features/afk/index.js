import { ApplicationCommandType } from 'discord-api-types/v10';
import { hasAdminAccess, hasHelperAccess, hasManagerAccess, hasStaffAccess } from '../../discord/auth.js';

export default {
    routes: [
        {
            kind: 'command',
            id: 'afk:command',
            command: {
                type: ApplicationCommandType.ChatInput,
                name: 'afk',
                description: 'Toggle your presence on the member list.',
                staff: true
            },
            authorize: hasStaffAccess,
            async handle(context) {
                const staffRole = getHighestStaffRole(context);

                if (!context.guildId) {
                    await context.respond('This command can only be used in a sever!', { ephemeral: true });
                    return;
                }

                const hasDisplayRole = context.memberRoles.includes(staffRole.display);
                const staleDisplayRoles = getConfiguredDisplayRoles(context).filter(
                    (roleId) => roleId !== staffRole.display && context.memberRoles.includes(roleId)
                );

                for (const roleId of staleDisplayRoles) {
                    await context.removeMemberRole(
                        context.guildId,
                        context.userId,
                        roleId,
                        '/afk removed stale display role'
                    );
                }

                if (hasDisplayRole) {
                    await context.removeMemberRole(context.guildId, context.userId, staffRole.display, '/afk removed');
                    await context.respond('You have been removed from the member list.', { ephemeral: true });
                    return;
                }

                await context.addMemberRole(context.guildId, context.userId, staffRole.display, '/afk added');
                await context.respond('You have been added to the member list.', { ephemeral: true });
            }
        }
    ]
};

function getHighestStaffRole(context) {
    if (hasAdminAccess(context)) {
        return context.config.roles.admin;
    }

    if (hasManagerAccess(context)) {
        return context.config.roles.manager;
    }

    if (hasHelperAccess(context)) {
        return context.config.roles.helper;
    }

    return undefined;
}

function getConfiguredDisplayRoles(context) {
    return [
        context.config.roles.admin.display,
        context.config.roles.manager.display,
        context.config.roles.helper.display
    ];
}
