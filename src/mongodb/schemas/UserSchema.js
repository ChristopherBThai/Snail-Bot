const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
	_id: String,
	friends: [String],
});

module.exports = { name: 'User', schema: UserSchema };
