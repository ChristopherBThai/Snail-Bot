import mysql from 'mysql2/promise';

/**
 * Connects and verifies the OwO MySQL connection pool.
 *
 * @param {string} uri
 * @returns {Promise<import('mysql2/promise').Pool>}
 */
export async function connectOwOMySQL(uri) {
    const pool = mysql.createPool({
        uri,
        supportBigNumbers: true,
        charset: 'utf8mb4',
        connectionLimit: 5,
    });

    try {
        const connection = await pool.getConnection();
        connection.release();
    } catch (error) {
        await pool.end();
        throw error;
    }

    return pool;
}
