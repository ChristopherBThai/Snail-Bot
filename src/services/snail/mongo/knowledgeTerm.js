import mongoose from 'mongoose';

const knowledgeTermSchema = new mongoose.Schema(
    {
        _id: { type: String, required: true },
        meaning: { type: String, required: true },
    },
    { collection: 'knowledgeTerms' },
);

export function createKnowledgeTermModel(connection) {
    return connection.model('KnowledgeTerm', knowledgeTermSchema);
}
