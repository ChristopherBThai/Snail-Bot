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

settingSchema.statics.loadValues = async function (namespace) {
    const prefix = `${namespace}:`;
    const records = await this.find({ _id: { $regex: `^${prefix}` } }).lean();
    return Object.fromEntries(records.map((record) => [record._id.slice(prefix.length), record.value]));
};

settingSchema.statics.saveValue = function (namespace, key, value) {
    return this.updateOne({ _id: `${namespace}:${key}` }, { $set: { value } }, { upsert: true });
};

export function createSettingModel(connection) {
    return connection.model('Setting', settingSchema);
}
