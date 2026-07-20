const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadKnowledgeBase({ chatImpl, embedImpl, consoleImpl = console }) {
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
        `${source}\nmodule.exports.__phase4 = { KnowledgeBase: module.exports, TAG_QUESTION_PROMPT_VERSION, tagDataHash, tagQuestionGenerationHash, sha1 };`,
        sandbox,
        { filename: modulePath }
    );
    return sandbox.module.exports.__phase4;
}

function currentKb(helpers, tag) {
    const dataHash = helpers.tagDataHash(tag.data);
    return {
        dataHash,
        promptVersion: helpers.TAG_QUESTION_PROMPT_VERSION,
        generationHash: helpers.tagQuestionGenerationHash(tag, dataHash),
        questions: [
            'How do gems work in OwO?',
            'What do gems do when hunting?',
            'How do I use gems before a hunt?',
            'Do higher tier gems improve hunt rewards?',
            'Why should I equip gems?',
        ].map((text) => ({ text, hash: helpers.sha1(text) })),
        generatedAt: new Date('2026-07-15T05:00:00.000Z'),
    };
}

const normalize = (value) => JSON.parse(JSON.stringify(value));

async function main() {
    const embedCalls = [];
    const helpers = loadKnowledgeBase({
        chatImpl: async () => {
            throw new Error('current tag cache should not call chat');
        },
        embedImpl: async ({ inputs }) => {
            embedCalls.push(inputs);
            return inputs.map((_, index) => [index + 1, index + 2, index + 3]);
        },
    });

    const tag = {
        _id: 'gems',
        data: 'Gems can be equipped before hunting.',
    };
    tag.kb = currentKb(helpers, tag);

    const calls = [];
    let nextScrollAllPoints = [];
    const qdrant = {
        async scrollAll(collection, payloadFields, filter) {
            calls.push(['scrollAll', collection, payloadFields, filter]);
            return nextScrollAllPoints;
        },
        async deletePoints(collection, ids) {
            calls.push(['deletePoints', collection, ids]);
        },
        async upsert(collection, points) {
            calls.push(['upsert', collection, points]);
        },
        async setPayload(collection, pointId, payload) {
            calls.push(['setPayload', collection, pointId, payload]);
        },
        async deleteByFilter(collection, filter) {
            calls.push(['deleteByFilter', collection, filter]);
        },
    };

    let tagFindCalled = 0;
    let knowledgeFindCalled = 0;
    const bot = {
        config: { kb: { collection: 'test_tags', namespace: '1b671a64-40d5-491e-99b0-da01ff1f3341' } },
        snail_db: {
            Tag: {
                find() {
                    tagFindCalled += 1;
                    return [tag];
                },
                async findById(id) {
                    assert.strictEqual(id, 'gems');
                    return tag;
                },
            },
            Knowledge: {
                find() {
                    knowledgeFindCalled += 1;
                    throw new Error('sync must not read Knowledge documents');
                },
            },
        },
    };

    const kb = new helpers.KnowledgeBase(bot);
    kb.qdrant = qdrant;
    kb.openrouterApiKey = 'test-api-key';
    let ensureCalls = 0;
    const ensureTagKbCache = kb.ensureTagKbCache.bind(kb);
    kb.ensureTagKbCache = async (tagDoc) => {
        ensureCalls += 1;
        return ensureTagKbCache(tagDoc);
    };

    const fullSummary = await kb.sync();
    assert.strictEqual(ensureCalls, 1);
    assert.strictEqual(tagFindCalled, 1);
    assert.strictEqual(knowledgeFindCalled, 0);
    assert.strictEqual(fullSummary.totalTags, 1);
    assert.strictEqual(fullSummary.totalAnswers, 1);
    assert.strictEqual(fullSummary.totalQuestions, tag.kb.questions.length);
    assert.strictEqual(fullSummary.totalPoints, 1 + tag.kb.questions.length);

    const fullScroll = calls.find((call) => call[0] === 'scrollAll');
    assert.deepStrictEqual(normalize(fullScroll[2]), ['tag_id', 'kind', 'data_hash', 'question_hash', 'question']);
    assert.strictEqual(fullScroll[3], undefined);

    const fullUpsert = calls.find((call) => call[0] === 'upsert');
    assert.strictEqual(fullUpsert[2].length, 1 + tag.kb.questions.length);
    assert.strictEqual(fullUpsert[2].filter((point) => point.payload.kind === 'tag_answer').length, 1);
    assert.strictEqual(
        fullUpsert[2].filter((point) => point.payload.kind === 'tag_question').length,
        tag.kb.questions.length
    );
    assert.ok(fullUpsert[2].every((point) => point.payload.tag_id === 'gems'));
    assert.ok(fullUpsert[2].every((point) => !Object.prototype.hasOwnProperty.call(point.payload, 'data')));
    assert.ok(fullUpsert[2].every((point) => !Object.prototype.hasOwnProperty.call(point.payload, 'prompt_version')));
    assert.strictEqual(embedCalls.flat().length, 1 + tag.kb.questions.length);

    nextScrollAllPoints = fullUpsert[2].map((point) => ({
        id: point.id,
        payload: { ...point.payload, data_hash: 'stale-data-hash' },
    }));
    calls.length = 0;
    embedCalls.length = 0;
    const singleSummary = await kb.syncTagById('gems');
    assert.strictEqual(singleSummary.totalTags, 1);
    assert.strictEqual(singleSummary.totalPoints, 1 + tag.kb.questions.length);
    assert.strictEqual(singleSummary.added, 0);
    assert.strictEqual(singleSummary.metaUpdated, 1 + tag.kb.questions.length);
    assert.strictEqual(embedCalls.flat().length, 0);
    const singleScroll = calls.find((call) => call[0] === 'scrollAll');
    assert.deepStrictEqual(normalize(singleScroll.slice(2)), [
        ['tag_id', 'kind', 'data_hash', 'question_hash', 'question'],
        { must: [{ key: 'tag_id', match: { value: 'gems' } }] },
    ]);

    calls.length = 0;
    await kb.deleteTagById('gems');
    assert.deepStrictEqual(normalize(calls), [
        ['deleteByFilter', 'test_tags', { must: [{ key: 'tag_id', match: { value: 'gems' } }] }],
    ]);

    calls.length = 0;
    bot.snail_db.Tag.findById = async () => null;
    const missingSummary = await kb.syncTagById('missing');
    assert.deepStrictEqual(normalize(calls), [
        ['deleteByFilter', 'test_tags', { must: [{ key: 'tag_id', match: { value: 'missing' } }] }],
    ]);
    assert.deepStrictEqual(normalize(missingSummary), { deleted: true, tagId: 'missing' });

    const syncLogs = [];
    const progressHelpers = loadKnowledgeBase({
        chatImpl: async () => {
            throw new Error('dry sync should not generate questions');
        },
        embedImpl: async () => {
            throw new Error('dry sync should not embed points');
        },
        consoleImpl: {
            ...console,
            log: (line) => syncLogs.push(line),
        },
    });
    const progressTags = Array.from({ length: 26 }, (_, index) => {
        const id = `tag-${index + 1}`;
        const progressTag = { _id: id, data: `Data for ${id}` };
        progressTag.kb = currentKb(progressHelpers, progressTag);
        return progressTag;
    });
    const progressKb = new progressHelpers.KnowledgeBase({
        config: { kb: { collection: 'test_tags' } },
        snail_db: { Tag: { find: () => progressTags } },
    });
    progressKb.qdrant = { scrollAll: async () => [] };

    const progressSummary = await progressKb.sync({ dryRun: true });
    assert.strictEqual(progressSummary.totalTags, 26);
    assert.ok(syncLogs.some((line) => line.includes('processed 25/26 tags; planned')));
    assert.ok(syncLogs.some((line) => line.includes('processed 26/26 tags; planned')));

    console.log('KnowledgeBase syncs tag-derived Qdrant points and deletes by tag_id.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
