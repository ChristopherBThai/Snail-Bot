import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as turn } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { connectQdrant } from '../src/services/qdrant.js';
import { createAsk } from '../src/features/knowledgeBase/ask.js';
import { createKnowledgeBase } from '../src/features/knowledgeBase/knowledge.js';
import { legacyKB, legacyTag, legacyPoints, loadLegacy, plain } from './helpers/legacy.js';
import { createHash } from 'node:crypto';

test('actual delete-first sync recovers transient scroll/delete/upsert/metadata failures', async (t) => {
    const delays = immediateRetries(t);
    const hash = (text) => createHash('sha1').update(text).digest('hex');
    const tag = {
        _id: 'daily',
        text: 'New answer.',
        public: true,
        message: {},
        knowledgeBase: {
            questions: [{ text: 'How daily?', hash: hash('How daily?') }],
            textHash: hash('New answer.'),
        },
    };
    tag.knowledgeBase.generationHash = legacyKB.evaluate('tagQuestionGenerationHash')(legacyTag(tag));
    const original = {
        ...tag,
        text: 'Old answer.',
        knowledgeBase: { ...tag.knowledgeBase, textHash: hash('Old answer.') },
    };
    for (const permanentFailure of [false, true]) {
        const points = new Map(legacyPoints(original).map((point) => [point.id, point]));
        const attempts = new Map();
        const events = [];
        t.mock.method(globalThis, 'fetch', async (url, init) => {
            const path = new URL(url).pathname;
            if (!path.includes('/collections/')) return response({ version: '1.19.0' });
            const body = JSON.parse(init.body || '{}');
            const operation = path.endsWith('/count')
                ? 'count'
                : path.endsWith('/scroll')
                  ? 'scroll'
                  : path.endsWith('/delete')
                    ? 'delete'
                    : path.endsWith('/batch')
                      ? 'metadata'
                      : 'upsert';
            const attempt = (attempts.get(operation) ?? 0) + 1;
            attempts.set(operation, attempt);
            events.push(operation);
            if (operation !== 'count' && (attempt === 1 || (operation === 'upsert' && permanentFailure)))
                return response({}, 503);
            if (operation === 'count') return response({ count: points.size });
            if (operation === 'scroll') return response({ points: [...points.values()], next_page_offset: null });
            if (operation === 'delete') for (const id of body.points) points.delete(id);
            if (operation === 'upsert') for (const point of body.points) points.set(point.id, point);
            if (operation === 'metadata')
                for (const { set_payload: patch } of body.operations)
                    for (const id of patch.points) Object.assign(points.get(id).payload, patch.payload);
            assert.equal(new URL(url).searchParams.get('wait'), 'true');
            return response({ status: 'completed' });
        });
        const qdrant = await connectQdrant('https://offline.invalid');
        const knowledge = createKnowledgeBase({
            config: config.knowledgeBase,
            tags: new Map([['daily', tag]]),
            terms: new Map(),
            qdrant,
            openRouter: {
                embed: async (input) => {
                    events.push('embed');
                    return input.map(() => [1, 2]);
                },
            },
            elasticApm: apm,
            log,
        });
        delays.length = 0;
        if (permanentFailure) {
            await assert.rejects(knowledge.sync());
            assert.deepEqual(events, [
                'count',
                'scroll',
                'scroll',
                'delete',
                'delete',
                'embed',
                'upsert',
                'upsert',
                'upsert',
            ]);
            assert.deepEqual(
                delays.filter((ms) => ms < 15_000),
                [500, 500, 500, 1000],
            );
            assert.equal(points.has(legacyPoints(original)[0].id), false);
            assert.equal(knowledge.state.syncing, false);
        } else {
            await knowledge.sync();
            assert.deepEqual(events, [
                'count',
                'scroll',
                'scroll',
                'delete',
                'delete',
                'embed',
                'upsert',
                'upsert',
                'metadata',
                'metadata',
            ]);
            assert.deepEqual(
                [...points.values()]
                    .map(({ id, payload }) => ({ id, payload }))
                    .sort((a, b) => a.id.localeCompare(b.id)),
                legacyPoints(tag).sort((a, b) => a.id.localeCompare(b.id)),
            );
            assert.deepEqual(
                delays.filter((ms) => ms < 15_000),
                [500, 500, 500, 500],
            );
        }
    }
});

