import 'dotenv/config';

/**
 * Loads and validates Snail's environment and selected public configuration.
 */
export async function loadConfig() {
    const token = process.env.DISCORD_TOKEN?.trim().replace(/^Bot\s+/i, '') || undefined;
    const name = process.env.CONFIG_NAME;

    if (!token) {
        throw new Error('`DISCORD_TOKEN` Not configured in `.env` file');
    }

    if (!name) {
        throw new Error('`CONFIG_NAME` Not configured in `.env` file');
    }

    let values;
    try {
        values = (await import(`./config/${name}.json`, { with: { type: 'json' } })).default;
    } catch (error) {
        if (error?.code === 'ERR_MODULE_NOT_FOUND') {
            throw new Error(`Could not find \`src/config/${name}.json\``);
        }

        throw error;
    }

    if (!values.guildId) {
        throw new Error('Config file is missing `guildId`');
    }

    return { name, token, config: values };
}
