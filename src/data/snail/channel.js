import mongoose from 'mongoose';

const channelSchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            required: true
        },
        tagsPublicByDefault: {
            type: Boolean,
            default: false
        }
    },
    {
        collection: 'channels',
        timestamps: true
    }
);

export function createChannelModel(connection) {
    return connection.model('Channel', channelSchema);
}
