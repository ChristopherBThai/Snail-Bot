import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectQdrant, requestQdrant } from '../src/services/qdrant.js';
import { createKnowledgeBase } from '../src/features/knowledgeBase/knowledge.js';

// Real SDK, synthetic transport only: no Qdrant, model, or database calls.
async function fixture(t, respond) {
    const requests = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        if (new URL(url).pathname === '/') return response({ version: '1.19.0' });
        const request = { path: new URL(url).pathname, body: JSON.parse(init.body ?? '{}') };
        requests.push(request);
        return respond(request, requests);
    };
    t.after(() => {
        globalThis.fetch = originalFetch;
    });
    const qdrant = await connectQdrant('http://qdrant.invalid:6333');
    let embeddings = 0;
    const noop = () => {};
    const log = {
        trace: noop,
        debug: noop,
        warn: noop,
        error: noop,
        time: () => ({ checkpoint: noop, info: noop, debug: noop, error: noop }),
    };
    const tags = new Map();
    const kb = createKnowledgeBase({
        Tag: { updateOne: async () => {} },
        config: {
            collection: 'test',
            embeddingSize: 2,
            queryInstruction: 'search',
            rerankCandidateLimit: 8,
            scoreThreshold: 0.5,
            topK: 3,
        },
        tags,
        terms: new Map(),
        qdrant,
        log,
        openRouter: {
            embed: async () => {
                embeddings++;
                return [[1, 0]];
            },
        },
        elasticApm: { startTransaction: noop, captureError: noop },
    });
    return { kb, tags, requests, embeddings: () => embeddings };
}

test('upsert retries without re-embedding or changing points', async (t) => {
    const writes = [];
    const f = await fixture(t, (request) => {
        if (request.path.endsWith('/scroll')) return response({ points: [] });
        writes.push(request);
        return writes.length < 3 ? response({}, 503) : response({ operation_id: 1, status: 'completed' });
    });
    const tag = { _id: 'tag', text: 'answer', public: true, knowledgeBase: { questions: [] } };
    f.tags.set(tag._id, tag);
    await f.kb.syncTags([tag]);
    assert.equal(writes.length, 3);
    assert.deepEqual(writes[0], writes[2]);
    assert.equal(writes[0].body.points[0].payload.tag_id, 'tag');
    assert.deepEqual(writes[0].body.points[0].vector, [1, 0]);
    assert.equal(f.embeddings(), 1);
});

test('collection setup retries each request with the ordinary policy', async (t) => {
    const attempts = new Map();
    const f = await fixture(t, (request) => {
        const key = JSON.stringify(request);
        const attempt = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, attempt);
        if (attempt < 3) return response({}, 503);
        return response(request.path.endsWith('/exists') ? { exists: false } : true);
    });
    await f.kb.initialize();
    assert.deepEqual([...attempts.values()], [3, 3, 3]);
});

test('retry delays are 500/1000ms and the final original error propagates', async (t) => {
    const delays = [];
    t.mock.method(globalThis, 'setTimeout', (resolve, delay) => {
        delays.push(delay);
        resolve();
    });
    const errors = [1, 2, 3].map(() => Object.assign(new Error('temporary'), { status: 503 }));
    let attempts = 0;
    await assert.rejects(
        requestQdrant(() => {
            throw errors[attempts++];
        }),
        (error) => error === errors[2],
    );
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [500, 1000]);
});

test('startup version check remains single-attempt', async (t) => {
    let attempts = 0;
    t.mock.method(globalThis, 'fetch', async () => {
        attempts++;
        return response({}, 503);
    });
    await assert.rejects(connectQdrant('http://qdrant.invalid:6333'), (error) => error.status === 503);
    assert.equal(attempts, 1);
});

function response(result, status = 200, headers = {}) {
    return new Response(JSON.stringify({ result, status: 'ok', time: 0 }), {
        status,
        headers: { 'content-type': 'application/json', ...headers },
    });
}

