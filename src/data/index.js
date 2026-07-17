import { connectSnailMongo } from './snail/mongo.js';

export async function connectDatabases({ config }) {
    return {
        snail: {
            mongo: await connectSnailMongo(config.databases.snailMongoUri)
        },
        owo: {}
    };
}
