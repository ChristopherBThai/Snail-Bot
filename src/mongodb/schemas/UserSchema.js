const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
	_id: String,
	friends: [{ type: String, ref: 'User' }],
});

module.exports = { name: 'User', schema: UserSchema };
