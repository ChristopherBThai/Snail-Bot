import mongoose from 'mongoose';
import { createChannelModel } from './channel.js';
import { createTagModel } from './tag.js';
import { createUserModel } from './user.js';

export async function connectSnailMongo(uri) {
    if (!uri) {
        throw new Error('SNAIL_MONGO_URI is required to start Snail.');
    }

    const connection = await mongoose.createConnection(uri).asPromise();

    return {
        connection,
        models: {
            Channel: createChannelModel(connection),
            Tag: createTagModel(connection),
            User: createUserModel(connection)
        }
    };
}
