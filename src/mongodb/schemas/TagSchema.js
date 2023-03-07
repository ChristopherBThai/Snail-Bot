const mongoose = require('mongoose');

const TagSchema = new mongoose.Schema({
    _id: String,
    data: String,
});

module.exports = { name: 'Tag', schema: TagSchema };