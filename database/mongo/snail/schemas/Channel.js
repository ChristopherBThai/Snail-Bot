const mongoose = require('mongoose');

module.exports = new mongoose.Schema({
    _id: String,
    disabledCommands: [{ type: String }],
});
