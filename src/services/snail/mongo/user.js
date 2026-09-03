import mongoose from 'mongoose';

const messageBuilderSchema = new mongoose.Schema(
    {
        draft: {
            type: {
                allowMentions: {
                    type: Boolean,
                    default: false,
                },
                components: {
                    type: [mongoose.Schema.Types.Mixed],
                    default: [],
                },
            },
            default: undefined,
        },
    },
    { _id: false },
);

const remindersSchema = new mongoose.Schema(
    {
        luck: {
            type: Boolean,
            default: false,
        },
    },
    { _id: false },
);

const ticketMarketSchema = new mongoose.Schema(
    {
        activeAd: {
            type: {
                availabilityDeadline: { type: Date, default: undefined },
                accentColor: { type: Number, default: undefined },
                channelId: { type: String, required: true },
                messageId: { type: String, required: true },
                note: { type: String, default: undefined },
                price: { type: Number, required: true },
                ticketCount: { type: Number, required: true },
            },
            default: undefined,
        },
        lastAdPostedAt: { type: Date, default: undefined },
    },
    { _id: false },
);

const supporterRolesSchema = new mongoose.Schema(
    {
        optout: {
            type: Boolean,
            default: false,
        },
    },
    { _id: false },
);

const userSchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            required: true,
        },
        messageBuilder: {
            type: messageBuilderSchema,
            default: undefined,
        },
        reminders: {
            type: remindersSchema,
            default: undefined,
        },
        supporterRoles: {
            type: supporterRolesSchema,
            default: undefined,
        },
        ticketMarket: {
            type: ticketMarketSchema,
            default: undefined,
        },
    },
    {
        collection: 'users',
        timestamps: true,
    },
);

export function createUserModel(connection) {
    return connection.model('User', userSchema);
}
