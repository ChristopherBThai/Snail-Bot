import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createKnowledgeBase } from '../src/features/knowledgeBase/knowledge.js';
import { createOpenRouter } from '../src/services/openRouter.js';
import mongoose from 'mongoose';
import { createTagModel } from '../src/services/snail/mongo/tag.js';
import { legacyKB, legacyTag, legacyPoints, loadLegacy, plain } from './helpers/legacy.js';

const config = JSON.parse(readFileSync(new URL('../src/config/production.json', import.meta.url)));
const sha1 = (text) => createHash('sha1').update(text).digest('hex');
const log = {
    error() {},
    warn() {},
    debug() {},
    trace() {},
    time: () => ({ checkpoint() {}, info() {}, debug() {}, error() {} }),
};
const apm = { startTransaction() {}, startSpan() {}, captureError() {}, setCustomContext() {} };
function tag(id = 'daily', text = 'Use owo daily.', questions = ['How do I claim daily?']) {
    const value = {
        _id: id,
        text,
        public: true,
        message: {},
        knowledgeBase: {
            questions: questions.map((text_) => ({ text: text_, hash: sha1(text_) })),
            textHash: sha1(text.trim()),
        },
    };
    value.knowledgeBase.generationHash = legacyKB.evaluate('tagQuestionGenerationHash')(legacyTag(value));
    return value;
}
function fixture(values = [tag()], existing = [], options = {}) {
    const tags = new Map(values.map((value) => [value._id, value]));
    const events = [];
    const points = new Map(existing.map((point) => [point.id, structuredClone(point)]));
    const qdrant = {
        count: async () => ({ count: points.size }),
        scroll: async () => ({ points: [...points.values()] }),
        delete: async (_, body) => {
            events.push(['delete', body]);
            for (const id of body.points ?? []) points.delete(id);
        },
        upsert: async (_, body) => {
            events.push(['upsert', body]);
            for (const point of body.points) points.set(point.id, point);
        },
        batchUpdate: async (_, body) => {
            events.push(['batch', body]);
            for (const operation of body.operations) {
                if (operation.delete) for (const id of operation.delete.points) points.delete(id);
                const patch = operation.set_payload ?? operation.overwrite_payload;
                if (patch)
                    for (const id of patch.points)
                        points.get(id).payload = operation.set_payload
                            ? { ...points.get(id).payload, ...patch.payload }
                            : patch.payload;
            }
        },
        collectionExists: async () => ({ exists: true }),
        createPayloadIndex: async (_, body) => events.push(['index', body]),
    };
    const openRouter = {
        embed: async (input) => {
            events.push(['embed', input]);
            return input.map(() => [1, 2]);
        },
        chat: async (...args) => {
            events.push(['chat', ...args]);
            return '["New question?"]';
        },
    };
    const Tag = {
        updateOne: async (...args) => events.push(['save', ...args]),
        bulkWrite: async (...args) => events.push(['saveBatch', ...args]),
    };
    const knowledge = createKnowledgeBase({
        config: { ...config.knowledgeBase, ...options },
        tags,
        terms: new Map(),
        Tag,
        qdrant,
        openRouter,
        log,
        elasticApm: apm,
    });
    return { knowledge, tags, points, events, qdrant, openRouter };
}

test('sync writes the exact legacy UUIDs and complete payloads', async () => {
    const value = tag();
    const f = fixture([value]);
    await f.knowledge.sync();
    assert.deepEqual(
        [...f.points.values()].map(({ id, payload }) => ({ id, payload })),
        legacyPoints(value),
    );
    assert.equal([...f.points.keys()][0], '7ed34d50-1570-52e8-81b3-8761c0b688d3');
    assert.equal([...f.points.keys()][1], '145a767f-cca5-5274-b409-7994ed8d3c3e');
    assert.deepEqual(f.events.find(([type]) => type === 'embed')[1], ['Use owo daily.', 'How do I claim daily?']);
});

test('legacy records are a no-op, even with extra payload metadata', async () => {
    const value = tag();
    const existing = legacyPoints(value).map((point) => ({ ...point, payload: { ...point.payload, extra: 'keep' } }));
    const f = fixture([value], existing);
    const summary = await f.knowledge.sync();
    assert.equal(summary.unchanged, 2);
    assert.deepEqual(f.events, []);
});

