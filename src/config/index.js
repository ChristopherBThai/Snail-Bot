import { config as loadDotenv } from 'dotenv';

export function normalizeToken(token) {
    if (!token) {
        return null;
    }

    const tokenText = String(token).trim();
    const normalizedToken = tokenText.replace(/^Bot\s+/i, '');

    return normalizedToken || null;
}

export async function loadConfig() {
    const envResult = loadDotenv({ quiet: true });

    if (envResult.error && envResult.error.code !== 'ENOENT') {
        throw envResult.error;
    }

    const debug = process.env.DEBUG === 'true';
    const config = (await import(debug ? './config.debug.js' : './config.js')).default;

    return {
        debug,
        database: {
            snailMongoUri: process.env.SNAIL_MONGO_URI,
            owoMongoUri: process.env.OWO_MONGO_URI,
            owoRedisUrl: process.env.OWO_REDIS_URL
        },
        discord: {
            applicationId: config.discord.applicationId,
            guildId: config.discord.guildId,
            token: normalizeToken(process.env.BOT_TOKEN)
        },
        modules: config.modules,
        roles: config.roles,
        colors: config.colors,
        users: config.users
    };
}
