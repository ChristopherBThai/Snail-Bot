const requireDir = require('require-dir');
const CONFIG = require('./config.json');

require('dotenv').config();

class Client extends require('eris').Client {
    constructor(token, options) {
        super(token, options);

        this.config = CONFIG;

        // Miscellaneous events
        this.on("error", (err, id) => {
            console.error(`[${id}] ${err}`);
        });

        this.on("ready", () => {
            console.log("Bot is ready!");
        });

        // Custom events
        this.on("messageCreate", (message) => {
            if (message.author.bot) {
                if (message.author.id == CONFIG.owobot) {
                    // Message from OwO
                    this.emit("OwOMessage", message);
                } else {
                    // Message from a bot that is not OwO
                    this.emit("BotMessage", message);
                }
            } else {
                // Message from a non-bot user
                this.emit("UserMessage", message);

                if (message.content.toLowerCase().startsWith(CONFIG.owoprefix)) {
                    let args = message.content.slice(CONFIG.owoprefix.length).trim().split(/ +/g);
                    let command = args.shift()?.toLowerCase();
    
                    // A message that could be an OwO command
                    this.emit("OwOCommand", { command, args, message });
                }
            }
        });

        // Realtime OwO-Snail websocket 
        this.socket = new (require('./src/socket'))(this);

        // Snail's own mongo database for snail stuff
        this.snail_db = new (require('./src/databases/mongodb/mongo.js'))();

        // A direct connection to OwO's database
        this.query_owo_db = require('./src/databases/mysql/mysql.js');

        // Load modules and thier commands
        this.modules = Object.values(requireDir("./src/modules"))
            // Ignore the Module interface class 
            .filter(module => module.name != "Module")
            .map(module => new module(this))
            .reduce((modules, module) => {
                modules[module.id] = module;
                return modules;
            }, {});
    }

    // Some helper functions
    async getConfiguration(_id) {
        return (await this.snail_db.Config.findOne({ _id }))?.value;
    }

    async setConfiguration (_id, value) {
        return await this.snail_db.Config.updateOne({ _id }, { value }, { upsert: true });
    }
    
    async getUser(userID) {
        if (!userID) return undefined;
        return this.users.get(userID) || this.getRESTUser(userID).catch(() => {});
    }
}

const Bot = new Client(process.env.BOT_TOKEN, CONFIG.eris);

Bot.connect();

module.exports = Client;
