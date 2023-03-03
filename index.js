require('dotenv').config();

const CONFIG = require('./src/config.json');;

const bot = new (require('eris')).Client(process.env.BOT_TOKEN, CONFIG.eris);

bot.config = CONFIG;
bot.db = new (require('./src/mongodb/mongo.js'))();
bot.owo_db = require('./src/mysql/mysql.js');

const eventHandlers = new (require('./src/EventHandlers/EventHandler.js'))(bot);
const socket = new (require('./src/socket'))(bot);

bot.connect();
