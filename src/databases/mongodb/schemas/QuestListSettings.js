const mongoose = require('mongoose');

const QuestListSettingSchema = new mongoose.Schema({
	_id: String,
	value: Number,
});

module.exports = { name: 'QuestListSetting', schema: QuestListSettingSchema };
