import { ApplicationCommandType, PermissionFlagsBits } from 'discord-api-types/v10';

export function getCommandKey(command) {
    return `${command.type ?? ApplicationCommandType.ChatInput}:${command.name}`;
}

export function getCommandDefinition(command) {
    if (!command.staff) {
        return command.definition;
    }

    return {
        ...command.definition,
        default_member_permissions: PermissionFlagsBits.BypassSlowmode.toString()
    };
}
