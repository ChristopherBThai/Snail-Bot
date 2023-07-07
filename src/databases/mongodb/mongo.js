const mongoose = require('mongoose');
// @ts-ignore
mongoose.connect(process.env.MONGO_URI, {
	useNewUrlParser: true,
	useUnifiedTopology: true,
});
// @ts-ignore
const db = mongoose.connection;

const requireDir = require('require-dir');
const dir = requireDir('./schemas');

db.on('error', console.error);
db.once('open', function () {
	console.log(`MongoDB connected to ${process.env.MONGO_URI}!`);
});

class Mongo {
	constructor() {
		this.connection = db;
		for (let i in dir) {
			const Schema = dir[i];
			this[Schema.name] = mongoose.model(Schema.name, Schema.schema);
		}
	}
}

module.exports = Mongo;
