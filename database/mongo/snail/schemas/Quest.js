const mongoose = require('mongoose');

module.exports = new mongoose.Schema({
    userID: { type: String, required: true },
    claimedAt: { type: String, required: true },
    addedAt: { type: Number, required: true },
    discordID: String,
    claimed: String,
    added: Number
});
