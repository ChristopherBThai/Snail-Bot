const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadKnowledgeBase({ chatImpl, embedImpl }) {
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
            if (request === '../utils/kb.js') {
                return { Qdrant: class Qdrant {}, embed: embedImpl, chat: chatImpl };
            }
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

    vm.runInNewContext(`${source}\nmodule.exports.__phase6 = { KnowledgeBase: module.exports };`, sandbox, {
        filename: modulePath,
    });
    return sandbox.module.exports.__phase6.KnowledgeBase;
}

function loadKbCommand({ renderPanel, attachPanel }) {
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
            if (request === '../../utils/kbPanel.js') return { renderPanel };
            if (request === '../../utils/kbInteractions.js') return { attachPanel };
            if (request === '../../utils/kbSessions.js') return { create: () => ({ sessionId: 'legacy-session' }) };
            return require(request);
        },
        console,
    };
    vm.runInNewContext(source, sandbox, { filename: modulePath });
    return sandbox.module.exports;
}

const normalize = (value) => JSON.parse(JSON.stringify(value));

async function testAskAndDebugUseAuthoritativeTags() {
    let chatUserContext = null;
    const rawHits = [
        {
            score: 0.91,
            payload: {
                tag_id: 'gems',
                kind: 'tag_question',
                question: 'Generated scaffolding: should I use a gem before hunting?',
                data: 'Qdrant payload data must not be used as facts.',
            },
        },
        {
            score: 0.83,
            payload: {
                tag_id: 'gems',
                kind: 'tag_answer',
                data: 'Stale Qdrant answer payload must not be used.',
            },
        },
        {
            score: 0.75,
            payload: {
                tag_id: 'rules',
                kind: 'tag_question',
                question: 'Generated scaffolding: can I appeal punishments?',
            },
        },
    ];

    const KnowledgeBase = loadKnowledgeBase({
        embedImpl: async ({ inputs }) => inputs.map(() => [1, 2, 3]),
        chatImpl: async ({ messages }) => {
            chatUserContext = messages.find((message) => message.role === 'user').content;
            return { content: 'Use a gem before hunting if you want improved rewards.' };
        },
    });

    const tagFindQueries = [];
    const bot = {
        config: { kb: { collection: 'phase6_tags' } },
        snail_db: {
            Tag: {
                find(query) {
                    tagFindQueries.push(query);
                    return {
                        lean: async () => [
                            {
                                _id: 'gems',
                                data: 'Authoritative Mongo data: gems improve hunt rewards.',
                                kb: { questions: [{ text: 'cached question should not be a fact' }] },
                            },
                            { _id: 'rules', data: 'Authoritative Mongo data: follow server rules.' },
                        ],
                    };
                },
            },
            Knowledge: {
                find() {
                    throw new Error('ask/debug retrieval must not read legacy Knowledge docs');
                },
            },
        },
    };
    const kb = new KnowledgeBase(bot);
    kb.openrouterApiKey = 'test-key';
    kb.qdrant = {
        async search(collection, options) {
            assert.strictEqual(collection, 'phase6_tags');
            assert.deepStrictEqual(options.vector, [1, 2, 3]);
            return rawHits;
        },
    };

    const answer = await kb.ask('should i use a gem before hunting?');
    assert.strictEqual(answer.answer, 'Use a gem before hunting if you want improved rewards.');
    assert.deepStrictEqual(answer.sources, ['gems', 'rules']);
    assert.deepStrictEqual(
        normalize(tagFindQueries[0]),
        { _id: { $in: ['gems', 'rules'] } },
        'ask should fetch current Mongo tags by grouped tag ids'
    );
    assert.ok(chatUserContext.includes('[Tag: gems]'));
    assert.ok(chatUserContext.includes('Authoritative Mongo data: gems improve hunt rewards.'));
    assert.ok(!chatUserContext.includes('Generated scaffolding'));
    assert.ok(!chatUserContext.includes('cached question should not be a fact'));
    assert.ok(!chatUserContext.includes('Stale Qdrant answer payload'));
    assert.ok(!chatUserContext.includes('Qdrant payload data must not be used'));

    tagFindQueries.length = 0;
    const debug = await kb.debugSearch('gems', { limit: 5, includeBelowThreshold: true });
    assert.strictEqual(debug.groups.length, 2);
    assert.strictEqual(debug.groups[0].tagId, 'gems');
    assert.strictEqual(debug.groups[0].topScore, 0.91);
    assert.deepStrictEqual(normalize(debug.groups[0].matchedKinds), ['tag_question', 'tag_answer']);
    assert.deepStrictEqual(normalize(debug.groups[0].matchedQuestions), [
        'Generated scaffolding: should I use a gem before hunting?',
    ]);
    assert.strictEqual(debug.groups[0].tag.data, 'Authoritative Mongo data: gems improve hunt rewards.');
    assert.strictEqual(debug.groups[0].dataPreview, 'Authoritative Mongo data: gems improve hunt rewards.');
    assert.deepStrictEqual(normalize(tagFindQueries[0]), { _id: { $in: ['gems', 'rules'] } });

    const similar = await kb.findSimilar('gems', { limit: 1 });
    assert.strictEqual(similar.length, 1);
    assert.strictEqual(similar[0].tagId, 'gems');
    assert.strictEqual(similar[0].doc._id, 'gems');
}

