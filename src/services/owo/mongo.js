import mongoose from 'mongoose';
import { createUserQuestModel } from './userQuest.js';

export async function connectOwOMongo(uri) {
    const connection = mongoose.createConnection(uri);

    try {
        await connection.asPromise();
    } catch (error) {
        await connection.close().catch(() => {});
        throw error;
    }

    return {
        UserQuest: createUserQuestModel(connection),
    };
}
