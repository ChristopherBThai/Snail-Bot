const mongoose = require('mongoose');

const RoleSchema = require('./RoleSchema.js');

const UserSchema = new mongoose.Schema({
	_id: String,
	role: { type: RoleSchema }
});

module.exports = { name: 'User', schema: UserSchema };