test('changed content refreshes cached hashes without regenerating manual questions; delete precedes embed', async () => {
    const original = tag();
    const changed = { ...original, text: '  Changed answer.  ' };
    const existing = legacyPoints(original).map((point) => ({
        ...point,
        payload: { ...point.payload, extra: 'keep' },
    }));
    const f = fixture([changed], existing);
    const summary = await f.knowledge.sync();
    assert.equal(summary.added, 1);
    assert.equal(summary.deleted, 1);
    assert.equal(summary.metaUpdated, 1);
    assert.equal(summary.vectorUpdated, 0);
    assert.equal(
        f.events.some(([type]) => type === 'chat'),
        false,
    );
    const effects = f.events.filter(([type]) => ['delete', 'embed', 'upsert', 'batch'].includes(type));
    assert.deepEqual(
        effects.map(([type]) => type),
        ['delete', 'embed', 'upsert', 'batch'],
    );
    assert.deepEqual(effects[1][1], ['Changed answer.']);
    const refreshed = f.tags.get(changed._id);
    assert.equal(refreshed.knowledgeBase.textHash, sha1('Changed answer.'));
    assert.equal(
        refreshed.knowledgeBase.generationHash,
        legacyKB.evaluate('tagQuestionGenerationHash')(legacyTag(refreshed)),
    );
    assert.equal([...f.points.values()].find((point) => point.payload.kind === 'tag_question').payload.extra, 'keep');
    assert.equal((await f.knowledge.sync()).unchanged, 2);
});

test('stale, malformed and long initialized caches follow legacy repair; empty initialized questions stay empty', async () => {
    for (const questions of [
        [],
        [
            { text: ' Long  question? ', hash: sha1('Long question?') },
            { text: 'bad', hash: 'wrong' },
            { text: 'X'.repeat(220), hash: sha1('X'.repeat(220)) },
        ],
    ]) {
        const value = tag();
        value.knowledgeBase = { questions, textHash: 'stale', generationHash: 'stale', generatedAt: new Date(0) };
        const f = fixture([value]);
        await f.knowledge.sync();
        const actual = f.tags.get(value._id).knowledgeBase;
        assert.deepEqual(actual.questions, plain(legacyKB.evaluate('normalizeExistingQuestions')(questions)));
        assert.equal(actual.textHash, sha1(value.text));
        assert.equal(actual.generationHash, legacyKB.evaluate('tagQuestionGenerationHash')(legacyTag(value)));
        assert.equal(
            f.events.some(([type]) => type === 'chat'),
            false,
        );
        assert.equal(actual.generatedAt.getTime(), 0);
    }
});

test('uninitialized cache generation and manual editing reproduce legacy prompt, hashes and first-casing normalization', async () => {
    const value = tag('daily', '  Use owo daily.  ');
    value.knowledgeBase = { questions: [] };
    const f = fixture([value]);
    f.openRouter.chat = async (...args) => {
        f.events.push(['chat', ...args]);
        return '["Question?", "question?", "  Other   question? "]';
    };
    await f.knowledge.sync();
    const call = f.events.find(([type]) => type === 'chat');
    assert.equal(call[1], legacyKB.evaluate('TAG_QUESTION_SYSTEM_PROMPT'));
    assert.equal(call[2], legacyKB.evaluate('buildTagQuestionPrompt')(legacyTag(value)));
    assert.deepEqual(
        f.tags.get(value._id).knowledgeBase.questions,
        plain(
            legacyKB.evaluate(
                'toQuestionCacheEntries(normalizeGeneratedQuestions(["Question?", "question?", "  Other   question? "]))',
            ),
        ),
    );
    const editor = await f.knowledge.updateQuestions(value._id, 'FIRST?\nfirst?\n  Next   question?\n');
    assert.equal(editor.current, true);
    assert.deepEqual(
        editor.questions,
        plain(
            legacyKB.evaluate(
                'toQuestionCacheEntries(normalizeManualQuestions("FIRST?\\nfirst?\\n  Next   question?\\n"))',
            ),
        ),
    );
    const empty = await f.knowledge.updateQuestions(value._id, '');
    assert.deepEqual(empty.questions, []);
    assert.equal((await f.knowledge.sync()).totalQuestions, 0);
});

test('dry run uses old cached identities without cache writes and rejects regeneration', async () => {
    const value = tag();
    value.text = 'edited';
    const f = fixture([value], legacyPoints(value));
    assert.equal((await f.knowledge.sync({ dryRun: true })).unchanged, 2);
    assert.deepEqual(f.events, []);
    await assert.rejects(f.knowledge.sync({ dryRun: true, regenerateQuestions: true }), /cannot be dry-run/i);
});

