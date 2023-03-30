const requireDir = require('require-dir');
const CommandInterface = require('./CommandInterface.js');
const global = require('../utils/global.js');

class CommandHandler {
	constructor(bot) {
		this.bot = bot;
		this.commands = {};
		this.initCommands();
	}

	async execute(msg) {
		const command = this.commands[msg.command];
		if (!command) return;
		await command.execute(this.constructBind(command, msg));

		console.log(`${msg.author.username}#${msg.author.discriminator} (${msg.author.id}) used "${msg.command}" in ${msg.channel.name}`);
	}

	constructBind(command, msg) {
		const bindObj = {
			msg,
			commands: this.commands,
			command,
			global,
			config: this.bot.config,
			db: this.bot.db,
			bot: this.bot,
		};

		bindObj.send = (text) => {
			return msg.channel.createMessage(`${command.emoji} **|** ${text}`);
		};

		bindObj.reply = (text) => {
			return msg.channel.createMessage(`${command.emoji} **| ${msg.author.username}**${text}`);
		};

		bindObj.error = async (text) => {
			let msgObj = await msg.channel.createMessage(`🚫 **| ${msg.author.username}**${text}`);
			setTimeout(() => {
				msgObj.delete();
			}, 5000);
			return msgObj;
		};

		bindObj.log = async (text) => {
			return await this.bot.log(`${command.emoji} **|** ${text}`);
		};

		return bindObj;
	}

	initCommands() {
		const dir = requireDir('./commands', { recurse: true });

		// Repeat #map(file => file instanceof CommandInterface ? file : Object.values(file)).flat() once for each level of folders in "./commands"
		Object
			.values(dir)
			.flat()
			.map(file => file instanceof CommandInterface ? file : Object.values(file))
			.flat()
			.filter(command => command instanceof CommandInterface)
			.forEach(command => {
				const aliases = command.alias;
				aliases.forEach(alias => {
					if (this.commands[alias]) {
						const firstInstance = this.commands[alias].alias[0];
						const secondInstance = command.alias[0];
						throw new Error(`Duplicate command alias, ${alias}, found in ${firstInstance} and ${secondInstance} commands!`);
					}
					this.commands[alias] = command;
				})
			});
	}
}

module.exports = CommandHandler;
