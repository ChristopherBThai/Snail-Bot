import mongoose from 'mongoose';

export function createUserLogModel(connection) {
    const schema = new mongoose.Schema({
        userID: { type: String, required: true },
        actorID: String,
        source: { type: String, required: true },
        kind: { type: String, required: true },
        summary: String,
        metadata: mongoose.Schema.Types.Mixed,
        createdAt: { type: Date, required: true, default: Date.now }
    });

    schema.index({ userID: 1, createdAt: -1 });
    schema.index({ userID: 1, source: 1, kind: 1, createdAt: -1 });
    schema.index({ actorID: 1, createdAt: -1 });

    return connection.model('UserLog', schema);
}
