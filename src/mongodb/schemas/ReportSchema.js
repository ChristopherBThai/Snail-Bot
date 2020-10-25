const customAlphabet = require('nanoid').customAlphabet;
const nanoid = customAlphabet('1234567890abcdefghijklmnopqrstuvwxyz', 8);
const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
	_id: {
        'type': String,
        'default': () => nanoid()
      },
	sender: String,
	message: String,
	mentions: [String]
});

module.exports = { name: 'Report', schema: ReportSchema };
