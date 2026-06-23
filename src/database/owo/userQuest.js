import mongoose from 'mongoose';

export function createUserQuestModel(connection) {
    return connection.model(
        'UserQuest',
        new mongoose.Schema(
            {
                userId: { type: String, required: true },
                slotIndex: { type: Number, required: true },
                questType: { type: String, required: true },
                tier: { type: Number, required: true },
                targetCount: { type: Number, required: true },
                statKey: { type: String, required: true },
                startValue: { type: Number, required: true },
                targetValue: { type: Number, required: true },
                locked: { type: Boolean, default: false }
            },
            {
                timestamps: true,
                strict: false,
                collection: 'userquests'
            }
        )
    );
}
