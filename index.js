require('dotenv').config();

const Eris = require("eris");
const bot = new Eris(process.env.BOT_TOKEN);

bot.config = require('./src/config.json');

const eventHandlers = new (require('./src/EventHandlers/EventHandler.js'))(bot);

bot.db = new (require('./src/mongodb/mongo.js'))();

bot.connect();
