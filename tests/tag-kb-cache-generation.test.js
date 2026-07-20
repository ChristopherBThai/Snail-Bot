const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadKnowledgeBase({ chatImpl, consoleImpl = console }) {
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
                    }
                    addEvent() {}
                };
            }
            if (request === '../utils/kb.js') {
                return { Qdrant: class Qdrant {}, embed: async () => [], chat: chatImpl };
            }
            return require(request);
        },
        console: consoleImpl,
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

    vm.runInNewContext(
        `${source}\nmodule.exports.__phase3 = { KnowledgeBase: module.exports, TAG_QUESTION_PROMPT_VERSION, sha1, stableStringify, tagDataHash, tagQuestionGenerationHash };`,
        sandbox,
        { filename: modulePath }
    );
    return sandbox.module.exports.__phase3;
}

function buildKb({ tagId, data, questions, helpers }) {
    const dataHash = helpers.tagDataHash(data);
    const generationHash = helpers.tagQuestionGenerationHash({ _id: tagId, data }, dataHash);
    return {
        dataHash,
        promptVersion: helpers.TAG_QUESTION_PROMPT_VERSION,
        generationHash,
        questions: questions.map((text) => ({ text, hash: helpers.sha1(text) })),
        generatedAt: new Date('2026-07-15T05:00:00.000Z'),
    };
}

const normalize = (value) => JSON.parse(JSON.stringify(value));

