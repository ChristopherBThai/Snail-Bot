import mongoose from 'mongoose';

const userQuestSchema = new mongoose.Schema(
    {
        userId: String,
        slotIndex: Number,
        questType: String,
        targetCount: Number,
        statKey: String,
        startValue: Number,
        targetValue: Number,
        locked: Boolean,
        createdAt: Date,
    },
    { collection: 'userquests' },
);

export function createUserQuestModel(connection) {
    return connection.model('UserQuest', userQuestSchema);
}