for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    test(`retrieval recovers from HTTP ${status} on second attempt`, async (t) => {
        const f = await fixture(t, (_, requests) =>
            requests.length === 1
                ? response({}, status, status === 429 ? { 'retry-after': '1' } : {})
                : response({ points: [] }),
        );
        const result = await f.kb.find('question');
        assert.deepEqual(result.groups, []);
        assert.equal(f.requests.length, 2);
        assert.deepEqual(f.requests[0], f.requests[1]);
        assert.equal(f.embeddings(), 1);
    });
}

for (const code of ['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT']) {
    test(`retrieval recovers from transport ${code}`, async (t) => {
        const f = await fixture(t, (_, requests) => {
            if (requests.length === 1)
                throw new TypeError('fetch failed', { cause: Object.assign(new Error(), { code }) });
            return response({ points: [] });
        });
        await f.kb.find('question');
        assert.equal(f.requests.length, 2);
    });
}

test('SDK timeout is retried', async (t) => {
    const f = await fixture(t, (_, requests) => {
        if (requests.length === 1) throw new DOMException('timed out', 'AbortError');
        return response({ points: [] });
    });
    await f.kb.find('question');
    assert.equal(f.requests.length, 2);
});

for (const method of ['find', 'ask']) {
    test(`${method} exhausts after two requests`, async (t) => {
        const f = await fixture(t, () => response({}, 503));
        await assert.rejects(f.kb[method]('question'), (error) => error.status === 503);
        assert.equal(f.requests.length, 2);
        assert.equal(f.embeddings(), 1);
    });
}

for (const status of [400, 401, 403, 404, 409, 422]) {
    test(`permanent HTTP ${status} is not retried`, async (t) => {
        const f = await fixture(t, () => response({}, status));
        await assert.rejects(f.kb.find('question'), (error) => error.status === status);
        assert.equal(f.requests.length, 1);
    });
}

test('non-transient errors propagate unchanged without retry', async (t) => {
    const error = new TypeError('invalid request');
    const f = await fixture(t, () => {
        throw error;
    });
    await assert.rejects(f.kb.find('question'), (caught) => caught === error);
    assert.equal(f.requests.length, 1);
});

test('sync retries each page and update independently, without replaying prior requests', async (t) => {
    const attempts = new Map();
    const f = await fixture(t, (request) => {
        const key = JSON.stringify(request);
        const attempt = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, attempt);
        if (attempt < 3) return response({}, 503);
        if (request.path.endsWith('/count')) return response({ count: 2 });
        if (request.path.endsWith('/scroll'))
            return response({
                points: [{ id: request.body.offset ?? 'first', payload: {} }],
                next_page_offset: request.body.offset ? null : 'second',
            });
        return response([{ operation_id: 1, status: 'completed' }]);
    });
    const summary = await f.kb.sync();
    assert.equal(summary.deleted, 2);
    assert.equal(attempts.size, 4);
    assert.deepEqual([...attempts.values()], [3, 3, 3, 3]);
    assert.equal(f.embeddings(), 0);
});

test('sync exhausts after three attempts and leaves failed state', async (t) => {
    const f = await fixture(t, () => response({}, 503));
    await assert.rejects(f.kb.sync(), (error) => error.status === 503);
    assert.equal(f.requests.length, 3);
    assert.equal(f.kb.state.syncing, false);
    assert.equal(f.kb.state.progress.phase, 'failed');
});

test('tag deletion retries identical filter and stops at three attempts', async (t) => {
    const f = await fixture(t, (_, requests) =>
        requests.length < 3 ? response({}, 503) : response({ operation_id: 1, status: 'completed' }),
    );
    await f.kb.deleteTags(['tag']);
    assert.equal(f.requests.length, 3);
    assert.deepEqual(f.requests[0], f.requests[2]);
    assert.deepEqual(f.requests[0].body, { filter: { must: [{ key: 'tag_id', match: { value: 'tag' } }] } });
});
