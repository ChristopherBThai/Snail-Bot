const mongoose = require('mongoose');

const ConfigSchema = new mongoose.Schema({
    _id: String,
    value: mongoose.Mixed,
});

module.exports = { name: 'Config', schema: ConfigSchema };
