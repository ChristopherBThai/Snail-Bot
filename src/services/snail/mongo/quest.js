import mongoose from 'mongoose';

const questSchema = new mongoose.Schema(
    {
        userId: { type: String, required: true, index: true },
        questId: { type: String, required: true, unique: true, index: true },
        questCreatedAt: { type: Date, required: true },
        addedAt: { type: Date, required: true },
    },
    { collection: 'quests' },
);

export function createQuestModel(connection) {
    return connection.model('Quest', questSchema);
}
