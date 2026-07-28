const mongoose = require('mongoose');

const KnowledgeTermSchema = new mongoose.Schema({
    _id: String,
    meaning: String,
});

module.exports = { name: 'KnowledgeTerm', schema: KnowledgeTermSchema };
