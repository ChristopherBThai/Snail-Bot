const mongoose = require('mongoose');

const QuestSchema = new mongoose.Schema({
	discordID: { type: String, ref: 'User' },
	claimed: String,
	added: Number,
});

module.exports = { name: 'Quest', schema: QuestSchema };
