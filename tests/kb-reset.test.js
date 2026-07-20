const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadKnowledgeBase({
    Qdrant = class Qdrant {},
    embedImpl = async () => [],
    chatImpl = async () => ({ content: '[]' }),
} = {}) {
    const modulePath = path.join(__dirname, '..', 'src', 'modules', 'KnowledgeBase.js');
    const source = fs.readFileSync(modulePath, 'utf8');
    const sandbox = {
        module: { exports: {} },
        exports: {},
        require(request) {
            if (request === './Module') {
                return class Module {
                    constructor(bot, config) {
                        this.bot = bot;
                        this.id = config.id;
                        this.enabled = true;
                    }
                    addEvent() {}
                };
            }
            if (request === '../utils/kb.js') return { Qdrant, embed: embedImpl, chat: chatImpl };
            return require(request);
        },
        console,
        process,
        Date,
        RegExp,
        Set,
        Map,
        String,
        Array,
        Object,
        JSON,
        Math,
    };

    vm.runInNewContext(`${source}\nmodule.exports.__phase7 = { KnowledgeBase: module.exports };`, sandbox, {
        filename: modulePath,
    });
    return sandbox.module.exports.__phase7.KnowledgeBase;
}

function loadKbCommand() {
    const modulePath = path.join(__dirname, '..', 'src', 'commands', 'modules', 'kb.js');
    const source = fs.readFileSync(modulePath, 'utf8');
    const sandbox = {
        module: { exports: {} },
        exports: {},
        require(request) {
            if (request === '../Command.js') {
                return class Command {
                    constructor(args) {
                        Object.assign(this, args);
                    }
                };
            }
            if (request === '../../utils/permissions.js') return { hasManagerPerms: () => true };
            return require(request);
        },
        console,
    };
    vm.runInNewContext(source, sandbox, { filename: modulePath });
    return sandbox.module.exports;
}

function loadQdrantWithAxios(fakeAxios) {
    const modulePath = path.join(__dirname, '..', 'src', 'utils', 'kb.js');
    const source = fs.readFileSync(modulePath, 'utf8');
    const sandbox = {
        module: { exports: {} },
        exports: {},
        require(request) {
            if (request === 'axios') return fakeAxios;
            return require(request);
        },
    };
    vm.runInNewContext(source, sandbox, { filename: modulePath });
    return sandbox.module.exports.Qdrant;
}

const normalize = (value) => JSON.parse(JSON.stringify(value));

async function testOwnerResetRecreatesCollectionThenSyncs() {
    const KnowledgeBase = loadKnowledgeBase();
    const calls = [];
    const bot = {
        config: { kb: { collection: 'phase7_tags', embeddingSize: 4096 } },
        snail_db: { Tag: {}, Knowledge: {} },
    };
    const kb = new KnowledgeBase(bot);
    kb.qdrant = {
        async resetCollection(collection, vectorSize) {
            calls.push(['resetCollection', collection, vectorSize]);
        },
    };
    kb.sync = async (options) => {
        calls.push(['sync', options]);
        return { totalTags: 2, totalPoints: 12, totalQuestions: 10, totalAnswers: 2, added: 12 };
    };

    const summary = await kb.resetQdrantAndSync();

    assert.deepStrictEqual(calls, [
        ['resetCollection', 'phase7_tags', 4096],
        ['sync', undefined],
    ]);
    assert.deepStrictEqual(normalize(summary), {
        collection: 'phase7_tags',
        totalTags: 2,
        totalPoints: 12,
        totalQuestions: 10,
        totalAnswers: 2,
        added: 12,
    });
}

async function testCommandResetIsExplicitAndOwnerOwned() {
    const command = loadKbCommand();
    const calls = [];
    const sent = [];
    const errors = [];
    const statusEdits = [];
    const context = {
        message: { args: ['reset'], author: { id: 'manager' }, channel: { id: 'channel' } },
        bot: {
            modules: {
                knowledgebase: {
                    collection: 'phase7_tags',
                    syncing: false,
                    async resetQdrantAndSync() {
                        calls.push(['resetQdrantAndSync']);
                        return {
                            collection: 'phase7_tags',
                            totalTags: 2,
                            totalPoints: 12,
                            totalQuestions: 10,
                            totalAnswers: 2,
                        };
                    },
                    async sync() {
                        calls.push(['sync']);
                        return {};
                    },
                },
            },
        },
        config: { embedcolor: 0xabcdef, color: { orange: 0xff9900 } },
        async send(payload) {
            sent.push(payload);
            return { edit: async (edited) => statusEdits.push(edited) };
        },
        async error(payload) {
            errors.push(payload);
        },
    };

    await command.execute.call(context);
    assert.deepStrictEqual(calls, []);
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes('destructive'));
    assert.ok(errors[0].includes('snail kb reset confirm'));
    assert.ok(errors[0].includes('ssh hub.corg.network'));

    context.message.args = ['reset', 'confirm'];
    await command.execute.call(context);
    assert.deepStrictEqual(calls, [['resetQdrantAndSync']]);
    assert.strictEqual(statusEdits.length, 1);
    assert.strictEqual(statusEdits[0].embed.title, 'Qdrant Reset Complete');
    assert.ok(statusEdits[0].embed.description.includes('phase7_tags'));
    assert.ok(statusEdits[0].embed.description.includes('**Tags:** 2'));
    assert.ok(statusEdits[0].embed.description.includes('**Points:** 12'));
    assert.ok(statusEdits[0].embed.description.includes('ssh hub.corg.network'));
    assert.ok(command.description.includes('snail kb reset confirm'));
    assert.ok(command.examples.includes('snail kb reset confirm'));
}

