import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import vm from 'node:vm';
import test from 'node:test';
import mongoose from 'mongoose';
import { createUserModel } from '../src/services/snail/mongo/user.js';
import { normalizeMessage } from '../src/discord/messages.js';
import { extractMessageText } from '../src/utils/tags.js';

// Exercise private migration functions without importing the CLI or loading .env.
const source = (await readFile(new URL('../src/migrate.js', import.meta.url), 'utf8'))
    .replace(/^import .*;\n/gm, '')
    .replaceAll('import.meta.url', JSON.stringify(new URL('../src/migrate.js', import.meta.url).href))
    .split('migrate().catch(')[0];
function load(extra = {}) {
    const context = vm.createContext({
        createHash,
        isDeepStrictEqual,
        normalizeMessage,
        extractMessageText,
        console: { log() {} },
        process: { env: {} },
        Buffer,
        ...extra,
    });
    vm.runInContext(source, context);
    return context;
}
const plain = (value) => JSON.parse(JSON.stringify(value));

function usersDatabase(documents) {
    const rows = structuredClone(documents);
    const writes = [];
    return {
        rows,
        writes,
        collection(name) {
            assert.equal(name, 'users');
            return {
                find: () => ({ toArray: async () => rows }),
                async bulkWrite(operations) {
                    for (const operation of operations) {
                        assert.ok(operation.updateOne, 'users must only receive targeted updates');
                        writes.push(operation);
                        const { filter, update } = operation.updateOne;
                        const row = rows.find(({ _id }) => _id === filter._id);
                        for (const [path, value] of Object.entries(update.$set ?? {})) {
                            const keys = path.split('.');
                            const leaf = keys.pop();
                            let parent = row;
                            for (const key of keys) parent = parent[key] ??= {};
                            parent[leaf] = value;
                        }
                        for (const path of Object.keys(update.$unset ?? {})) delete row[path];
                    }
                },
                deleteMany() {
                    assert.fail('must not delete users');
                },
            };
        },
    };
}

test('preserves every user and unrelated data, converts only present boolean legacy preferences', async () => {
    const before = [
        {
            _id: 'a',
            friends: ['b'],
            other: { keep: 1 },
            reminders: { luck: { enabled: false }, hunt: { enabled: true }, battle: { enabled: false }, other: 9 },
            snailRoles: false,
        },
        {
            _id: 'b',
            reminders: { luck: true, hunt: false, battle: true },
            supporterRoles: { optout: false, optedOut: true, disabled: true, extra: 'keep' },
            snailRoles: true,
            messageBuilder: { draft: { components: [] } },
        },
        { _id: 'c', ticketMarket: { activeAd: { price: 5 } }, friends: [] },
        { _id: 'd', supporterRoles: { optedOut: false, disabled: true }, snailRoles: true },
        { _id: 'e', supporterRoles: { disabled: true }, snailRoles: false },
        { _id: 'f', snailRoles: true, reminders: { luck: {}, hunt: { enabled: 'false' } } },
        { _id: 'g', snailRoles: { unrelated: true }, reminders: { battle: { enabled: true } } },
    ];
    const expected = structuredClone(before);
    expected[0].reminders = { luck: false, hunt: true, battle: false, other: 9 };
    expected[0].supporterRoles = { optout: false };
    expected[3].supporterRoles.optout = false;
    expected[4].supporterRoles.optout = true;
    expected[5].supporterRoles = { optout: true };
    expected[6].reminders.battle = true;
    for (const row of expected) if (typeof row.snailRoles === 'boolean') delete row.snailRoles;
    const database = usersDatabase(before);
    await load().migrateUsers(database);
    assert.deepEqual(plain(database.rows), expected);
    const second = usersDatabase(database.rows);
    await load().migrateUsers(second);
    assert.deepEqual(second.rows, expected);
    assert.equal(second.writes.length, 0, 'repeat migration is a no-op');
});

test('schema persists inactive hunt/battle/friends and retains the existing luck default', () => {
    const connection = mongoose.createConnection();
    const User = createUserModel(connection);
    const actual = new User({ _id: 'a', friends: ['b'], reminders: { hunt: false, battle: true } }).toObject();
    assert.deepEqual(actual.friends, ['b']);
    assert.deepEqual(actual.reminders, { luck: false, hunt: false, battle: true });
    assert.deepEqual(new User({ _id: 'c', reminders: {} }).toObject().reminders, { luck: false });
    assert.equal(new User({ _id: 'd' }).toObject().reminders, undefined);
    assert.equal(new User({ _id: 'b' }).toObject().friends, undefined);
    assert.equal(
        User.schema.path('friends').caster?.options.ref ?? User.schema.path('friends').embeddedSchemaType.options.ref,
        'User',
    );
    assert.equal(User.schema.path('legacyReminder'), undefined);
});

test('v2 excluded caches discarded; v3 questions and current hash formula retained', () => {
    const migration = load();
    const legacy = {
        _id: 'example',
        data: 'hello',
        knowledgeBase: { excluded: true },
        kb: { promptVersion: 'tag-question-v2', questions: [{ text: 'Q', hash: 'H' }] },
    };
    assert.deepEqual(plain(migration.migrateTag(legacy, 'example').knowledgeBase), { excluded: true });
    legacy.kb.promptVersion = 'tag-question-v3';
    legacy.kb.generatedAt = 'saved-time';
    const migrated = plain(migration.migrateTag(legacy, 'example'));
    const hash = (value) => createHash('sha1').update(value).digest('hex');
    assert.deepEqual(migrated.knowledgeBase, {
        excluded: true,
        questions: [{ text: 'Q', hash: 'H' }],
        generatedAt: 'saved-time',
        textHash: hash(migrated.text),
        generationHash: hash(
            JSON.stringify({
                tagId: 'example',
                textHash: hash(migrated.text),
                promptSource:
                    'tag-question-v3:You generate retrieval scaffolding questions for OwO Discord bot support tags.',
            }),
        ),
    });
});

test('backup precedes every migration mutation and failure prevents all writes', async () => {
    for (const fail of [false, true]) {
        const events = [];
        const migration = load();
        migration.backupDatabase = async () => {
            events.push('backup');
            if (fail) throw new Error('backup failed');
        };
        for (const fn of ['migrateTags', 'migrateKnowledgeTerms', 'migrateUsers', 'dropObsoleteCollections']) {
            migration[fn] = async () => {
                events.push(fn);
                return 0;
            };
        }
        const database = {
            collection: () => ({ findOne: async () => null, updateOne: async () => events.push('version') }),
        };
        if (fail) await assert.rejects(migration.migrateDatabase(database), /backup failed/);
        else await migration.migrateDatabase(database);
        assert.deepEqual(
            events,
            fail
                ? ['backup']
                : [
                      'backup',
                      'migrateTags',
                      'migrateKnowledgeTerms',
                      'migrateUsers',
                      'dropObsoleteCollections',
                      'version',
                  ],
        );
    }
});

test('version 1 skips backup and writes; unsupported versions fail before backup', async () => {
    for (const value of [1, 2, -1, '1']) {
        const migration = load();
        migration.backupDatabase = () => assert.fail('backup must not run');
        const database = {
            collection: () => ({ findOne: async () => ({ value }), updateOne: () => assert.fail('write') }),
        };
        if (value === 1) await migration.migrateDatabase(database);
        else await assert.rejects(migration.migrateDatabase(database));
    }
});
