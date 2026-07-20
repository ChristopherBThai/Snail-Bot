const mongoose = require('mongoose');

const TagSchema = new mongoose.Schema({
    _id: String,
    data: String,
    kb: {
        dataHash: String,
        promptVersion: String,
        generationHash: String,
        questions: [
            {
                _id: false,
                text: String,
                hash: String,
            },
        ],
        generatedAt: Date,
    },
    knowledgeBase: {
        excluded: Boolean,
    },
});

module.exports = { name: 'Tag', schema: TagSchema };
