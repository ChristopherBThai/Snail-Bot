const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadTagCommand({ hasManagerPerms = () => true } = {}) {
    const modulePath = path.join(__dirname, '..', 'src', 'commands', 'util', 'tag.js');
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
            if (request === '../../utils/permissions.js') {
                return { hasManagerPerms };
            }
            return require(request);
        },
        console,
    };

    vm.runInNewContext(source, sandbox, { filename: modulePath });
    return sandbox.module.exports;
}

function buildContext({ args, existingTag = null, knowledgebase, hasManagerPerms = () => true, failCreate = false }) {
    const calls = [];
    const sent = [];
    const errors = [];
    const Tag = {
        async findById(id) {
            calls.push(['findById', id]);
            return existingTag;
        },
        async create(doc) {
            calls.push(['create', doc]);
            if (failCreate) throw new Error('mongo create failed');
        },
        async updateOne(filter, update) {
            calls.push(['updateOne', filter, update]);
        },
        async deleteOne(filter) {
            calls.push(['deleteOne', filter]);
        },
    };
    const bot = { snail_db: { Tag }, modules: { knowledgebase } };

    return {
        command: loadTagCommand({ hasManagerPerms }),
        context: {
            message: { command: 'tag', args: [...args], member: { roles: ['manager'] } },
            bot,
            snail_db: bot.snail_db,
            async send(payload) {
                sent.push(payload);
            },
            async error(payload) {
                errors.push(payload);
            },
        },
        calls,
        sent,
        errors,
    };
}

async function runCase(options) {
    const harness = buildContext(options);
    await harness.command.execute.call(harness.context);
    return harness;
}

const normalize = (value) => JSON.parse(JSON.stringify(value));

async function main() {
    const syncCalls = [];
    const enabledKb = {
        enabled: true,
        async syncTagById(id) {
            syncCalls.push(['syncTagById', id]);
        },
        async deleteTagById(id) {
            syncCalls.push(['deleteTagById', id]);
        },
    };

    let result = await runCase({ args: ['add', 'gems', 'Gems improve hunting.'], knowledgebase: enabledKb });
    assert.deepStrictEqual(normalize(result.calls), [
        ['findById', 'gems'],
        ['create', { _id: 'gems', data: 'Gems improve hunting.' }],
    ]);
    assert.deepStrictEqual(syncCalls, [['syncTagById', 'gems']]);
    assert.deepStrictEqual(result.sent, ['I created the tag `gems`!']);
    assert.deepStrictEqual(result.errors, []);

    syncCalls.length = 0;
    result = await runCase({
        args: ['edit', 'gems', 'Gems improve hunting and rewards.'],
        existingTag: { _id: 'gems', data: 'old' },
        knowledgebase: enabledKb,
    });
    assert.deepStrictEqual(normalize(result.calls), [
        ['findById', 'gems'],
        ['updateOne', { _id: 'gems' }, { data: 'Gems improve hunting and rewards.' }],
    ]);
    assert.deepStrictEqual(syncCalls, [['syncTagById', 'gems']]);
    assert.deepStrictEqual(result.sent, ['I updated the tag `gems`!']);
    assert.deepStrictEqual(result.errors, []);

    syncCalls.length = 0;
    result = await runCase({
        args: ['delete', 'gems'],
        existingTag: { _id: 'gems', data: 'old' },
        knowledgebase: enabledKb,
    });
    assert.deepStrictEqual(normalize(result.calls), [
        ['findById', 'gems'],
        ['deleteOne', { _id: 'gems' }],
    ]);
    assert.deepStrictEqual(syncCalls, [['deleteTagById', 'gems']]);
    assert.deepStrictEqual(result.sent, ['I deleted the tag `gems`!']);
    assert.deepStrictEqual(result.errors, []);

    syncCalls.length = 0;
    result = await runCase({
        args: ['add', 'gems', 'Gems improve hunting.'],
        knowledgebase: { ...enabledKb, enabled: false },
    });
    assert.deepStrictEqual(normalize(result.calls), [
        ['findById', 'gems'],
        ['create', { _id: 'gems', data: 'Gems improve hunting.' }],
    ]);
    assert.deepStrictEqual(syncCalls, []);

    syncCalls.length = 0;
    result = await runCase({
        args: ['add', 'gems', 'Gems improve hunting.'],
        knowledgebase: enabledKb,
        hasManagerPerms: () => false,
    });
    assert.deepStrictEqual(normalize(result.calls), []);
    assert.deepStrictEqual(syncCalls, []);
    assert.deepStrictEqual(result.errors, ['you do not have permission to use this command!']);

    syncCalls.length = 0;
    result = await runCase({ args: ['add', 'bad-name', 'Gems improve hunting.'], knowledgebase: enabledKb });
    assert.deepStrictEqual(normalize(result.calls), [['findById', 'bad-name']]);
    assert.deepStrictEqual(syncCalls, []);
    assert.deepStrictEqual(result.errors, ['tag names can only contain alphanumeric characters!']);

    syncCalls.length = 0;
    await assert.rejects(
        () => runCase({ args: ['add', 'gems', 'Gems improve hunting.'], knowledgebase: enabledKb, failCreate: true }),
        /mongo create failed/
    );
    assert.deepStrictEqual(syncCalls, []);

    const failingSyncMessages = [];
    const originalConsoleError = console.error;
    console.error = (...args) => failingSyncMessages.push(args);
    try {
        result = await runCase({
            args: ['add', 'gems', 'Gems improve hunting.'],
            knowledgebase: {
                enabled: true,
                async syncTagById() {
                    throw new Error('qdrant unavailable');
                },
            },
        });
    } finally {
        console.error = originalConsoleError;
    }
    assert.deepStrictEqual(normalize(result.calls), [
        ['findById', 'gems'],
        ['create', { _id: 'gems', data: 'Gems improve hunting.' }],
    ]);
    assert.deepStrictEqual(result.sent, ['I created the tag `gems`!']);
    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(failingSyncMessages.length, 1);
    assert.ok(String(failingSyncMessages[0][0]).includes('tag add sync hook failed'));

    console.log('Tag command sync hooks call KnowledgeBase after successful writes only.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
