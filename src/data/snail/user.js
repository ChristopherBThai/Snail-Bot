import mongoose from 'mongoose';

const messageBuilderSchema = new mongoose.Schema(
    {
        draft: {
            allowMentions: {
                type: Boolean,
                default: false
            },
            components: {
                type: [mongoose.Schema.Types.Mixed],
                default: []
            }
        }
    },
    { _id: false }
);

const userSchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            required: true
        },
        messageBuilder: {
            type: messageBuilderSchema,
            default: undefined
        }
    },
    {
        collection: 'users',
        timestamps: true
    }
);

export function createUserModel(connection) {
    return connection.model('User', userSchema);
}
