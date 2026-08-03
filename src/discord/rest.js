import { createRestManager } from '@discordeno/rest';
import { PermissionFlagsBits } from 'discord-api-types/v10';
import { createDiscordenoLogger } from './logger.js';

/**
 * Creates Snail's Discord REST manager.
 */
export function createRest({ token, logging }) {
    return createRestManager({
        token,
        logger: createDiscordenoLogger(logging.createLogger('rest', true)),
    });
}

/**
 * Synchronizes Snail's global and guild application commands.
 */
export async function synchronizeCommands({ rest, guildId, commands, log }) {
    const globalCommands = [];
    const guildCommands = [];

    for (const command of commands.values()) {
        const definition = {
            ...command.definition,
            ...(command.staff ? { defaultMemberPermissions: PermissionFlagsBits.BypassSlowmode.toString() } : {}),
        };

        (command.global ? globalCommands : guildCommands).push(definition);
    }

    log.info('Synchronizing global application commands', { commandCount: globalCommands.length });
    await rest.upsertGlobalApplicationCommands(globalCommands);
    log.info('Global application commands synchronized', { commandCount: globalCommands.length });

    log.info('Synchronizing guild application commands', {
        guildId,
        commandCount: guildCommands.length,
    });
    await rest.upsertGuildApplicationCommands(guildId, guildCommands);
    log.info('Guild application commands synchronized', {
        guildId,
        commandCount: guildCommands.length,
    });
}
