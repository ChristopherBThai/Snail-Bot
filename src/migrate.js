import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, open, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

    await backupDatabase(database);

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
        updatedUsers: users,
        droppedCollections: dropped,
    });
}

async function backupDatabase(database) {
    const uri = process.env.SNAIL_MONGO_URI?.trim();
    // Never let mongodump infer all databases (or use authSource as the target).
    const match = uri?.match(/^mongodb(?:\+srv)?:\/\/[^/?#]+\/([^/?#]+)(?:\?[^#]*)?$/);
    let name;
    try {
        name = match && decodeURIComponent(match[1]);
    } catch {
        throw new Error('SNAIL_MONGO_URI must explicitly name the Snail database');
    }
    if (
        !name ||
        /[/\\.\s"$*<>:|?\x00]/.test(name) ||
        Buffer.byteLength(name) > 63 ||
        ['admin', 'config', 'local'].includes(name) ||
        name !== database.databaseName
    ) {
        throw new Error('SNAIL_MONGO_URI must explicitly name the connected Snail database');
    }

    const configured = process.env.SNAIL_MIGRATION_BACKUP_DIR;
    if (!configured || !path.isAbsolute(configured)) {
        throw new Error('Set SNAIL_MIGRATION_BACKUP_DIR to an existing absolute directory outside the repository');
    }
    const directory = await realpath(configured);
    const repository = await realpath(fileURLToPath(new URL('..', import.meta.url)));
    const relative = path.relative(repository, directory);
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
        throw new Error('SNAIL_MIGRATION_BACKUP_DIR must be outside the repository');
    }

    const runDirectory = await mkdtemp(path.join(directory, 'snail-v0-'));
    await chmod(runDirectory, 0o700);
    const config = path.join(runDirectory, 'mongodump.yml');
    const partial = path.join(runDirectory, 'snail.archive.gz.partial');
    const archive = path.join(runDirectory, 'snail.archive.gz');
    console.log(`Backing up Snail Mongo to ${archive}; stop all database writers before migration`);
    try {
        // A private config avoids putting credentials in process arguments or logs.
        await writeFile(config, `uri: ${JSON.stringify(uri)}\n`, { flag: 'wx', mode: 0o600 });
        const output = await open(partial, 'wx', 0o600);
        try {
            await new Promise((resolve, reject) => {
                const child = spawn('mongodump', ['--config', config, '--db', name, '--archive', '--gzip'], {
                    // Do not pass unrelated database credentials or ambient tool configuration.
                    env: { PATH: process.env.PATH },
                    stdio: ['ignore', output.fd, 'ignore'],
                });
                child.once('error', () => reject(new Error('Could not start mongodump; backup required')));
                child.once('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error('mongodump failed; migration aborted before writes'));
                });
            });
            if (!(await output.stat()).size) throw new Error('mongodump produced an empty archive');
            await output.sync();
        } finally {
            await output.close();
        }
        await rename(partial, archive);
    } finally {
        // Remove only the credential-bearing temporary config, never an archive.
        await unlink(config).catch((error) => {
            if (error.code !== 'ENOENT') throw new Error('Could not remove private mongodump configuration');
        });
    }
    console.log(`Snail Mongo backup complete: ${archive}`);
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
    const operations = [];
    for (const user of documents) {
        const $set = {};
        const $unset = {};
        for (const reminder of ['luck', 'hunt', 'battle']) {
            const preference = user.reminders?.[reminder];
            if (typeof preference?.enabled === 'boolean') $set[`reminders.${reminder}`] = preference.enabled;
        }
        const optout = [
            user.supporterRoles?.optout,
            user.supporterRoles?.optedOut,
            user.supporterRoles?.disabled,
            user.snailRoles,
        ].find((value) => typeof value === 'boolean');
        if (optout !== undefined && user.supporterRoles?.optout !== optout) $set['supporterRoles.optout'] = optout;
        if (typeof user.snailRoles === 'boolean') $unset.snailRoles = '';
        if (Object.keys($set).length || Object.keys($unset).length) {
            operations.push({
                updateOne: {
                    filter: { _id: user._id },
                    update: {
                        ...(Object.keys($set).length ? { $set } : {}),
                        ...(Object.keys($unset).length ? { $unset } : {}),
                    },
                },
            });
        }
    }
    if (operations.length) await collection.bulkWrite(operations, { ordered: true });
    return operations.length;
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

migrate().catch(() => {
    // Driver/tool errors can contain connection strings or credentials.
    console.error(
        'Migration failed. Keep writers stopped; check Snail connectivity, explicit database, backup directory and mongodump installation/permissions. No automatic restore is performed.',
    );
    process.exitCode = 1;
});
