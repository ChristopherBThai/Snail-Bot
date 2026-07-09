import mongoose from 'mongoose';
import mysql from 'mysql2/promise';
import { createClient } from 'redis';
import { createUserQuestModel } from './userQuest.js';

export async function createOwOMongo(uri) {
    if (!uri) {
        throw new Error('OWO_MONGO_URI is not configured.');
    }

    try {
        const connection = await mongoose.createConnection(uri).asPromise();

        return {
            connection,
            UserQuest: createUserQuestModel(connection)
        };
    } catch (error) {
        throw new Error(`OwO Mongo connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function createOwORedis(url) {
    if (!url) {
        throw new Error('OWO_REDIS_URL is not configured.');
    }

    try {
        const client = createClient({ url });
        await client.connect();

        return {
            client
        };
    } catch (error) {
        throw new Error(`OwO Redis connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function createOwOMySQL(uri) {
    if (!uri) {
        throw new Error('OWO_MYSQL_URI is not configured.');
    }

    try {
        const pool = mysql.createPool({
            uri,
            database: 'owo',
            waitForConnections: true,
            connectionLimit: 5,
            namedPlaceholders: false
        });

        await pool.query('SELECT 1');

        return {
            pool
        };
    } catch (error) {
        throw new Error(`OwO MySQL connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
