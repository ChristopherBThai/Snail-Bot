const CommandHandler = require('../CommandHandlers/CommandHandler.js');

module.exports = class MessageCreateHandler {
	constructor (bot) {
		this.bot = bot;
		this.prefix = bot.config.prefix;
		this.command = new CommandHandler(bot);
	}

	handle (msg) {
		msg.args = this.hasPrefix(msg.content);
		if (msg.args) {
			this.command.execute(msg.args[0], msg);
		}
	}

	hasPrefix (content) {
		if (content.toLowerCase().trim().startsWith(this.prefix)) {
			return content.trim().slice(this.prefix.length).trim().split(/ +/g);
		}
	}
}
