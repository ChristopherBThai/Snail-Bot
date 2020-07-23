const mongoose = require('mongoose');

const RoleSchema = new mongoose.Schema({
	_id: String,
	name: String,
	color: String,
	active: { type: Boolean, default: true }
});

module.exports = { name: 'Role', schema: RoleSchema };
