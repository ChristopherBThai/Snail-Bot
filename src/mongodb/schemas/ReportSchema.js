const mongoose = require('mongoose');

const UserSchema = require('./UserSchema.js');

const ReportSchema = new mongoose.Schema({
	sender: { type: UserSchema.schema, default: null },
	message: String,
	mentions: [
		{
			type: String,
			ref: 'User',
		},
	],
});

module.exports = { name: 'Report', schema: ReportSchema };
