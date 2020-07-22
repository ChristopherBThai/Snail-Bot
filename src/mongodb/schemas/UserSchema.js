const mongoose = require('mongoose');

const RoleSchema = require('./RoleSchema.js');

const UserSchema = new mongoose.Schema({
	_id: String,

	roleBenefit: {
		months: { type: Number, default: 0 },
		started: { type: Date, default: Date.now }
	},

	role: { type: RoleSchema, default: null }
});

module.exports = { name: 'User', schema: UserSchema };