test('default Qdrant retry exhaustion matches baseline three attempts and linear delay', async (t) => {
    const delays = immediateRetries(t);
    let attempts = 0;
    t.mock.method(globalThis, 'fetch', async (url) => {
        if (!String(url).includes('/points/query')) return response({ version: '1.19.0' });
        attempts++;
        return response({}, 503);
    });
    const current = await connectQdrant('https://offline.invalid');
    delays.length = 0;
    await assert.rejects(current.query('kb', query));
    let oldAttempts = 0;
    const expectedDelays = [];
    const old = loadLegacy('src/utils/kb.js', {
        axios: {
            create: () => ({
                post: async () => {
                    oldAttempts++;
                    throw Object.assign(new Error('transient'), { response: { status: 503 } });
                },
            }),
        },
    });
    old.context.setTimeout = (fn, ms) => {
        expectedDelays.push(ms);
        queueMicrotask(fn);
    };
    await assert.rejects(new old.exports.Qdrant({ url: 'offline' }).search('kb', { vector: [1, 2] }));
    assert.equal(attempts, oldAttempts);
    assert.deepEqual(
        delays.filter((ms) => ms < 15_000),
        expectedDelays,
    );
    assert.deepEqual(expectedDelays, [500, 1000]);
});

test('collection and tag-filter operations retain SDK routes/bodies and bounded retries', async (t) => {
    const delays = immediateRetries(t);
    const calls = [];
    const counts = new Map();
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        const path = new URL(url).pathname;
        if (path === '/') return response({ version: '1.19.0' });
        const key = `${init.method} ${path}`;
        const count = (counts.get(key) ?? 0) + 1;
        counts.set(key, count);
        calls.push({ key, body: init.body ? JSON.parse(init.body) : undefined });
        if (count === 1) return response({}, 503);
        return response(path.endsWith('/exists') ? { exists: false } : true);
    });
    const current = await connectQdrant('https://offline.invalid');
    delays.length = 0;
    assert.deepEqual(await current.collectionExists('kb'), { exists: false });
    await current.createCollection('kb', { vectors: { size: 4096, distance: 'Cosine' } });
    await current.createPayloadIndex('kb', { field_name: 'kind', field_schema: 'keyword', wait: true });
    const filter = { must: [{ key: 'tag_id', match: { any: ['daily'] } }] };
    await current.delete('kb', { filter, wait: true });
    await current.deleteCollection('kb');
    assert.deepEqual(
        calls.filter((_, index) => index % 2 === 0),
        [
            { key: 'GET /collections/kb/exists', body: undefined },
            { key: 'PUT /collections/kb', body: { vectors: { size: 4096, distance: 'Cosine' } } },
            { key: 'PUT /collections/kb/index', body: { field_name: 'kind', field_schema: 'keyword' } },
            { key: 'POST /collections/kb/points/delete', body: { filter } },
            { key: 'DELETE /collections/kb', body: undefined },
        ],
    );
    assert.deepEqual(
        delays.filter((ms) => ms < 15_000),
        [500, 500, 500, 500, 500],
    );
});

const config = JSON.parse(readFileSync(new URL('../src/config/production.json', import.meta.url)));
const log = {
    info() {},
    warn() {},
    error() {},
    debug() {},
    trace() {},
    time: () => ({ checkpoint() {}, debug() {}, info() {} }),
};
const apm = { startTransaction() {}, captureError() {} };
const response = (result, status = 200) =>
    new Response(JSON.stringify({ result }), {
        status,
        headers: { 'content-type': 'application/json' },
    });
const query = { query: [1, 2], limit: 50, with_payload: true, score_threshold: 0.5 };

function immediateRetries(t) {
    const delays = [];
    const original = setTimeout;
    t.mock.method(globalThis, 'setTimeout', (fn, ms, ...args) => {
        delays.push(ms);
        return original(fn, [500, 1000].includes(ms) ? 0 : ms, ...args);
    });
    return delays;
}

test('SDK query retries exactly the legacy statuses/network codes, attempts and delays', async (t) => {
    const delays = immediateRetries(t);
    for (const failure of [
        408,
        425,
        429,
        500,
        502,
        503,
        504,
        400,
        401,
        404,
        'EPIPE',
        'ECONNRESET',
        'ETIMEDOUT',
        'ECONNABORTED',
        'ENOTFOUND',
        'other',
    ]) {
        let attempts = 0;
        t.mock.method(globalThis, 'fetch', async (url) => {
            if (!String(url).includes('/points/query')) return response({ version: '1.19.0' });
            attempts++;
            if (attempts > 1) return response({ points: [] });
            if (typeof failure === 'number') return response({}, failure);
            throw new TypeError('fetch failed', { cause: Object.assign(new Error('offline'), { code: failure }) });
        });
        const current = await connectQdrant('https://offline.invalid');
        let oldAttempts = 0;
        const old = loadLegacy('src/utils/kb.js', {
            axios: {
                create: () => ({
                    post: async () => {
                        oldAttempts++;
                        if (oldAttempts === 1)
                            throw Object.assign(
                                new Error('offline'),
                                typeof failure === 'number' ? { response: { status: failure } } : { code: failure },
                            );
                        return { data: { result: [] } };
                    },
                }),
            },
        });
        old.context.setTimeout = (fn) => queueMicrotask(fn);
        const expected = await Promise.allSettled([
            new old.exports.Qdrant({ url: 'offline' }).search('kb', { vector: [1, 2], attempts: 2 }),
        ]);
        delays.length = 0;
        const actual = await Promise.allSettled([current.query('kb', query, { timeout: 15_000, attempts: 2 })]);
        assert.equal(actual[0].status, expected[0].status, String(failure));
        assert.equal(attempts, oldAttempts, String(failure));
        assert.deepEqual(
            delays.filter((ms) => ms < 15_000),
            attempts === 2 ? [500] : [],
        );
    }
});

