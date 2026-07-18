const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadKnowledgeBaseHelpers() {
    const modulePath = path.join(__dirname, '..', 'src', 'modules', 'KnowledgeBase.js');
    const source = fs.readFileSync(modulePath, 'utf8');
    const sandbox = {
        module: { exports: {} },
        exports: {},
        require(request) {
            if (request === './Module') return class Module {};
            if (request === '../utils/kb.js')
                return { Qdrant: class Qdrant {}, embed: async () => [], chat: async () => ({}) };
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

    vm.runInNewContext(
        `${source}\nmodule.exports.__phase2Helpers = { buildDesiredTagPoints, buildPayload, tagFilter };`,
        sandbox,
        { filename: modulePath }
    );
    return sandbox.module.exports.__phase2Helpers;
}

const { buildDesiredTagPoints, buildPayload, tagFilter } = loadKnowledgeBaseHelpers();

const namespace = '1b671a64-40d5-491e-99b0-da01ff1f3341';
const tag = {
    _id: 'gems',
    data: 'Gems can be equipped before hunting to improve your hunt rewards and give you a chance to find gem-tier animals.',
    kb: {
        dataHash: '064c4f0012bc743005d310f04908e62713be347b',
        promptVersion: 'tag-question-v1',
        generationHash: '2ee307f0e9e8e9cbe75a58d57bd5661e7b578b34',
        questions: [
            { text: 'How do gems work in OwO?', hash: 'f0ee0e055ff09c490d1cbb60ea0a7f3841dd5a28' },
            { text: 'What do gems do when hunting?', hash: '084e155f4e832d015e58503cefdbb08a2886ce95' },
            { text: 'How do I use gems before a hunt?', hash: '93e431f945a5bb4a35b6ecb62875a4c7bc0b35ca' },
        ],
    },
};

const desired = buildDesiredTagPoints(tag, namespace);
const points = [...desired.values()];

assert.strictEqual(points.length, 1 + tag.kb.questions.length);
assert.strictEqual(points.filter((point) => point.kind === 'tag_answer').length, 1);
assert.strictEqual(points.filter((point) => point.kind === 'tag_question').length, tag.kb.questions.length);
assert.strictEqual(points.filter((point) => point.kind === 'tag_keyword').length, 0);
assert.strictEqual(new Set(points.map((point) => point.pointId)).size, points.length);

const answerPoint = points.find((point) => point.kind === 'tag_answer');
assert.strictEqual(answerPoint.text, tag.data);
assert.strictEqual(answerPoint.tagId, 'gems');
assert.strictEqual(answerPoint.dataHash, tag.kb.dataHash);

const normalize = (value) => JSON.parse(JSON.stringify(value));

const answerPayload = normalize(buildPayload(answerPoint));
assert.deepStrictEqual(answerPayload, {
    tag_id: 'gems',
    kind: 'tag_answer',
    data_hash: tag.kb.dataHash,
});
assert.ok(!Object.prototype.hasOwnProperty.call(answerPayload, 'data'));
assert.ok(!Object.prototype.hasOwnProperty.call(answerPayload, 'prompt_version'));

const questionPoint = points.find((point) => point.kind === 'tag_question');
assert.strictEqual(questionPoint.text, tag.kb.questions[0].text);
assert.strictEqual(questionPoint.tagId, 'gems');
assert.strictEqual(questionPoint.dataHash, tag.kb.dataHash);
assert.strictEqual(questionPoint.questionHash, tag.kb.questions[0].hash);
assert.strictEqual(questionPoint.pointId, buildDesiredTagPoints(tag, namespace).get(questionPoint.pointId).pointId);

const questionPayload = normalize(buildPayload(questionPoint));
assert.deepStrictEqual(questionPayload, {
    tag_id: 'gems',
    kind: 'tag_question',
    data_hash: tag.kb.dataHash,
    question: tag.kb.questions[0].text,
    question_hash: tag.kb.questions[0].hash,
});
assert.ok(!Object.prototype.hasOwnProperty.call(questionPayload, 'data'));
assert.ok(!Object.prototype.hasOwnProperty.call(questionPayload, 'prompt_version'));

assert.deepStrictEqual(normalize(tagFilter('gems')), { must: [{ key: 'tag_id', match: { value: 'gems' } }] });

console.log('KnowledgeBase builds tag-derived Qdrant point descriptors.');
