import mongoose from 'mongoose';
import { createChannelModel } from './channel.js';
import { createConfigModel } from './config.js';
import { createBuilderDraftModel } from './messageBuilder.js';
import { createQuestModel } from './quest.js';
import { createTagModel } from './tag.js';
import { createUserModel } from './user.js';
import { createUserLogModel } from './userLog.js';

export async function createSnailMongo(uri) {
    if (!uri) {
        throw new Error('SNAIL_MONGO_URI is not configured.');
    }

    try {
        const connection = await mongoose.createConnection(uri).asPromise();

        return {
            connection,
            BuilderDraft: createBuilderDraftModel(connection),
            Channel: createChannelModel(connection),
            Config: createConfigModel(connection),
            Quest: createQuestModel(connection),
            Tag: createTagModel(connection),
            User: createUserModel(connection),
            UserLog: createUserLogModel(connection)
        };
    } catch (error) {
        throw new Error(`Snail Mongo connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
