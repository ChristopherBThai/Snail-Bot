const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    _id: String,
    friends: [{ type: String, ref: 'User' }],
    reminders: {
        luck: { enabled: Boolean },
        hunt: { enabled: Boolean },
        battle: { enabled: Boolean },
    },
    snailRoles: { type: Boolean },
});

module.exports = { name: 'User', schema: UserSchema };
