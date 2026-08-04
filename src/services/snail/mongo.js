import mongoose from 'mongoose';
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
        User: createUserModel(connection),
    };
}
