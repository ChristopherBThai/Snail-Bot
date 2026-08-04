import { createOwOAPI } from './owo/api.js';
import { connectOwOMySQL } from './owo/mysql.js';
import { connectSnailMongo } from './snail/mongo.js';

/**
 * Snail's initialized external services, grouped by owner.
 *
 * @typedef {object} Services
 * @property {{ mongo: Awaited<ReturnType<typeof connectSnailMongo>> | undefined }} snail Snail-owned services.
 * @property {{ api: ReturnType<typeof createOwOAPI> | undefined; mysql: import('mysql2/promise').Pool | undefined }} owo OwO-owned services.
 */

/**
 * Initializes every configured external service used by the current runtime.
 *
 * @param {{ snail: { mongoUri: string | undefined }; owo: { apiPassword: string | undefined; apiUri: string | undefined; mysqlUri: string | undefined } }} config
 * @param {object} log
 * @returns {Promise<{ services: Services; unavailable: { snail: { mongo?: string[] }; owo: { api?: string[]; mysql?: string[] } } }>}
 */
export async function createServices({ snail, owo }, log) {
    let mysql;
    let mongo;
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
                mysql,
            },
        },
        unavailable,
    };
}
