import mongoose from 'mongoose';
import { createSettingModel } from './setting.js';
import { createUserModel } from './user.js';

export async function connectSnailMongo(uri) {
    const connection = mongoose.createConnection(uri);

    try {
        await connection.asPromise();
    } catch (error) {
        await connection.close().catch(() => {});
        throw error;
    }

    return {
        connection,
        Setting: createSettingModel(connection),
        User: createUserModel(connection),
    };
}
