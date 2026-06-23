import mongoose from 'mongoose';

export function createQuestModel(connection) {
    const questSchema = new mongoose.Schema({
        userID: { type: String, required: true },
        questID: { type: String, required: true },
        questType: { type: String, required: true },
        startValue: { type: Number, required: true },
        targetValue: { type: Number, required: true },
        addedAt: { type: Number, required: true }
    });

    questSchema.index({ questID: 1 }, { unique: true });
    questSchema.index({ questType: 1, addedAt: 1 });
    questSchema.index({ userID: 1 });

    return connection.model('Quest', questSchema);
}
