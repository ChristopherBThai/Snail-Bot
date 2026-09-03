import { createRestManager } from '@discordeno/rest';
import { PermissionFlagsBits } from 'discord-api-types/v10';
import { loadConfig } from './config/index.js';
import { createGateway } from './discord/gateway.js';
import { createDiscordenoLogger } from './discord/logger.js';
import { createLogging } from './logging/index.js';
import { loadLoggingLevels } from './logging/repository.js';
import { setupPackages } from './packages.js';
import { createServices } from './services/index.js';

async function start() {
    const { name, config, environment } = await loadConfig();
    const logging = createLogging(config.logging);
    const log = logging.createLogger('snail');
    const startupTimer = log.time();

    log.info('Starting Snail');
    log.debug('Loaded configuration', {
        name,
        guildId: config.guildId,
    });

    const rest = createRestManager({
        token: environment.token,
        logger: createDiscordenoLogger(logging.createLogger('rest')),
    });
    startupTimer.checkpoint('rest');
    log.debug('Created REST manager');

    const services = await createServices({
        environment: environment.services,
        openRouter: config.openRouter,
        log,
    });
    startupTimer.checkpoint('services');

    if (services.snail.mongo) {
        try {
            const levels = await loadLoggingLevels(services.snail.mongo.Setting);
            for (const [loggerName, level] of Object.entries(levels)) {
                try {
                    logging.setLevel(loggerName, level);
                } catch (error) {
                    log.warn('Ignored invalid configured log level', { error, logger: loggerName, level });
                }
            }
            log.debug('Loaded configured log levels', { loggerCount: Object.keys(levels).length });
        } catch (error) {
            log.warn('Could not load configured log levels', { error });
        }
    }
    startupTimer.checkpoint('logging');

    const packages = await setupPackages({ config, logging, log, rest, services });
    startupTimer.checkpoint('packages');

    await synchronizeCommands(rest, config.guildId, packages.commands, log);
    startupTimer.checkpoint('commands');

    const gateway = createGateway({
        config,
        token: environment.token,
        logging,
        log,
        packages,
        rest,
    });
    log.info('Connecting to Discord gateway');
    await gateway.spawnShards();
    startupTimer.checkpoint('gateway');
    startupTimer.info('Snail started');
}

async function synchronizeCommands(rest, guildId, commands, log) {
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

    log.info('Synchronizing guild application commands', { guildId, commandCount: guildCommands.length });
    await rest.upsertGuildApplicationCommands(guildId, guildCommands);
    log.info('Guild application commands synchronized', { guildId, commandCount: guildCommands.length });
}

start().catch((error) => {
    console.error('Startup failed', error);
    process.exit(1);
});
