require('dotenv').config();

class Client extends require('eris').Client {
    constructor(token, options) {
        super(token, options);

        this.modules = Object.entries(require('require-dir')('./src/modules')).reduce((modules, [name, module]) => {
            try {
                var handler = new module(this);
            } catch (error) {
                console.log(`Error initializing "${name}" module!`);
                console.error(error);
            }

            if (handler.events) {
                for (let [event, listener] of Object.entries(handler.events)) {
                    this.on(event, listener.bind(handler));
                }
            } else {
                console.log(`Module "${name}" missing events field!`);
            }

            modules[name] = handler;
            return modules;
        }, {});

        this.socket = new (require('./src/socket'))(this);

        this.config = require('./src/config.json');
		this.snail_db = new (require('./src/databases/mongodb/mongo.js'))();
        // this.getkey
        // this.setkey
		this.query_owo_db = require('./src/databases/mysql/mysql.js');
		this.log = async (message) => {
			await this.createMessage(this.config.channels.log, message);
		}
    }
}

const Bot = new Client(process.env.BOT_TOKEN, require('./src/config.json').eris);

Bot.emit("snailSetup");
Bot.connect();

module.exports = Client;
