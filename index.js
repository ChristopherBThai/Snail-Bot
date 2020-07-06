require('dotenv').config();

const Eris = require("eris");
const bot = new Eris(process.env.BOT_TOKEN);

bot.config = require('./src/config.json');
const eventHandlers = new (require('./src/EventHandlers/EventHandler.js'))(bot);

bot.on("messageCreate", (msg) => {
    if(msg.content === "!ping") {
        bot.createMessage(msg.channel.id, "Pong!");
    } else if(msg.content === "!pong") {
        bot.createMessage(msg.channel.id, "Ping!");
    }
});

bot.connect();
