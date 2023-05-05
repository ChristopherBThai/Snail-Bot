const requireDir = require('require-dir');
const CommandInterface = require('../commands/CommandInterface');
const { ephemeralReply } = require("../utils/sender");

// Maybe in the future, move this into the custom client extension class. Feels weird to put it on the same level as the other modules.
// Maybe just a whole custom "commandExecuted" event and have commands more directly coupled with their modules
module.exports = class CommandHandler {
	constructor(bot) {
		this.bot = bot;
		this.bot.commands = {}
		this.events = {
			"messageCreate": this.checkPrefix,
		}
		this.initCommands();
	}

	async checkPrefix(message) {
		if (message.author.bot) return;

		for (const prefix of this.bot.config.prefixes) {
			if (message.content.toLowerCase().trim().startsWith(prefix)) {
				let args = message.content.trim().slice(prefix.length).trim().split(/ +/g);
				message.command = args[0].toLowerCase();
				message.args = args.splice(1);
				await this.checkCommand(message);
				break;
			}
		}
	}

	async checkCommand(message) {
		const command = this.bot.commands[message.command];
		if (!command) return;

		const channel = await this.bot.snail_db.Channel.findById(message.channel.id);
		if (channel?.disabledCommands.includes(command.alias[0])) {
			await ephemeralReply(message, `🚫 **| ${message.author.username}**, that command has been disabled in this channel`);
			return;
		}

		const params = {
			message,
			command,
			config: this.bot.config,
			snail_db: this.bot.snail_db,
			bot: this.bot,
		};

		params.send = (text) => {
			return message.channel.createMessage(`${command.emoji} **|** ${text}`);
		};

		params.reply = (text) => {
			return message.channel.createMessage(`${command.emoji} **| ${message.author.username}**${text}`);
		};

		params.error = async (text) => {
			return await ephemeralReply(message, `🚫 **| ${message.author.username}**${text}`);
		};

		params.log = async (text) => {
			return await this.bot.log(`${command.emoji} **|** ${text}`);
		};

		await command.execute(params);
	}

	initCommands() {
		const dir = requireDir('../commands', { recurse: true });

		// Repeat #map(file => file instanceof CommandInterface ? file : Object.values(file)).flat() once for each level of folders in "./commands"
		Object.values(dir)
			.flat()
			.map(file => file instanceof CommandInterface ? file : Object.values(file))
			.flat()
			.filter(command => command instanceof CommandInterface)
			.forEach(command => {
				command.alias.forEach(alias => {
					if (this.bot.commands[alias]) {
						const firstInstance = this.bot.commands[alias].alias[0];
						const secondInstance = command.alias[0];
						throw new Error(`Duplicate command alias, ${alias}, found in ${firstInstance} and ${secondInstance} commands!`);
					}
					this.bot.commands[alias] = command;
				});
			});
	}
};