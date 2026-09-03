import { createElasticApm } from './elasticApm.js';
import { createOpenRouter } from './openRouter.js';
import { createOwOAPI } from './owo/api.js';
import { connectOwOMongo } from './owo/mongo/index.js';
import { connectOwOMySQL } from './owo/mysql.js';
import { connectOwORedis } from './owo/redis.js';
import { connectQdrant } from './qdrant.js';
import { connectSnailMongo } from './snail/mongo/index.js';

/**
 * @typedef {object} SnailServices
 * @property {Awaited<ReturnType<typeof connectSnailMongo>> | undefined} mongo
 */

/**
 * @typedef {object} OwOServices
 * @property {ReturnType<typeof createOwOAPI> | undefined} api
 * @property {Awaited<ReturnType<typeof connectOwOMongo>> | undefined} mongo
 * @property {import('mysql2/promise').Pool | undefined} mysql
 * @property {Awaited<ReturnType<typeof connectOwORedis>> | undefined} redis
 */

/**
 * @typedef {object} Services
 * @property {ReturnType<typeof createElasticApm>} elasticApm
 * @property {ReturnType<typeof createOpenRouter> | undefined} openRouter
 * @property {Awaited<ReturnType<typeof connectQdrant>> | undefined} qdrant
 * @property {SnailServices} snail Snail-owned services.
 * @property {OwOServices} owo OwO-owned services.
 */

/**
 * @typedef {object} ServiceEnvironment
 * @property {string | undefined} openRouterApiKey
 * @property {string | undefined} qdrantApiKey
 * @property {string | undefined} qdrantUrl
 * @property {{ mongoUri: string | undefined }} snail
 * @property {{
 *     apiPassword: string | undefined;
 *     apiUri: string | undefined;
 *     mongoUri: string | undefined;
 *     mysqlUri: string | undefined;
 *     redisUrl: string | undefined;
 * }} owo
 */

/**
 * @typedef {object} OpenRouterConfig
 * @property {string} embeddingModel
 * @property {string} chatModel
 * @property {string} rerankModel
 * @property {number} maxTokens
 * @property {number} temperature
 * @property {string[]} excludedProviders
 */

/**
 * Initializes every configured external service used by the current runtime.
 *
 * @param {object} options
 * @param {ServiceEnvironment} options.environment
 * @param {OpenRouterConfig | undefined} options.openRouter
 * @param {object} options.log
 * @returns {Promise<Services>}
 */
export async function createServices({ environment, openRouter: openRouterConfig, log }) {
    const { openRouterApiKey, qdrantApiKey, qdrantUrl, snail, owo } = environment;
    const elasticApm = createElasticApm(qdrantUrl);

    const missingOpenRouterConfig = [
        ['embeddingModel', openRouterConfig?.embeddingModel],
        ['chatModel', openRouterConfig?.chatModel],
        ['rerankModel', openRouterConfig?.rerankModel],
        ['maxTokens', openRouterConfig?.maxTokens],
        ['temperature', openRouterConfig?.temperature],
        ['excludedProviders', openRouterConfig?.excludedProviders],
    ]
        .filter(([, value]) => value === undefined)
        .map(([key]) => `openRouter.${key} (config)`);
    const openRouterMissing = [...(!openRouterApiKey ? ['OPENROUTER_API_KEY (.env)'] : []), ...missingOpenRouterConfig];

    let openRouter;
    if (openRouterMissing.length) logMissingConfiguration('OpenRouter', openRouterMissing, log);
    else openRouter = createOpenRouter(openRouterConfig, openRouterApiKey, elasticApm);

    const apiMissing = [
        ...(!owo.apiUri ? ['OWO_API_URI (.env)'] : []),
        ...(!owo.apiPassword ? ['OWO_API_PASSWORD (.env)'] : []),
    ];
    let api;
    if (apiMissing.length) logMissingConfiguration('OwO API', apiMissing, log);
    else api = createOwOAPI(owo.apiUri, owo.apiPassword);

    const [snailMongo, qdrant, owoMySQL, owoMongo, owoRedis] = await Promise.all([
        connectOptional({
            missing: snail.mongoUri ? [] : ['SNAIL_MONGO_URI (.env)'],
            name: 'Snail Mongo',
            connect: () => connectSnailMongo(snail.mongoUri),
            log,
        }),
        connectOptional({
            missing: [!qdrantUrl && 'QDRANT_URL (.env)', !qdrantApiKey && 'QDRANT_API_KEY (.env)'].filter(Boolean),
            name: 'Qdrant',
            connect: () => connectQdrant(qdrantUrl, qdrantApiKey),
            log,
        }),
        connectOptional({
            missing: owo.mysqlUri ? [] : ['OWO_MYSQL_URI (.env)'],
            name: 'OwO MySQL',
            connect: () => connectOwOMySQL(owo.mysqlUri),
            log,
        }),
        connectOptional({
            missing: owo.mongoUri ? [] : ['OWO_MONGO_URI (.env)'],
            name: 'OwO Mongo',
            connect: () => connectOwOMongo(owo.mongoUri),
            log,
        }),
        connectOptional({
            missing: owo.redisUrl ? [] : ['OWO_REDIS_URL (.env)'],
            name: 'OwO Redis',
            connect: () => connectOwORedis(owo.redisUrl, log),
            log,
        }),
    ]);

    return {
        elasticApm,
        openRouter,
        qdrant,
        snail: {
            mongo: snailMongo,
        },
        owo: {
            api,
            mongo: owoMongo,
            mysql: owoMySQL,
            redis: owoRedis,
        },
    };
}

async function connectOptional({ missing, name, connect, log }) {
    if (missing.length) {
        logMissingConfiguration(name, missing, log);
        return;
    }

    try {
        log.info(`Connecting to ${name}`);
        const value = await connect();
        log.info(`Connected to ${name}`);
        return value;
    } catch (error) {
        log.warn(`${name} unavailable`, { error });
    }
}

function logMissingConfiguration(name, missing, log) {
    log.warn(`${name} not configured`, { missing });
}
