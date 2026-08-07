import { createOwOAPI } from './owo/api.js';
import { connectOwOMongo } from './owo/mongo.js';
import { connectOwOMySQL } from './owo/mysql.js';
import { connectOwORedis } from './owo/redis.js';
import { connectSnailMongo } from './snail/mongo.js';

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
 * @property {SnailServices} snail Snail-owned services.
 * @property {OwOServices} owo OwO-owned services.
 */

/**
 * @typedef {object} ServiceConfig
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
 * @typedef {object} UnavailableServices
 * @property {{ mongo?: string[] }} snail
 * @property {{ api?: string[]; mongo?: string[]; mysql?: string[]; redis?: string[] }} owo
 */

/**
 * Initializes every configured external service used by the current runtime.
 *
 * @param {ServiceConfig} config
 * @param {object} log
 * @returns {Promise<{ services: Services; unavailable: UnavailableServices }>}
 */
export async function createServices({ snail, owo }, log) {
    let mysql;
    let mongo;
    let owoMongo;
    let redis;
    const unavailable = { snail: {}, owo: {} };

    if (!snail.mongoUri) {
        unavailable.snail.mongo = ['SNAIL_MONGO_URI (.env)'];
    } else {
        try {
            log.info('Connecting to Snail Mongo');
            mongo = await connectSnailMongo(snail.mongoUri);
            log.info('Connected to Snail Mongo');
        } catch (error) {
            unavailable.snail.mongo = ['Snail Mongo (service)'];
            log.warn('Snail Mongo unavailable', { error });
        }
    }

    if (!owo.mysqlUri) {
        unavailable.owo.mysql = ['OWO_MYSQL_URI (.env)'];
    } else {
        try {
            log.info('Connecting to OwO MySQL');
            mysql = await connectOwOMySQL(owo.mysqlUri);
            log.info('Connected to OwO MySQL');
        } catch (error) {
            unavailable.owo.mysql = ['OwO MySQL (service)'];
            log.warn('OwO MySQL unavailable', { error });
        }
    }

    if (!owo.mongoUri) {
        unavailable.owo.mongo = ['OWO_MONGO_URI (.env)'];
    } else {
        try {
            log.info('Connecting to OwO Mongo');
            owoMongo = await connectOwOMongo(owo.mongoUri);
            log.info('Connected to OwO Mongo');
        } catch (error) {
            unavailable.owo.mongo = ['OwO Mongo (service)'];
            log.warn('OwO Mongo unavailable', { error });
        }
    }

    if (!owo.redisUrl) {
        unavailable.owo.redis = ['OWO_REDIS_URL (.env)'];
    } else {
        try {
            log.info('Connecting to OwO Redis');
            redis = await connectOwORedis(owo.redisUrl);
            log.info('Connected to OwO Redis');
        } catch (error) {
            unavailable.owo.redis = ['OwO Redis (service)'];
            log.warn('OwO Redis unavailable', { error });
        }
    }

    if (!owo.apiUri) {
        unavailable.owo.api ??= [];
        unavailable.owo.api.push('OWO_API_URI (.env)');
    }

    if (!owo.apiPassword) {
        unavailable.owo.api ??= [];
        unavailable.owo.api.push('OWO_API_PASSWORD (.env)');
    }

    const api = owo.apiUri && owo.apiPassword ? createOwOAPI(owo.apiUri, owo.apiPassword) : undefined;

    return {
        services: {
            snail: {
                mongo,
            },
            owo: {
                api,
                mongo: owoMongo,
                mysql,
                redis,
            },
        },
        unavailable,
    };
}
