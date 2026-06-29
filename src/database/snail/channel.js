import mongoose from 'mongoose';

export function createChannelModel(connection) {
    return connection.model(
        'Channel',
        new mongoose.Schema(
            {
                _id: String,
                tagsPublicByDefault: {
                    type: Boolean,
                    default: false
                }
            },
            { timestamps: true }
        )
    );
}
