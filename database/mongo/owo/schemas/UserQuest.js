const mongoose = require('mongoose');

module.exports = new mongoose.Schema({
    userId: { type: String, required: true },
    slotIndex: Number,
    questType: String,
    tier: Number,
    rewardType: String,
    rewardAmount: Number,
    targetCount: Number,
    statKey: String,
    startValue: Number,
    targetValue: Number,
    locked: Boolean,
    metadata: mongoose.Schema.Types.Mixed
}, {
    timestamps: true,
    strict: false,
    collection: 'userquests'
});
