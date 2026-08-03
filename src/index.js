import { loadConfig } from './config/index.js';
import { connectDatabases } from './data/index.js';
import { createGateway } from './discord/gateway.js';
import { createRest, synchronizeCommands } from './discord/rest.js';
import { createLogging } from './logging.js';
import { setupPackages } from './packages.js';

const logging = createLogging();
const log = logging.createLogger('snail', true);

async function start() {
    log.info('Starting Snail');

    const { name, config, environment } = await loadConfig();
    log.debug('Loaded configuration', {
        name,
        guildId: config.guildId,
    });

    const rest = createRest({ token: environment.token, logging });
    log.debug('Created REST manager');

    const { databases, unavailable } = await connectDatabases(environment.databases, log);

    const packages = setupPackages({ config, databases, logging, log, rest, unavailable });

    await synchronizeCommands({
        rest,
        guildId: config.guildId,
        commands: packages.commands,
        log,
    });

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
}

start().catch((error) => {
    log.error('Startup failed', { error });
    process.exit(1);
});
