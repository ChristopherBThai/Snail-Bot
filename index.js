require('dotenv').config();

const Eris = require("eris");
const bot = new Eris(process.env.BOT_TOKEN, {
	allowMentions: {
		everyone: false
	},
	getAllUsers: true
});

bot.config = require('./src/config.json');
bot.db = new (require('./src/mongodb/mongo.js'))();
bot.owo_db = require('./src/mysql/mysql.js');

const eventHandlers = new (require('./src/EventHandlers/EventHandler.js'))(bot);
const socket = new (require('./src/socket'))(bot);

bot.connect();