test('custom namespace, empty answer, missing tag deletion and same-ID metadata repair match baseline', async () => {
    const value = tag('empty', '', []);
    const custom = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
    const f = fixture([value], [{ id: 'obsolete', payload: { tag_id: 'deleted' } }], { namespace: custom });
    await f.knowledge.sync();
    assert.deepEqual(
        [...f.points.values()].map(({ id, payload }) => ({ id, payload })),
        legacyPoints(value, custom),
    );
    const desired = legacyPoints(tag());
    const g = fixture(
        [tag()],
        desired.map((point) => ({ ...point, payload: { ...point.payload, data_hash: 'bad', extra: true } })),
    );
    const summary = await g.knowledge.sync();
    assert.equal(summary.vectorUpdated, 0);
    assert.equal(summary.metaUpdated, 2);
    assert.equal(
        g.events.some(([type]) => type === 'embed'),
        false,
    );
    const h = fixture(
        [tag()],
        desired.map((point) => ({ ...point, payload: { ...point.payload, kind: 'wrong' } })),
    );
    assert.equal((await h.knowledge.sync()).vectorUpdated, 2);
});

async function compareAsk(
    t,
    {
        question = 'What is cp and xp?',
        history = [],
        rankings = [
            { index: 1, relevance_score: 0.95 },
            { index: 1, relevance_score: 0.9 },
        ],
        response = '{"answer":"  Answer.  ","tagIds":[" daily ","daily","missing"]}',
    } = {},
) {
    const values = [tag('daily', '  Daily. \t\n\n\nMore.  '), tag('xp', 'XP.'), tag('cp', 'CP.')];
    const hits = values.map((value, index) => ({
        id: `hit-${index}`,
        score: 0.9 - index / 10,
        payload: { tag_id: value._id, kind: 'tag_answer' },
    }));
    const terms = new Map([
        ['xp', ' experience '],
        ['cp', 'combat power'],
        ['combat_power', 'phrase not a legacy token'],
    ]);
    const replies = (url) =>
        url.endsWith('/embeddings')
            ? { data: [{ embedding: [1, 2] }] }
            : url.endsWith('/rerank')
              ? { results: rankings }
              : { choices: [{ message: { content: response } }] };
    const currentRequests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        currentRequests.push({ url, body: JSON.parse(options.body) });
        return { ok: true, json: async () => replies(url) };
    });
    const oldRequests = [];
    const oldRouter = loadLegacy('src/modules/OpenRouter.js', {
        axios: {
            post: async (url, body) => {
                oldRequests.push({ url, body: plain(body) });
                return { data: replies(url) };
            },
        },
    });
    const router = new oldRouter.exports({ config: { openrouter: config.openRouter }, modules: { elasticapm: apm } });
    router.apiKey = 'offline';
    const old = new legacyKB.exports({
        config: { kb: { ...config.knowledgeBase, topK: 3 } },
        modules: { openrouter: router, elasticapm: apm },
        snail_db: {
            Tag: { find: () => ({ lean: async () => values.map(legacyTag) }) },
            KnowledgeTerm: {
                find: ({ _id }) => ({
                    lean: async () =>
                        [...terms]
                            .filter(([id]) => _id.$in.includes(id))
                            .map(([_id_, meaning]) => ({ _id: _id_, meaning })),
                }),
            },
        },
    });
    old.qdrant = { search: async () => hits };
    old.fetchAskConversationHistory = async () => history;
    const expected = await old.fetchAskAnswer(question);
    const current = createKnowledgeBase({
        config: { ...config.knowledgeBase, topK: 3 },
        tags: new Map(values.map((value) => [value._id, value])),
        terms,
        qdrant: { query: async () => ({ points: hits }) },
        openRouter: createOpenRouter(config.openRouter, 'offline', apm),
        elasticApm: apm,
        log,
    });
    const actual = await current.ask(question, history);
    assert.deepEqual(currentRequests, oldRequests);
    assert.deepEqual(actual, {
        answer: expected.answer,
        sources: plain(
            expected.sources.map((source) => ({ _id: source.tagId, public: source.visibility !== 'kb_only' })),
        ),
    });
    return currentRequests;
}

