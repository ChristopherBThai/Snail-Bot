import mongoose from 'mongoose';
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