async function testKbFindIsTagShapedAndAddIsRejected() {
    const legacyCalls = [];
    const command = loadKbCommand({
        renderPanel() {
            legacyCalls.push('renderPanel');
            return { content: 'legacy panel' };
        },
        attachPanel() {
            legacyCalls.push('attachPanel');
        },
    });

    const sent = [];
    const errors = [];
    const context = {
        message: { args: ['find', 'how', 'do', 'gems', 'work'], author: { id: 'manager' }, channel: { id: 'channel' } },
        bot: {
            modules: {
                knowledgebase: {
                    dupeThreshold: 0.75,
                    async findSimilar(query, { limit }) {
                        assert.strictEqual(query, 'how do gems work');
                        assert.strictEqual(limit, 5);
                        return [
                            {
                                tagId: 'gems',
                                topScore: 0.88,
                                matchedKinds: ['tag_question', 'tag_answer'],
                                matchedQuestions: ['How do gems work in OwO?'],
                                dataPreview: 'Gems improve hunt rewards.',
                            },
                        ];
                    },
                },
            },
        },
        config: { embedcolor: 0xabcdef, color: { orange: 0xff9900 } },
        async send(payload) {
            sent.push(payload);
            return { edit: async (edited) => sent.push(edited) };
        },
        async error(payload) {
            errors.push(payload);
        },
    };

    await command.execute.call(context);
    assert.deepStrictEqual(legacyCalls, [], 'kb find must not render or attach the legacy KB editor panel');
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].embed.title, 'KB Tag Find Results');
    assert.ok(sent[0].embed.fields[0].name.includes('gems'));
    assert.ok(sent[0].embed.fields[0].value.includes('snail tag edit gems'));
    assert.ok(sent[0].embed.fields[0].value.includes('How do gems work in OwO?'));

    sent.length = 0;
    context.message.args = ['add', 'new', 'question'];
    await command.execute.call(context);
    assert.deepStrictEqual(legacyCalls, [], 'kb add must not enter the legacy KB editor path');
    assert.strictEqual(sent.length, 0);
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].includes('snail tag add {name} {data}'));
    assert.ok(!command.description.includes('snail kb add'));
    assert.ok(!command.examples.some((example) => example.includes('kb add')));
}

async function main() {
    await testAskAndDebugUseAuthoritativeTags();
    await testKbFindIsTagShapedAndAddIsRejected();
    console.log(
        'Phase 6 retrieval uses grouped tag hits, authoritative Tag.data, tag-shaped debug/find, and rejects kb add.'
    );
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