async function testReindexDoesNotReset() {
    const command = loadKbCommand();
    const calls = [];
    const statusEdits = [];
    const context = {
        message: { args: ['reindex'], author: { id: 'manager' }, channel: { id: 'channel' } },
        bot: {
            modules: {
                knowledgebase: {
                    syncing: false,
                    async resetQdrantAndSync() {
                        calls.push(['resetQdrantAndSync']);
                        throw new Error('reindex must not reset');
                    },
                    async sync(options) {
                        calls.push(['sync', options]);
                        return {
                            added: 0,
                            vectorUpdated: 0,
                            metaUpdated: 0,
                            deleted: 0,
                            unchanged: 12,
                            totalTags: 2,
                            totalPoints: 12,
                            totalQuestions: 10,
                            totalAnswers: 2,
                        };
                    },
                },
            },
        },
        config: { embedcolor: 0xabcdef },
        async send() {
            return { edit: async (edited) => statusEdits.push(edited) };
        },
        async error(message) {
            throw new Error(message);
        },
    };

    await command.execute.call(context);
    assert.deepStrictEqual(normalize(calls), [['sync', { dryRun: false }]]);
    assert.strictEqual(statusEdits[0].embed.title, 'Reindex Complete');
}

async function testStatusShowsSyncProgress() {
    const command = loadKbCommand();
    const sent = [];
    const startedAt = new Date('2026-07-19T12:00:00.000Z');
    const updatedAt = new Date('2026-07-19T12:01:00.000Z');
    const context = {
        message: { args: ['status'], author: { id: 'manager' }, channel: { id: 'channel' } },
        bot: {
            modules: {
                knowledgebase: {
                    enabled: true,
                    collection: 'phase7_tags',
                    chatModel: 'chat/model',
                    embeddingModel: 'embed/model',
                    syncing: true,
                    qdrant: { count: async () => 42 },
                    getSyncProgress() {
                        return {
                            dryRun: false,
                            phase: 'planning',
                            processedTags: 25,
                            totalTags: 123,
                            plannedPoints: 150,
                            tagsWithQuestions: 25,
                            tagsWithQuestionsInQdrant: 20,
                            totalAnswers: 20,
                            totalQuestions: 130,
                            embeddedPoints: 0,
                            totalEmbeds: 0,
                            updatedPayloads: 0,
                            totalPayloadUpdates: 0,
                            deletedPoints: 0,
                            startedAt,
                            updatedAt,
                        };
                    },
                },
            },
        },
        config: { embedcolor: 0xabcdef },
        async send(payload) {
            sent.push(payload);
        },
        async error(message) {
            throw new Error(message);
        },
    };

    await command.execute.call(context);

    assert.strictEqual(sent.length, 1);
    const description = sent[0].embed.description;
    assert.ok(description.includes('**Last Sync:** in progress'));
    assert.ok(description.includes('**Current Sync Progress:**'));
    assert.ok(description.includes(' - phase: planning'));
    assert.ok(description.includes(' - questions generated: 25/123'));
    assert.ok(description.includes(' - qdrant sync: 20/123'));
    assert.ok(description.includes(' - planned points: 150'));
    assert.ok(description.includes('20 tag data + 130 generated questions'));
}

async function testQdrantResetHelperDeletesThenEnsuresCollection() {
    const calls = [];
    const fakeClient = {
        async delete(url) {
            calls.push(['delete', url]);
        },
        async get(url) {
            calls.push(['get', url]);
            const err = new Error('missing');
            err.response = { status: 404 };
            throw err;
        },
        async put(url, body) {
            calls.push(['put', url, body]);
        },
    };
    const fakeAxios = {
        create(options) {
            calls.push(['create', options.baseURL, options.headers]);
            return fakeClient;
        },
    };
    const Qdrant = loadQdrantWithAxios(fakeAxios);
    const qdrant = new Qdrant({ url: 'http://qdrant.test', apiKey: 'key' });

    await qdrant.resetCollection('phase7_tags', 4096);

    assert.deepStrictEqual(normalize(calls), [
        ['create', 'http://qdrant.test', { 'api-key': 'key' }],
        ['delete', '/collections/phase7_tags'],
        ['get', '/collections/phase7_tags'],
        ['put', '/collections/phase7_tags', { vectors: { size: 4096, distance: 'Cosine' } }],
        ['put', '/collections/phase7_tags/index', { field_name: 'tag_id', field_schema: 'keyword' }],
        ['put', '/collections/phase7_tags/index', { field_name: 'kind', field_schema: 'keyword' }],
    ]);
}

async function main() {
    await testOwnerResetRecreatesCollectionThenSyncs();
    await testCommandResetIsExplicitAndOwnerOwned();
    await testReindexDoesNotReset();
    await testStatusShowsSyncProgress();
    await testQdrantResetHelperDeletesThenEnsuresCollection();
    console.log('KB reset is explicit, owner-owned, recreates Qdrant collection, and reindex remains non-destructive.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
