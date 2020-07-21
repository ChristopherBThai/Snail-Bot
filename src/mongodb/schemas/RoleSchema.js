const mongoose = require('mongoose');

const RoleSchema = new mongoose.Schema({
	_id: String,
	name: String,
	color: String
});

module.exports = { name: 'Role', schema: RoleSchema };
