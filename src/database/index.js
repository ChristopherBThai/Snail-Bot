import { createOwOMongo, createOwOMySQL, createOwORedis } from './owo/index.js';
import { createSnailMongo } from './snail/index.js';

export async function createDatabases(config) {
    return {
        owo: {
            mongo: await createOwOMongo(config.database.owoMongoUri),
            mysql: await createOwOMySQL(config.database.owoMysqlUri),
            redis: await createOwORedis(config.database.owoRedisUrl)
        },
        snail: {
            mongo: await createSnailMongo(config.database.snailMongoUri)
        }
    };
}
