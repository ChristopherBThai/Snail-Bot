import { loadConfig } from './config.js';
import { createGateway, createRest, synchronizeCommands } from './discord.js';
import { createLogging } from './logger.js';
import { setupPackages } from './packages.js';

const logging = createLogging();
const log = logging.createLogger('snail', true);

async function start() {
    log.info('Starting Snail');

    const { name, token, config } = await loadConfig();
    log.debug('Loaded configuration', {
        name,
        guildId: config.guildId,
    });

    const rest = createRest({ token, logging });
    log.debug('Created REST manager');

    const packages = setupPackages({ config, logging, log, rest });

    await synchronizeCommands({
        rest,
        guildId: config.guildId,
        commands: packages.commands,
        log,
    });

    const gateway = createGateway({ config, token, logging, log, packages, rest });
    log.info('Connecting to Discord gateway');
    await gateway.spawnShards();
}

start().catch((error) => {
    log.error('Startup failed', { error });
    process.exitCode = 1;
});
