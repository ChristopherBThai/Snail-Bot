require('dotenv').config();

const CONFIG = require('./src/config.json');;

const bot = new (require('eris')).Client(process.env.BOT_TOKEN, CONFIG.eris);

bot.config = CONFIG;
bot.db = new (require('./src/mongodb/mongo.js'))();
bot.owo_db = require('./src/mysql/mysql.js');
bot.log = async (message) => {
    await bot.createMessage(CONFIG.channels.log, message);
}

const eventHandlers = new (require('./src/EventHandlers/EventHandler.js'))(bot);
const socket = new (require('./src/socket'))(bot);

(async () => {
    bot.questList.maxQuests = {
        cookieBy: (await bot.db.QuestListSetting.findOne({ _id: "cookieMax" }))?.value,
        prayBy: (await bot.db.QuestListSetting.findOne({ _id: "prayMax" }))?.value,
        curseBy: (await bot.db.QuestListSetting.findOne({ _id: "curseMax" }))?.value,
        emoteBy: (await bot.db.QuestListSetting.findOne({ _id: "actionMax" }))?.value,
    }

    bot.questList.messageCountRepostInterval = (await bot.db.QuestListSetting.findOne({ _id: "MessageCountRepostInterval" }))?.value ?? bot.questList.messageCountRepostInterval;
})();

bot.connect();
