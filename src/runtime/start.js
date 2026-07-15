import { loadConfig } from '../config/index.js';
import { connectDatabases } from '../data/index.js';
import { startGateway } from '../discord/gateway.js';
import { createDiscordRest } from '../discord/rest.js';
import { createLogger } from '../logging/index.js';
import { getCommandSyncDefinition } from './command-sync.js';
import { createRegistry } from './registry.js';

export async function start() {
    const config = await loadConfig();
    const logger = createLogger();
    const startupLogger = logger.child('startup');

    if (!config.discord.token) {
        throw new Error('BOT_TOKEN is required to initialize Discord REST and gateway.');
    }

    const databases = await connectDatabases({ config, logger });
    const rest = createDiscordRest(config, { logger: logger.child('discord') });
    const registry = createRegistry({ config, databases, logger, rest });

    const guildCommands = [];
    const globalCommands = [];

    for (const route of registry.routes.commandRoutes()) {
        const command = getCommandSyncDefinition(route);

        if (route.command.global === true) {
            globalCommands.push(command);
        } else {
            guildCommands.push(command);
        }
    }

    startupLogger.info('guild_command_sync.planned', {
        commands: guildCommands.length
    });
    await rest.syncGuildCommands(guildCommands);
    startupLogger.info('guild_command_sync.completed', {
        commands: guildCommands.length
    });

    startupLogger.info('global_command_sync.planned', {
        commands: globalCommands.length
    });
    await rest.syncGlobalCommands(globalCommands);
    startupLogger.info('global_command_sync.completed', {
        commands: globalCommands.length
    });

    await startGateway({ config, logger: logger.child('gateway'), routes: registry.routes, rest });
}
