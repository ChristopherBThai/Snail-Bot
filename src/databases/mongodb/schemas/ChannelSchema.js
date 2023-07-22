const mongoose = require('mongoose');

const ChannelSchema = new mongoose.Schema({
	_id: String,
	disabledCommands: [{ type: String }],
	// Will be useful for filters later
});

module.exports = { name: 'Channel', schema: ChannelSchema };
