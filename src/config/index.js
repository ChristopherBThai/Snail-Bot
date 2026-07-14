import 'dotenv/config';
import productionConfig from './config.js';

export async function loadConfig() {
    const debug = process.env.DEBUG === 'true';
    const config = debug ? await loadDebugConfig() : productionConfig;

    return {
        ...config,
        debug,
        discord: {
            ...config.discord,
            token: normalizeToken(process.env.BOT_TOKEN)
        },
        databases: {
            snailMongoUri: process.env.SNAIL_MONGO_URI,
            owoMongoUri: process.env.OWO_MONGO_URI,
            owoRedisUrl: process.env.OWO_REDIS_URL,
            owoMysqlUri: process.env.OWO_MYSQL_URI
        }
    };
}

async function loadDebugConfig() {
    try {
        const module = await import('./config.debug.js');
        return module.default;
    } catch (error) {
        if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('config.debug.js')) {
            throw new Error('DEBUG=true requires local src/config/config.debug.js.');
        }

        throw error;
    }
}

function normalizeToken(token) {
    if (typeof token !== 'string') {
        return null;
    }

    const trimmed = token.trim();

    if (trimmed === '') {
        return null;
    }

    return trimmed.replace(/^Bot\s+/i, '');
}
