import { connectOwOMySQL } from './owo/mysql.js';

/**
 * Snail's connected databases, grouped by data owner.
 *
 * @typedef {object} Databases
 * @property {{ mysql: import('mysql2/promise').Pool | undefined }} owo OwO-owned databases.
 */

/**
 * Attempts to connect every configured database used by the current runtime.
 *
 * @param {{ owo: { mysqlUri: string | undefined } }} config
 * @param {object} log
 * @returns {Promise<{ databases: Databases; unavailable: { owoMySQL?: string } }>}
 */
export async function connectDatabases({ owo }, log) {
    let mysql;
    const unavailable = {};

    if (!owo.mysqlUri) {
        unavailable.owoMySQL = 'OWO_MYSQL_URI (.env)';
    } else {
        try {
            log.info('Connecting to OwO MySQL');
            mysql = await connectOwOMySQL(owo.mysqlUri);
            log.info('Connected to OwO MySQL');
        } catch (error) {
            unavailable.owoMySQL = 'OwO MySQL (service)';
            log.warn('OwO MySQL unavailable', { error });
        }
    }

    return {
        databases: {
            owo: {
                mysql,
            },
        },
        unavailable,
    };
}
