import 'dotenv/config';

/**
 * Loads and validates Snail's environment and selected public configuration.
 */
export async function loadConfig() {
    const token = process.env.DISCORD_TOKEN?.trim().replace(/^Bot\s+/i, '') || undefined;
    const name = process.env.CONFIG_NAME?.trim() || undefined;

    if (!token) {
        throw new Error('DISCORD_TOKEN not configured in .env file');
    }

    if (!name) {
        throw new Error('CONFIG_NAME not configured in .env file');
    }

    let config;
    try {
        config = (await import(`./${name}.json`, { with: { type: 'json' } })).default;
    } catch (error) {
        if (error?.code === 'ERR_MODULE_NOT_FOUND') {
            throw new Error(`Could not find src/config/${name}.json`);
        }

        throw error;
    }

    if (!config.guildId) {
        throw new Error('Config file is missing guildId');
    }

    return {
        name,
        config,
        environment: {
            token,
            services: {
                snail: {
                    mongoUri: process.env.SNAIL_MONGO_URI?.trim() || undefined,
                },
                owo: {
                    apiPassword: process.env.OWO_API_PASSWORD?.trim() || undefined,
                    apiUri: process.env.OWO_API_URI?.trim() || undefined,
                    mongoUri: process.env.OWO_MONGO_URI?.trim() || undefined,
                    mysqlUri: process.env.OWO_MYSQL_URI?.trim() || undefined,
                    redisUrl: process.env.OWO_REDIS_URL?.trim() || undefined,
                },
            },
        },
    };
}
