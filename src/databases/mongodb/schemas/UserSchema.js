const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    _id: String,
    friends: [{ type: String, ref: 'User' }],
    reminders: {
        luck: { enabled: Boolean, default: false },
        hunt: { enabled: Boolean, default: false },
        battle: { enabled: Boolean, default: false },
    },
});

module.exports = { name: 'User', schema: UserSchema };