test('actual embed/rerank/chat HTTP bodies and outputs match the old pipeline with duplicate/partial reranks', async (t) => {
    await compareAsk(t);
});

test('history expansion, exact prompt and latest-history ellipsis match the old pipeline', async (t) => {
    await compareAsk(t, {
        history: [
            { role: 'user', content: 'How do I claim daily?' },
            { role: 'assistant', content: 'Use owo daily.' },
        ],
    });
    await compareAsk(t, { history: [{ role: 'assistant', content: 'a'.repeat(1300) }] });
});

test('missing, empty, invalid and overfull rerank responses preserve baseline backfill/topK', async (t) => {
    for (const rankings of [
        null,
        {},
        [],
        [{ index: 2, score: 1 }],
        [null, { index: -1, score: 1 }, { index: 99, score: 2 }],
        [
            { index: 2, score: 3 },
            { index: 0, score: 2 },
            { index: 1, score: 1 },
            { index: 2, score: 0 },
        ],
    ]) {
        await compareAsk(t, { rankings });
    }
});

test('answer JSON and source parsing matches legacy fallback and Markdown recovery', async (t) => {
    for (const response of [
        'not JSON',
        '{}',
        '{"answer":"","tagIds":[]}',
        '```json\n{"answer":"hello","tagIds":[" cp "]}\n```',
        String.raw`{"answer":"\_hello\_","tagIds":["daily"]}`,
    ])
        await compareAsk(t, { response });
});

test('collection setup retains both legacy keyword indexes', async () => {
    const f = fixture();
    await f.knowledge.initialize();
    assert.deepEqual(
        f.events.map(([, body]) => body.field_name),
        ['tag_id', 'kind'],
    );
});

test('mixed fresh and repaired tags keep the legacy document embedding order', async () => {
    const stale = tag('first');
    stale.knowledgeBase.generationHash = 'stale';
    const fresh = tag('second');
    const f = fixture([stale, fresh]);
    await f.knowledge.sync();
    assert.deepEqual(
        [...f.points.keys()],
        [...legacyPoints(f.tags.get('first')), ...legacyPoints(f.tags.get('second'))].map((point) => point.id),
    );
});

test('editing or regenerating excluded questions removes existing tag points', async () => {
    for (const operation of ['updateQuestions', 'regenerateQuestions']) {
        const value = tag();
        value.knowledgeBase.excluded = true;
        const f = fixture([value], legacyPoints(value));
        await f.knowledge[operation](value._id, 'Manual?');
        assert.equal(f.points.size, 0);
    }
});

test('upstream Mongoose-aware cache replacement survives single-tag legacy freshness restoration', async () => {
    const connection = mongoose.createConnection();
    const Model = createTagModel(connection);
    const value = new Model(tag());
    value.text = 'Edited document';
    const f = fixture([value]);
    await f.knowledge.syncTags([value]);
    const updated = f.tags.get(value._id);
    assert.equal(updated.text, 'Edited document');
    assert.equal(updated.public, true);
    assert.equal(updated.knowledgeBase.textHash, sha1(updated.text));
    assert.equal(
        updated.knowledgeBase.generationHash,
        legacyKB.evaluate('tagQuestionGenerationHash')(legacyTag(updated)),
    );
    assert.equal(
        f.events.some(([type]) => type === 'chat'),
        false,
    );
    assert.deepEqual(
        [...f.points.values()].map(({ id, payload }) => ({ id, payload })),
        legacyPoints(updated),
    );
    await connection.close();
});

test('legacy answer checkpoints stop before search or chat after the 90-second budget', async (t) => {
    for (const phase of ['embed', 'query', 'rerank']) {
        let now = 0;
        t.mock.method(Date, 'now', () => now);
        const f = fixture([tag(), tag('cp')]);
        f.openRouter.embed = async () => {
            if (phase === 'embed') now = 90_000;
            return [[1, 2]];
        };
        f.qdrant.query = async () => {
            if (phase === 'query') now = 90_000;
            return { points: [...f.tags.keys()].map((id) => ({ score: 1, payload: { tag_id: id } })) };
        };
        f.openRouter.rerank = async () => {
            if (phase === 'rerank') now = 90_000;
            return [];
        };
        await assert.rejects(f.knowledge.ask('Help?'), /Knowledge base answer timed out/);
        assert.equal(
            f.events.some(([type]) => type === 'chat'),
            false,
        );
    }
});
