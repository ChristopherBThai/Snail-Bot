import mongoose from 'mongoose';

export function createTagModel(connection) {
    return connection.model(
        'Tag',
        new mongoose.Schema(
            {
                _id: String,
                data: String,
                blocks: [mongoose.Schema.Types.Mixed],
                publicChannelIDs: [String],
                createdBy: String,
                updatedBy: String
            },
            { timestamps: true }
        )
    );
}
