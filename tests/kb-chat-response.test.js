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
    };
    vm.runInNewContext(source, sandbox, { filename: modulePath });
    return sandbox.module.exports;
}

async function main() {
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

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
