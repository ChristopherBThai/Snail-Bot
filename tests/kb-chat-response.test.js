const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadKbUtils(fakeAxios) {
    const modulePath = path.join(__dirname, '..', 'src', 'utils', 'kb.js');
    const source = fs.readFileSync(modulePath, 'utf8');
    const sandbox = {
        module: { exports: {} },
        exports: {},
        require(request) {
            if (request === 'axios') return fakeAxios;
            return require(request);
        },
        setTimeout,
    };
    vm.runInNewContext(source, sandbox, { filename: modulePath });
    return sandbox.module.exports;
}

async function testChatNullContent() {
    const requests = [];
    const fakeAxios = {
        async post(url, body, options) {
            requests.push({ url, body, options });
            return {
                data: {
                    choices: [{ message: { content: null } }],
                    usage: { prompt_tokens: 3, completion_tokens: 0 },
                },
            };
        },
    };
    const { chat } = loadKbUtils(fakeAxios);

    const result = await chat({
        apiKey: 'test-key',
        model: 'test/model',
        messages: [{ role: 'user', content: 'return json' }],
        maxTokens: 100,
        temperature: 0.2,
    });

    assert.strictEqual(result.content, '');
    assert.deepStrictEqual(result.usage, { prompt_tokens: 3, completion_tokens: 0 });
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0].body.model, 'test/model');
    assert.strictEqual(requests[0].options.headers.Authorization, 'Bearer test-key');

    console.log('KB chat helper tolerates null model content so generation errors stay tag-scoped.');
}

async function testEmbeddingRetriesTransientSocketFailures() {
    const requests = [];
    const fakeAxios = {
        async post(url, body, options) {
            requests.push({ url, body, options });
            if (requests.length === 1) {
                const err = new Error('write EPIPE');
                err.code = 'EPIPE';
                throw err;
            }
            return { data: { data: [{ embedding: [0.1, 0.2] }] } };
        },
    };
    const { embed } = loadKbUtils(fakeAxios);

    const vectors = await embed({ apiKey: 'test-key', model: 'embed/model', inputs: ['hello'] });

    assert.deepStrictEqual(vectors, [[0.1, 0.2]]);
    assert.strictEqual(requests.length, 2);
    assert.strictEqual(requests[1].body.model, 'embed/model');
}

async function testQdrantUpsertRetriesTransientSocketFailures() {
    const puts = [];
    const fakeClient = {
        async put(url, body) {
            puts.push({ url, body });
            if (puts.length === 1) {
                const err = new Error('write EPIPE');
                err.code = 'EPIPE';
                throw err;
            }
            return { data: {} };
        },
    };
    const fakeAxios = {
        create() {
            return fakeClient;
        },
    };
    const { Qdrant } = loadKbUtils(fakeAxios);
    const qdrant = new Qdrant({ url: 'http://qdrant.test', apiKey: 'qdrant-key' });

    await qdrant.upsert('kb', [{ id: 'point-1', vector: [0.1], payload: { tag_id: 'gems' } }]);

    assert.strictEqual(puts.length, 2);
    assert.strictEqual(puts[1].url, '/collections/kb/points?wait=true');
}

async function main() {
    await testChatNullContent();
    await testEmbeddingRetriesTransientSocketFailures();
    await testQdrantUpsertRetriesTransientSocketFailures();
    console.log('KB HTTP helpers retry transient socket failures.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
