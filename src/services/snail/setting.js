import mongoose from 'mongoose';

const settingSchema = new mongoose.Schema(
    {
        _id: {
            type: String,
            required: true,
        },
        value: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
    },
    {
        collection: 'settings',
        timestamps: true,
    },
);

export function createSettingModel(connection) {
    return connection.model('Setting', settingSchema);
}
