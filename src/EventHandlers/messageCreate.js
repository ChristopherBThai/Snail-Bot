const CommandHandler = require('../CommandHandlers/CommandHandler.js');

module.exports = class MessageCreateHandler {
	constructor (bot) {
		this.bot = bot;
		this.prefixes = bot.config.prefix;
		this.command = new CommandHandler(bot);
	}

	handle (msg) {
		const args = this.hasPrefix(msg.content);
		if (args) {
			msg.command = args[0].toLowerCase();
			msg.args = args.splice(1);
			this.command.execute(msg);
		}
	}

	hasPrefix (content) {
		for (let i in this.prefixes) {
			let prefix = this.prefixes[i];
			if (content.toLowerCase().trim().startsWith(prefix)) {
				return content.trim().slice(prefix.length).trim().split(/ +/g);
			}
		}
	}
}
