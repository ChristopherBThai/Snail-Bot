import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import 'dotenv/config';
import mongoose from 'mongoose';
import { normalizeMessage } from './discord/messages.js';
import { extractMessageText } from './utils/tags.js';

const SCHEMA_VERSION_ID = 'database:schemaVersion';
const CURRENT_SCHEMA_VERSION = 1;
const OBSOLETE_COLLECTIONS = Object.freeze(['channels', 'configs', 'knowledge', 'quests']);

const QUESTION_PROMPT_VERSION = 'tag-question-v3';
const QUESTION_SYSTEM_PROMPT = 'You generate retrieval scaffolding questions for OwO Discord bot support tags.';
const QUESTION_PROMPT_SOURCE = `${QUESTION_PROMPT_VERSION}:${QUESTION_SYSTEM_PROMPT}`;

async function migrate() {
    const uri = process.env.SNAIL_MONGO_URI?.trim();
    if (!uri) throw new Error('SNAIL_MONGO_URI not configured in .env file');

    const connection = mongoose.createConnection(uri, { autoIndex: false });

    try {
        await connection.asPromise();
        console.log('Connected to Snail Mongo');
        await migrateDatabase(connection.db);
    } finally {
        await connection.close().catch(() => {});
    }
}

async function migrateDatabase(database) {
    const settings = database.collection('settings');
    const stored = await settings.findOne({ _id: SCHEMA_VERSION_ID }, { projection: { value: 1 } });
    const version = stored ? stored.value : 0;

    if (!Number.isInteger(version) || version < 0) {
        throw new Error(`Invalid database schema version: ${version}`);
    }
    if (version > CURRENT_SCHEMA_VERSION) {
        throw new Error(`Database schema version ${version} is newer than supported version ${CURRENT_SCHEMA_VERSION}`);
    }
    if (version === CURRENT_SCHEMA_VERSION) {
        console.log(`Database is already at schema version ${CURRENT_SCHEMA_VERSION}`);
        return;
    }

    console.log('Migrating database to schema version 1');
    const tags = await migrateTags(database);
    const terms = await migrateKnowledgeTerms(database);
    const users = await migrateUsers(database);
    const dropped = await dropObsoleteCollections(database);

    const now = new Date();
    await settings.updateOne(
        { _id: SCHEMA_VERSION_ID },
        {
            $set: { value: 1, updatedAt: now },
            $setOnInsert: { createdAt: now },
        },
        { upsert: true },
    );

    console.log('Database migrated to schema version 1', {
        tags,
        terms,
        optedOutUsers: users,
        droppedCollections: dropped,
    });
}

async function migrateTags(database) {
    const collection = database.collection('tags');
    const documents = await collection.find({ $or: [{ data: { $type: 'string' } }, { _id: '5m' }] }).toArray();
    if (!documents.length) return 0;

    const operations = [];
    for (const document of documents) {
        const tagId = document._id === '5m' ? 'fivemil' : document._id;
        if (!/^[a-z]+$/.test(tagId)) throw new Error(`Cannot migrate invalid tag ID: ${document._id}`);
        const tag = migrateTag(document, tagId);

        if (tagId !== document._id) {
            const existing = await collection.findOne({ _id: tagId });
            if (existing && !isDeepStrictEqual(existing, tag)) {
                throw new Error(`Cannot rename tag ${document._id}: ${tagId} already exists`);
            }
            operations.push({ replaceOne: { filter: { _id: tagId }, replacement: tag, upsert: true } });
            operations.push({ deleteOne: { filter: { _id: document._id } } });
        } else {
            operations.push({ replaceOne: { filter: { _id: tagId }, replacement: tag } });
        }
    }

    await collection.bulkWrite(operations, { ordered: true });
    return documents.length;
}

function migrateTag(document, tagId) {
    const message = document.message ?? normalizeMessage(document.data);
    const text = document.text ?? extractMessageText(message);
    const legacy = document.kb ?? {};
    const textHash = hash(text);
    const currentQuestions = legacy.promptVersion === QUESTION_PROMPT_VERSION && Array.isArray(legacy.questions);
    const knowledgeBase = {
        excluded: document.knowledgeBase?.excluded === true,
        ...(currentQuestions
            ? {
                  questions: legacy.questions.map(({ text: question, hash: questionHash }) => ({
                      text: question,
                      hash: questionHash,
                  })),
                  textHash,
                  generationHash: hash(
                      JSON.stringify({
                          tagId,
                          textHash,
                          promptSource: QUESTION_PROMPT_SOURCE,
                      }),
                  ),
                  ...(legacy.generatedAt ? { generatedAt: legacy.generatedAt } : {}),
              }
            : {}),
    };

    return {
        _id: tagId,
        message,
        text,
        public: document.public ?? document.visibility !== 'kb_only',
        knowledgeBase,
    };
}

async function migrateKnowledgeTerms(database) {
    const collections = await collectionNames(database);
    if (!collections.has('knowledgeterms')) return 0;

    const source = database.collection('knowledgeterms');
    const documents = await source.find({}).toArray();
    if (documents.length) {
        await database.collection('knowledgeTerms').bulkWrite(
            documents.map(({ _id, meaning }) => ({
                replaceOne: {
                    filter: { _id },
                    replacement: { _id, meaning },
                    upsert: true,
                },
            })),
            { ordered: true },
        );
    }
    await database.dropCollection('knowledgeterms');
    return documents.length;
}

async function migrateUsers(database) {
    const collection = database.collection('users');
    const documents = await collection.find({}).toArray();
    const optedOut = documents.filter(isOptedOut);

    if (optedOut.length) {
        await collection.bulkWrite(
            optedOut.map(({ _id }) => ({
                replaceOne: {
                    filter: { _id },
                    replacement: { _id, supporterRoles: { optout: true } },
                    upsert: true,
                },
            })),
            { ordered: true },
        );
        await collection.deleteMany({ _id: { $nin: optedOut.map(({ _id }) => _id) } });
    } else if (documents.length) {
        await collection.deleteMany({});
    }

    return optedOut.length;
}

function isOptedOut(user) {
    const values = [
        user.supporterRoles?.optout,
        user.supporterRoles?.optedOut,
        user.supporterRoles?.disabled,
        user.snailRoles,
    ];
    return values.find((value) => typeof value === 'boolean') === true;
}

async function dropObsoleteCollections(database) {
    const collections = await collectionNames(database);
    const dropped = [];

    for (const name of OBSOLETE_COLLECTIONS) {
        if (!collections.has(name)) continue;
        await database.dropCollection(name);
        dropped.push(name);
    }

    return dropped;
}

async function collectionNames(database) {
    const collections = await database.listCollections({}, { nameOnly: true }).toArray();
    return new Set(collections.map(({ name }) => name));
}

function hash(value) {
    return createHash('sha1').update(value).digest('hex');
}

migrate().catch((error) => {
    console.error('Migration failed', error);
    process.exitCode = 1;
});
