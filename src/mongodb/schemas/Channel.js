const mongoose = require('mongoose');

const ChannelSchema = new mongoose.Schema({
	_id: String,
	disabledCommands: [{ type: String }],
});

module.exports = { name: 'Channel', schema: ChannelSchema };
