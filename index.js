require('dotenv').config();
const CONFIG = require(process.env.DEBUG ? './config.debug.json' : './config.json');

class Snail extends require('eris').Client {
    constructor(token, options) {
        if (!token) throw new Error('BOT_TOKEN is not set.');
        token = token.startsWith('Bot ') ? token.slice(4).trim() : token;
        if (!token) throw new Error('BOT_TOKEN is not set.');

        process.env.BOT_TOKEN = token;
        super(token, options);

        this.config = CONFIG;
        /** @type {Object<string, import('./modules/Module')>} */
        this.modules = {};

        // Lifecycle events
        this.on('error', (err, id) => { console.error(`[${id}] ${err}`); });
        this.on('ready', () => { console.log('Bot is ready!'); });

        // Custom message events
        this.on('messageCreate', (message) => {
            if (message.author.bot) {
                const USER_ID = message.author.id;

                // Message from OwO
                if (USER_ID === CONFIG.owo.id) this.emit('owoMessage', message);
                // Message from Dyno
                else if (CONFIG.dyno.ids.includes(USER_ID)) this.emit('dynoMessage', message);
            } else {
                // Message from a user
                this.emit('userMessage', message);

                const CONTENT = message.content;
                const LOWER = CONTENT.toLowerCase();

                // Command parsing code copied from OwO source https://github.com/ChristopherBThai/Discord-OwO-Bot/blob/master/src/commands/command.js
                if (LOWER.startsWith(CONFIG.owo.prefix)) {
                    const args = CONTENT.slice(CONFIG.owo.prefix.length).trim().split(/ +/g);
                    const command = args.shift()?.toLowerCase();

                    // A message that could be an OwO command
                    this.emit('owoCommand', { command, args, message });
                }
            }
        });
    }

    // For any properties whose construction depeneds on awaiting the databases
    async init() {
        // Databases
        this.database = await require('./database').init();
        this.snailMongo = this.database.snailMongo;
        this.owoMysql = this.database.owoMysql;
        this.owoMongo = this.database.owoMongo;
        this.owoRedis = this.database.owoRedis;

        // Compatibility aliases
        this.mongo = this.snailMongo;
        this.mysql = this.owoMysql;

        // Modules
        this.commandHandler = new (require('./modules/CommandHandler'))(this);
        this.interactionHandler = new (require('./modules/InteractionHandler'))(this);
        this.logger = new (require('./modules/Logger'))(this);
        this.banBotBannedUsers = new (require('./modules/BanBotBannedUsers'))(this);
    }

    async getConfig(_id) {
        return (await this.mongo.Config.findOne({ _id }))?.value;
    }

    async setConfig(_id, value) {
        return await this.mongo.Config.updateOne({ _id }, { value }, { upsert: true });
    }
}

(async () => {
    const bot = new Snail(process.env.BOT_TOKEN, CONFIG.eris);
    await bot.init();
    bot.connect();
})();

module.exports = Snail;
