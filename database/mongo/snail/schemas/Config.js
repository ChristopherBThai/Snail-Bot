const mongoose = require('mongoose');

module.exports = new mongoose.Schema({
    _id: String,
    value: mongoose.Schema.Types.Mixed,
});
