const mongoose = require('mongoose');

module.exports = new mongoose.Schema({
    userId: { type: String, required: true },
    maxQuestSlots: Number,
    dailyQuestAt: Date,
    dailyRerollAt: Date,
    dailyRerollsUsed: Number,
    dailyChecklistClaimedAt: Date,
    dailyChecklistClaimedRewardInfo: mongoose.Schema.Types.Mixed,
    weeklyChecklistClaimedAt: Date,
    weeklyChecklistClaimedRewardInfo: mongoose.Schema.Types.Mixed
}, {
    timestamps: true,
    strict: false,
    collection: 'userquestboards'
});
