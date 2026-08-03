import 'dotenv/config';

/**
 * Loads and validates Snail's environment and selected public configuration.
 */
export async function loadConfig() {
    const token = process.env.DISCORD_TOKEN?.trim().replace(/^Bot\s+/i, '') || undefined;
    const name = process.env.CONFIG_NAME?.trim() || undefined;
    const owoMySQLUri = process.env.OWO_MYSQL_URI?.trim() || undefined;

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
            databases: {
                owo: {
                    mysqlUri: owoMySQLUri,
                },
            },
        },
    };
}
