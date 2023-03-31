const requireDir = require('require-dir');
const CommandInterface = require('./CommandInterface.js');
const global = require('../utils/global.js');

class CommandHandler {
	constructor(bot) {
		this.bot = bot;
		this.commands = {};
		this.initCommands();
		console.log(Object.keys(this.commands));
	}

	async execute(msg) {
		const command = this.commands[msg.command];
		if (!command) return;

		const channel = await this.bot.db.Channel.findById(msg.channel.id);
		if (channel?.disabledCommands.includes(command.alias[0])) {
			let msgObj = await msg.channel.createMessage(`🚫 **| ${msg.author.username}**, that command has been disabled in this channel`);
			setTimeout(() => {
				msgObj.delete();
			}, 5000);
			return;
		}

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

		for (let key in dir) {
			if (dir[key] instanceof CommandInterface) {
				this.parseCommand(dir[key]);
			} else {
				for (let key2 in dir[key]) {
					if (dir[key][key2] instanceof CommandInterface) {
						this.parseCommand(dir[key][key2]);
					}
				}
			}
		}
	}

	parseCommand(command) {
		const aliases = command.alias;

		aliases.forEach(alias => {
			if (this.commands[alias]) {
				const firstInstance = this.commands[alias].alias[0];
				const secondInstance = command.alias[0];
				throw new Error(`Duplicate command alias, ${alias}, found in ${firstInstance} and ${secondInstance} commands!`);
			}
			this.commands[alias] = command;
		});

		console.log(`Registered command ${aliases[0]}`);
	}
}

module.exports = CommandHandler;