test('SDK query aborts each attempt at the supplied HTTP timeout, not a server timeout', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const signals = [];
    const urls = [];
    t.mock.method(globalThis, 'fetch', async (url, init) => {
        if (!String(url).includes('/points/query')) return response({ version: '1.19.0' });
        urls.push(String(url));
        signals.push(init.signal);
        return new Promise((_, reject) =>
            init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))),
        );
    });
    const current = await connectQdrant('https://offline.invalid');
    const pending = current.query('kb', query, { timeout: 123, attempts: 2 });
    const rejected = assert.rejects(pending);
    await turn();
    assert.equal(signals.length, 1);
    t.mock.timers.tick(122);
    assert.equal(signals[0].aborted, false);
    t.mock.timers.tick(1);
    await turn();
    assert.equal(signals[0].aborted, true);
    t.mock.timers.tick(499);
    await turn();
    assert.equal(signals.length, 1);
    t.mock.timers.tick(1);
    await turn();
    assert.equal(signals.length, 2);
    t.mock.timers.tick(123);
    await rejected;
    assert.equal(signals[1].aborted, true);
    assert.ok(urls.every((url) => !url.includes('timeout=')));
});

test('actual mention and slash history consume the legacy deadline and request envelope', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let now = 0;
    t.mock.method(Date, 'now', () => now);
    for (const elapsed of [0, 80_000, 89_499, 89_498, 89_999, 91_000]) {
        for (const slash of [false, true]) {
            now = 0;
            let actualOptions;
            let queries = 0;
            let chats = 0;
            const router = {
                embed: async () => {
                    now = elapsed;
                    return [[1, 2]];
                },
                chat: async () => {
                    chats++;
                    return '{}';
                },
            };
            const knowledge = createKnowledgeBase({
                config: config.knowledgeBase,
                tags: new Map(),
                terms: new Map(),
                openRouter: router,
                qdrant: {
                    query: async (_name, _body, options) => {
                        queries++;
                        actualOptions = options;
                        return { points: [] };
                    },
                },
                elasticApm: apm,
                log,
            });
            const channel = { id: '100', parentId: '10', ownerId: '42', type: 11 };
            const ask = createAsk({
                knowledge,
                log,
                rest: {
                    applicationId: '42',
                    getChannel: async () => channel,
                    getMessages: async () => {
                        now = Math.max(0, elapsed - 2000);
                        return [];
                    },
                    getMessage: async () => undefined,
                    triggerTypingIndicator: async () => {},
                    sendMessage: async () => ({ id: '104', channelId: '100' }),
                },
            });
            const run = () =>
                slash
                    ? ask.handleCommand({
                          interaction: {
                              channel,
                              user: { id: '11' },
                              data: { options: [{ name: 'question', value: 'Help?' }] },
                          },
                          defer: async () => {},
                          editResponse: async () => ({ id: '104', channelId: '100' }),
                      })
                    : ask.handleMessage({ id: '103', channelId: '100', author: { id: '11' }, content: '<@42> Help?' });
            if (elapsed >= 90_000) {
                await assert.rejects(run(), /answer timed out/);
                assert.equal(queries, 0);
            } else {
                await run();
                assert.equal(queries, 1);
                assert.deepEqual(actualOptions, plain(legacyKB.evaluate('remainingAskRequestOptions')(0, 15_000, 2)));
            }
            assert.equal(chats, 0);
            now = 0;
            const old = new legacyKB.exports({ config: { kb: config.knowledgeBase }, modules: { openrouter: router } });
            let expectedOptions;
            old.qdrant = {
                search: async (_name, { timeout, attempts }) => {
                    expectedOptions = { timeout, attempts };
                    return [];
                },
            };
            old.fetchAskConversationHistory = async () => {
                now = Math.max(0, elapsed - 2000);
                return [];
            };
            if (elapsed >= 90_000) await assert.rejects(old.fetchAskAnswer('Help?'), /answer timed out/);
            else {
                await old.fetchAskAnswer('Help?');
                assert.deepEqual(actualOptions, expectedOptions);
            }
        }
    }
});
