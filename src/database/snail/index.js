import mongoose from 'mongoose';
import { createConfigModel } from './config.js';
import { createQuestModel } from './quest.js';

export async function createSnailMongo(uri) {
    if (!uri) {
        throw new Error('SNAIL_MONGO_URI is not configured.');
    }

    try {
        const connection = await mongoose.createConnection(uri).asPromise();

        return {
            connection,
            Config: createConfigModel(connection),
            Quest: createQuestModel(connection)
        };
    } catch (error) {
        throw new Error(`Snail Mongo connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
