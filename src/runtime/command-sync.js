import { PermissionFlagsBits } from 'discord-api-types/v10';

export function getCommandSyncDefinition(route) {
    const { global, staff, ...command } = route.command;

    if (!staff) {
        return command;
    }

    return {
        ...command,
        default_member_permissions: PermissionFlagsBits.BypassSlowmode.toString()
    };
}
