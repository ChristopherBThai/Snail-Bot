import { loadConfig } from './config/index.js';
import { createGateway } from './discord/gateway.js';
import { createRest, synchronizeCommands } from './discord/rest.js';
import { createLogging } from './logging/index.js';
import { loadLoggingLevels } from './logging/repository.js';
import { setupPackages } from './packages.js';
import { createServices } from './services/index.js';

const logging = createLogging();
const log = logging.createLogger('snail', true);
const startupTimer = log.time();

async function start() {
    log.info('Starting Snail');

    const { name, config, environment } = await loadConfig();
    startupTimer.checkpoint('config');
    log.debug('Loaded configuration', {
        name,
        guildId: config.guildId,
    });

    const rest = createRest({ token: environment.token, logging });
    startupTimer.checkpoint('rest');
    log.debug('Created REST manager');

    const { services, unavailable } = await createServices(environment.services, log);
    startupTimer.checkpoint('services');

    if (services.snail.mongo) {
        try {
            const levels = await loadLoggingLevels(services.snail.mongo.Setting);
            for (const [name, level] of Object.entries(levels)) {
                try {
                    logging.setLevel(name, level);
                } catch (error) {
                    log.warn('Ignored invalid configured log level', { error, logger: name, level });
                }
            }
            log.debug('Loaded configured log levels', { loggerCount: Object.keys(levels).length });
        } catch (error) {
            log.warn('Could not load configured log levels', { error });
        }
    }
    startupTimer.checkpoint('logging');

    const packages = await setupPackages({ config, logging, log, rest, services, unavailable });
    startupTimer.checkpoint('packages');

    await synchronizeCommands({
        rest,
        guildId: config.guildId,
        commands: packages.commands,
        log,
    });
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

start().catch((error) => {
    startupTimer.error('Startup failed', { error });
    process.exit(1);
});
