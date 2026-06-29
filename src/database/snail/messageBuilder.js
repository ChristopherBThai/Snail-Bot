import mongoose from 'mongoose';

export function createBuilderDraftModel(connection) {
    return connection.model(
        'BuilderDraft',
        new mongoose.Schema(
            {
                _id: String,
                blocks: [mongoose.Schema.Types.Mixed],
                selectedBlockPath: [Number],
                source: mongoose.Schema.Types.Mixed,
                updatedBySessionID: String
            },
            { timestamps: true }
        )
    );
}
