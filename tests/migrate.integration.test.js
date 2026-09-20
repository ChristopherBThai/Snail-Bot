import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import mongoose from 'mongoose';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('..', import.meta.url));

// Opt-in: creates only disposable, loopback-bound Docker Mongo instances. Never reads .env.
test(
    'isolated Mongo migration, failure gates and real archive restore',
    { skip: process.env.RUN_MONGO_MIGRATION_INTEGRATION !== '1', timeout: 180000 },
    async (t) => {
        const scratch = await mkdtemp(path.join(os.tmpdir(), 'snail-migration-test-'));
        const tools = path.join(scratch, 'tools');
        const backups = path.join(scratch, 'backups');
        const empty = path.join(scratch, 'empty');
        const failing = path.join(scratch, 'failing');
        const emptyDump = path.join(scratch, 'empty-dump');
        await Promise.all(
            [tools, backups, empty, failing, emptyDump].map((directory) => mkdir(directory, { mode: 0o700 })),
        );
        const containers = [];
        const clients = [];
        async function server() {
            const name = `snail-migration-test-${randomUUID()}`;
            await exec('docker', [
                'run',
                '-d',
                '--rm',
                '--name',
                name,
                '-p',
                '127.0.0.1::27017',
                'mongo:8.0',
                '--bind_ip_all',
            ]);
            containers.push(name);
            const { stdout } = await exec('docker', ['port', name, '27017']);
            const uri = `mongodb://${stdout.trim()}`;
            const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 30000 });
            clients.push(client);
            await client.connect();
            return { name, uri, client };
        }
        async function snapshot(database) {
            const result = {};
            const collections = await database.listCollections().toArray();
            for (const { name } of collections.sort((a, b) => a.name.localeCompare(b.name))) {
                result[name] = await database.collection(name).find().sort({ _id: 1 }).toArray();
            }
            return result;
        }
        async function run(uri, overrides = {}) {
            try {
                const result = await exec(process.execPath, ['src/migrate.js'], {
                    cwd: repository,
                    env: {
                        PATH: tools,
                        SNAIL_MONGO_URI: uri,
                        SNAIL_MIGRATION_BACKUP_DIR: backups,
                        DOTENV_CONFIG_PATH: path.join(scratch, 'does-not-exist'),
                        DOTENV_CONFIG_QUIET: 'true',
                        ...overrides,
                    },
                    timeout: 30000,
                });
                return { code: 0, ...result };
            } catch (error) {
                return { code: error.code, stdout: error.stdout, stderr: error.stderr };
            }
        }
        try {
            const source = await server();
            for (const tool of ['mongodump', 'mongorestore']) {
                await exec('docker', ['cp', `${source.name}:/usr/bin/${tool}`, path.join(tools, tool)]);
            }
            const db = source.client.db('snail_fixture');
            // Disposable credentials prove authSource is authentication, not dump scope.
            await source.client
                .db('admin')
                .command({ createUser: 'fixture', pwd: 'fixture-only', roles: [{ role: 'root', db: 'admin' }] });
            const uri = `${source.uri.replace('mongodb://', 'mongodb://fixture:fixture-only@')}/snail_fixture?authSource=admin`;
            const users = [
                {
                    _id: 'a',
                    friends: ['b'],
                    reminders: { luck: { enabled: false }, hunt: { enabled: true }, battle: { enabled: false } },
                    snailRoles: false,
                    unknown: { retain: true },
                },
                {
                    _id: 'b',
                    reminders: { luck: true, hunt: false, battle: true },
                    supporterRoles: { optout: false, optedOut: true, keep: 'yes' },
                    snailRoles: true,
                },
                {
                    _id: 'c',
                    friends: [],
                    messageBuilder: { draft: { components: [] } },
                    ticketMarket: { lastAdPostedAt: new Date('2025-01-01') },
                },
                { _id: 'd', supporterRoles: { optedOut: false, disabled: true }, snailRoles: true },
                { _id: 'e', supporterRoles: { disabled: true }, snailRoles: false },
                { _id: 'f', snailRoles: true },
            ];
            await db.collection('users').insertMany(users);
            await db.collection('tags').insertMany([
                {
                    _id: 'old',
                    data: 'Old',
                    knowledgeBase: { excluded: true },
                    kb: { promptVersion: 'tag-question-v2', questions: [{ text: 'obsolete?', hash: 'old' }] },
                },
                {
                    _id: 'current',
                    data: 'Current',
                    knowledgeBase: { excluded: true },
                    kb: {
                        promptVersion: 'tag-question-v3',
                        questions: [{ text: 'current?', hash: 'saved' }],
                        generatedAt: new Date('2025-01-01'),
                    },
                },
                { _id: '5m', data: 'Rename me' },
            ]);
            await db.collection('knowledgeterms').insertOne({ _id: 'term', meaning: 'kept' });
            for (const name of ['channels', 'configs', 'knowledge', 'quests'])
                await db.collection(name).insertOne({ _id: 'legacy' });
            await db
                .collection('unrelated')
                .insertOne({ _id: 'keep', values: [false, true], date: new Date('2025-02-01') });
            await source.client.db('other_database').collection('sentinel').insertOne({ _id: 'never-dump' });
            const original = await snapshot(db);
            await t.test(
                'missing/failing/empty dump, invalid backup directories and absent database all prevent writes',
                async () => {
                    await writeFile(
                        path.join(failing, 'mongodump'),
                        '#!/bin/sh\nprintf "CREDENTIAL-MARKER" >&2\nexit 7\n',
                        { mode: 0o700 },
                    );
                    await writeFile(path.join(emptyDump, 'mongodump'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
                    for (const overrides of [
                        { PATH: empty },
                        { PATH: failing },
                        { PATH: emptyDump },
                        { SNAIL_MIGRATION_BACKUP_DIR: '' },
                        { SNAIL_MIGRATION_BACKUP_DIR: path.join(scratch, 'missing-directory') },
                        { SNAIL_MIGRATION_BACKUP_DIR: repository },
                        { SNAIL_MONGO_URI: `${source.uri}/?authSource=snail_fixture` },
                    ]) {
                        const result = await run(uri, overrides);
                        assert.equal(result.code, 1, JSON.stringify(result));
                        assert.ok(!`${result.stdout}${result.stderr}`.includes('CREDENTIAL-MARKER'));
                        assert.ok(!`${result.stdout}${result.stderr}`.includes(uri));
                        assert.deepEqual(await snapshot(db), original);
                        assert.deepEqual(await snapshot(source.client.db('test')), {});
                    }
                },
            );
            await t.test('real mongodump succeeds before destructive migration; exact users retained', async () => {
                const result = await run(uri);
                assert.equal(result.code, 0, JSON.stringify(result));
                assert.ok(result.stdout.indexOf('backup complete') < result.stdout.indexOf('Migrating database'));
                const expected = structuredClone(users);
                expected[0].reminders = { luck: false, hunt: true, battle: false };
                expected[0].supporterRoles = { optout: false };
                expected[3].supporterRoles.optout = false;
                expected[4].supporterRoles.optout = true;
                expected[5].supporterRoles = { optout: true };
                for (const user of expected) delete user.snailRoles;
                assert.deepEqual(await db.collection('users').find().sort({ _id: 1 }).toArray(), expected);
                assert.deepEqual((await db.collection('tags').findOne({ _id: 'old' })).knowledgeBase, {
                    excluded: true,
                });
                assert.deepEqual((await db.collection('tags').findOne({ _id: 'current' })).knowledgeBase.questions, [
                    { text: 'current?', hash: 'saved' },
                ]);
                assert.equal(await db.collection('tags').findOne({ _id: '5m' }), null);
                assert.ok(await db.collection('tags').findOne({ _id: 'fivemil' }));
                assert.deepEqual(await db.collection('knowledgeTerms').find().toArray(), [
                    { _id: 'term', meaning: 'kept' },
                ]);
                const names = (await db.listCollections().toArray()).map(({ name }) => name);
                for (const name of ['knowledgeterms', 'channels', 'configs', 'knowledge', 'quests'])
                    assert.ok(!names.includes(name));
                assert.deepEqual(await db.collection('unrelated').find().toArray(), original.unrelated);
                assert.equal((await db.collection('settings').findOne({ _id: 'database:schemaVersion' })).value, 1);
            });
            let archive;
            await t.test(
                'unique private archives, no credential config left, version 1 skips backup entirely',
                async () => {
                    const directories = await readdir(backups);
                    const complete = [];
                    for (const directory of directories) {
                        const full = path.join(backups, directory);
                        assert.equal((await stat(full)).mode & 0o777, 0o700);
                        const files = await readdir(full);
                        assert.ok(!files.includes('mongodump.yml'));
                        for (const file of files) assert.equal((await stat(path.join(full, file))).mode & 0o777, 0o600);
                        if (files.includes('snail.archive.gz')) complete.push(path.join(full, 'snail.archive.gz'));
                    }
                    assert.equal(complete.length, 1);
                    archive = complete[0];
                    const bytes = await readFile(archive);
                    const migrated = await snapshot(db);
                    const result = await run(uri, { PATH: empty, SNAIL_MIGRATION_BACKUP_DIR: '' });
                    assert.equal(result.code, 0, JSON.stringify(result));
                    assert.match(result.stdout, /already at schema version 1/);
                    assert.deepEqual(await readdir(backups), directories);
                    assert.deepEqual(await readFile(archive), bytes);
                    assert.deepEqual(await snapshot(db), migrated);
                },
            );
            await t.test(
                'mongorestore into second disposable server exactly recovers only pre-migration Snail DB',
                async () => {
                    const restored = await server();
                    await exec(
                        path.join(tools, 'mongorestore'),
                        ['--uri', restored.uri, `--archive=${archive}`, '--gzip'],
                        { env: { PATH: tools } },
                    );
                    assert.deepEqual(await snapshot(restored.client.db('snail_fixture')), original);
                    const names = (await restored.client.db('admin').admin().listDatabases()).databases.map(
                        ({ name }) => name,
                    );
                    assert.deepEqual(
                        names.filter((name) => !['admin', 'config', 'local'].includes(name)),
                        ['snail_fixture'],
                    );
                    assert.deepEqual(await source.client.db('other_database').collection('sentinel').find().toArray(), [
                        { _id: 'never-dump' },
                    ]);
                },
            );
            t.diagnostic(`Retained test archives: ${backups}`);
        } finally {
            await Promise.all(clients.map((client) => client.close()));
            await Promise.all(containers.map((name) => exec('docker', ['stop', name])));
        }
    },
);
