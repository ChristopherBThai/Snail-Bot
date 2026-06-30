import { createCommands } from './commands/index.js';
import { loadConfig } from './config/index.js';
import { createDatabases } from './database/index.js';
import { ModuleRegistry } from './modules/index.js';
import { QuestListModule } from './modules/quest-list/index.js';
import { createDiscordEventRouter } from './systems/discord/event-router.js';
import { createDiscordGateway } from './systems/discord/gateway.js';
import { createDiscordRest } from './systems/discord/rest.js';
import { loadLogLevels } from './systems/logger/data.js';
import { createLogging } from './systems/logger/index.js';
import { createMessageBuilder } from './systems/message-builder/index.js';

async function main() {
    const config = await loadConfig();
    const logging = createLogging({ limit: config.modules.defaultLogsLimit });
    const logger = logging.createLogger({
        console: true,
        sourceID: 'runtime'
    });

    const startupTimer = logger.time('startup.completed');
    logger.info('startup.begin');
    logger.debug('startup.config_loaded');

    if (!config.discord.token) {
        throw new Error('BOT_TOKEN is required to initialize Discord REST and gateway.');
    }

    if (!config.discord.applicationId) {
        throw new Error('discord.applicationId is required to sync guild commands.');
    }

    if (!config.discord.guildId) {
        throw new Error('discord.guildId is required to sync guild commands.');
    }

    const databasesTimer = logger.time('startup.databases_connected');
    const databases = await createDatabases(config);
    databasesTimer.end({}, { level: 'info' });
    logging.setLevels(await loadLogLevels(databases));

    const modulesTimer = logger.time('startup.modules_initialized');
    const messageBuilder = createMessageBuilder({ databases, logging });
    const commands = createCommands({ config, databases, logging, messageBuilder });
    const modules = new ModuleRegistry([new QuestListModule({ config, databases, logging })]);
    await modules.init();
    modulesTimer.end(
        {
            moduleCount: modules.sorted.length
        },
        { level: 'info' }
    );

    const discordLogger = logging.createLogger({ sourceID: 'discord' });
    const rest = createDiscordRest(config.discord.token, {
        applicationId: config.discord.applicationId,
        logger: discordLogger
    });
    const registeredCommands = [...commands, ...modules.commands];
    const router = createDiscordEventRouter({
        commands: registeredCommands,
        components: messageBuilder.routes.components,
        config,
        logger: discordLogger,
        modals: messageBuilder.routes.modals,
        modules,
        rest
    });

    const commandSyncTimer = logger.time('discord.command_sync.completed', {
        commandCount: registeredCommands.length
    });
    logger.info('discord.command_sync.started', { commandCount: registeredCommands.length });
    await rest.syncGuildCommands(config.discord.applicationId, config.discord.guildId, registeredCommands);
    commandSyncTimer.end({}, { level: 'info' });

    const gatewayTimer = logger.time('startup.gateway_started');
    const gateway = createDiscordGateway({ router, token: config.discord.token });
    await gateway.start();
    gatewayTimer.end({}, { level: 'info' });
    startupTimer.end({}, { level: 'info' });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
