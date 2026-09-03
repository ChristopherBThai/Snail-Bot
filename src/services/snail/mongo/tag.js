import mongoose from 'mongoose';

const tagSchema = new mongoose.Schema(
    {
        _id: { type: String, required: true },
        message: { type: mongoose.Schema.Types.Mixed, required: true },
        text: { type: String, default: '' },
        public: { type: Boolean, required: true },
        knowledgeBase: {
            excluded: { type: Boolean, default: false },
            questions: {
                type: [
                    {
                        _id: false,
                        text: { type: String, required: true },
                        hash: { type: String, required: true },
                    },
                ],
                default: undefined,
            },
            textHash: String,
            generationHash: String,
            generatedAt: Date,
        },
    },
    { collection: 'tags' },
);

export function createTagModel(connection) {
    return connection.model('Tag', tagSchema);
}
