const assert = require('assert');
const mongoose = require('mongoose');
const Tag = require('../src/databases/mongodb/schemas/TagSchema');

const TagModel = mongoose.model('TagPhase1KbCacheTest', Tag.schema);

const generatedAt = new Date('2026-07-15T05:00:00.000Z');
const tag = new TagModel({
    _id: 'gems',
    data: 'Gems can be equipped before hunting.',
    kb: {
        dataHash: '064c4f0012bc743005d310f04908e62713be347b',
        promptVersion: 'tag-question-v1',
        generationHash: '2ee307f0e9e8e9cbe75a58d57bd5661e7b578b34',
        questions: [
            {
                text: 'How do gems work in OwO?',
                hash: 'f0ee0e055ff09c490d1cbb60ea0a7f3841dd5a28',
            },
        ],
        generatedAt,
    },
});

const serialized = tag.toObject();

assert.strictEqual(serialized._id, 'gems');
assert.strictEqual(serialized.data, 'Gems can be equipped before hunting.');
assert.strictEqual(serialized.kb.dataHash, '064c4f0012bc743005d310f04908e62713be347b');
assert.strictEqual(serialized.kb.promptVersion, 'tag-question-v1');
assert.strictEqual(serialized.kb.generationHash, '2ee307f0e9e8e9cbe75a58d57bd5661e7b578b34');
assert.strictEqual(serialized.kb.questions[0].text, 'How do gems work in OwO?');
assert.strictEqual(serialized.kb.questions[0].hash, 'f0ee0e055ff09c490d1cbb60ea0a7f3841dd5a28');
assert.deepStrictEqual(serialized.kb.generatedAt, generatedAt);

console.log('TagSchema stores authored tag fields and derived KB cache questions.');
