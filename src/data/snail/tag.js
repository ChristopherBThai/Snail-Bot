import mongoose from 'mongoose';

const tagSchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            match: /^[a-z0-9]+$/,
            required: true
        },
        createdBy: {
            type: String,
            match: /^\d{17,20}$/,
            required: true
        },
        data: String,
        lastUsedAt: Date,
        message: mongoose.Schema.Types.Mixed,
        publicChannelIds: {
            type: [String],
            default: []
        },
        updatedBy: {
            type: String,
            match: /^\d{17,20}$/,
            required: true
        },
        uses: {
            type: Number,
            default: 0
        }
    },
    {
        collection: 'tags',
        timestamps: true
    }
);

export function createTagModel(connection) {
    return connection.model('Tag', tagSchema);
}