async function main() {
    let chatCalls = 0;
    const helpers = loadKnowledgeBase({
        chatImpl: async () => {
            chatCalls += 1;
            return { content: '[]' };
        },
    });
    const kb = new helpers.KnowledgeBase({
        config: { kb: {} },
        snail_db: { Tag: { updateOne: async () => assert.fail('current cache should not update') } },
    });
    kb.openrouterApiKey = 'test-api-key';

    const currentQuestions = [
        'How do gems work in OwO?',
        'What do gems do when hunting?',
        'How do I use gems before a hunt?',
        'Do higher tier gems improve hunt rewards?',
        'Why should I equip gems?',
    ];
    const currentTag = {
        _id: 'gems',
        data: 'Gems can be equipped before hunting.',
        kb: buildKb({
            tagId: 'gems',
            data: 'Gems can be equipped before hunting.',
            questions: currentQuestions,
            helpers,
        }),
        async save() {
            throw new Error('current cache should not save');
        },
    };

    const reused = await kb.ensureTagKbCache(currentTag);
    assert.strictEqual(chatCalls, 0);
    assert.strictEqual(reused, currentTag.kb);
    assert.deepStrictEqual(normalize(reused.questions.map((q) => q.text)), currentQuestions);

    const generatedTexts = [
        'How do gems work in OwO?',
        'What do gems do when hunting?',
        'How do I use gems before a hunt?',
        'Do higher tier gems improve hunt rewards?',
        'Why should I equip gems?',
        'How can gems help my hunt rewards?',
        'How do gems find gem-tier animals?',
        'What is the benefit of higher-tier gems?',
    ];
    let staleChatCalls = 0;
    const staleHelpers = loadKnowledgeBase({
        chatImpl: async ({ messages }) => {
            staleChatCalls += 1;
            assert.ok(messages[0].content.includes('JSON array'));
            assert.ok(messages[0].content.includes('English strings'));
            assert.ok(messages[0].content.includes('do not prefix every question'));
            assert.ok(messages[1].content.includes('Do not start every question'));
            assert.ok(messages[1].content.includes('Tag id: gems'));
            assert.ok(messages[1].content.includes('Gems now also improve loot.'));
            return { content: JSON.stringify([...generatedTexts, generatedTexts[0], '   ']) };
        },
    });
    const staleKb = new staleHelpers.KnowledgeBase({
        config: { kb: {} },
        snail_db: { Tag: { updateOne: async () => assert.fail('hydrated tag should save itself') } },
    });
    staleKb.openrouterApiKey = 'test-api-key';

    let saved = 0;
    const staleTag = {
        _id: 'gems',
        data: 'Gems now also improve loot.',
        kb: buildKb({ tagId: 'gems', data: 'old data', questions: currentQuestions, helpers: staleHelpers }),
        async save() {
            saved += 1;
        },
    };

    const refreshed = await staleKb.ensureTagKbCache(staleTag);
    assert.strictEqual(staleChatCalls, 1);
    assert.strictEqual(saved, 1);
    assert.strictEqual(staleTag.kb, refreshed);
    assert.strictEqual(refreshed.dataHash, staleHelpers.tagDataHash(staleTag.data));
    assert.strictEqual(refreshed.promptVersion, staleHelpers.TAG_QUESTION_PROMPT_VERSION);
    assert.strictEqual(refreshed.generationHash, staleHelpers.tagQuestionGenerationHash(staleTag, refreshed.dataHash));
    assert.ok(refreshed.generatedAt instanceof Date);
    assert.deepStrictEqual(normalize(refreshed.questions.map((q) => q.text)), generatedTexts.slice(0, 8));
    assert.deepStrictEqual(
        normalize(refreshed.questions.map((q) => q.hash)),
        generatedTexts.slice(0, 8).map(staleHelpers.sha1)
    );

    let leanChatCalls = 0;
    let updateArgs = null;
    const leanHelpers = loadKnowledgeBase({
        chatImpl: async () => {
            leanChatCalls += 1;
            return { content: JSON.stringify(generatedTexts) };
        },
    });
    const leanKb = new leanHelpers.KnowledgeBase({
        config: { kb: {} },
        snail_db: {
            Tag: {
                updateOne: async (...args) => {
                    updateArgs = args;
                },
            },
        },
    });
    leanKb.openrouterApiKey = 'test-api-key';
    const malformedLeanTag = {
        _id: 'gems',
        data: 'Gems can be equipped before hunting.',
        kb: {
            dataHash: leanHelpers.tagDataHash('Gems can be equipped before hunting.'),
            promptVersion: leanHelpers.TAG_QUESTION_PROMPT_VERSION,
            generationHash: leanHelpers.tagQuestionGenerationHash({
                _id: 'gems',
                data: 'Gems can be equipped before hunting.',
            }),
            questions: [{}],
            generatedAt: new Date('2026-07-15T05:00:00.000Z'),
        },
    };

    const leanRefreshed = await leanKb.ensureTagKbCache(malformedLeanTag);
    assert.strictEqual(leanChatCalls, 1);
    assert.deepStrictEqual(normalize(updateArgs), [{ _id: 'gems' }, { $set: { kb: normalize(leanRefreshed) } }]);
    assert.strictEqual(malformedLeanTag.kb, leanRefreshed);
    assert.deepStrictEqual(normalize(leanRefreshed.questions.map((q) => q.text)), generatedTexts.slice(0, 8));

    let fencedChatCalls = 0;
    const fencedHelpers = loadKnowledgeBase({
        chatImpl: async () => {
            fencedChatCalls += 1;
            return { content: `\`\`\`json\n${JSON.stringify(generatedTexts.slice(0, 5))}\n\`\`\`` };
        },
    });
    const fencedKb = new fencedHelpers.KnowledgeBase({
        config: { kb: {} },
        snail_db: { Tag: { updateOne: async () => {} } },
    });
    fencedKb.openrouterApiKey = 'test-api-key';
    const fencedRefreshed = await fencedKb.ensureTagKbCache({
        _id: 'gems',
        data: 'Gems can be equipped before hunting.',
    });
    assert.strictEqual(fencedChatCalls, 1);
    assert.deepStrictEqual(normalize(fencedRefreshed.questions.map((q) => q.text)), generatedTexts.slice(0, 5));

    const loggedErrors = [];
    const invalidHelpers = loadKnowledgeBase({
        chatImpl: async () => ({ content: 'not json from model' }),
        consoleImpl: {
            ...console,
            error: (...args) => loggedErrors.push(args.join(' ')),
        },
    });
    const invalidKb = new invalidHelpers.KnowledgeBase({
        config: { kb: {} },
        snail_db: { Tag: { updateOne: async () => assert.fail('invalid generation should not persist') } },
    });
    invalidKb.openrouterApiKey = 'test-api-key';

    await assert.rejects(
        () => invalidKb.ensureTagKbCache({ _id: 'gems', data: 'Gems can be equipped before hunting.' }),
        /Tag question generation must return a JSON array of strings/
    );
    assert.ok(loggedErrors.some((line) => line.includes("raw response for tag 'gems': not json from model")));

    console.log('KnowledgeBase caches generated tag retrieval questions and reuses current caches.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
