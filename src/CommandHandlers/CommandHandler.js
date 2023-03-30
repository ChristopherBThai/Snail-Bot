const requireDir = require('require-dir');
const CommandInterface = require('./CommandInterface.js');
const global = require('../utils/global.js');

class CommandHandler {
	constructor(bot) {
		this.bot = bot;
		this.commands = {};
		this.aliasToCommand = {};
		this.initCommands();
	}

	async execute(msg) {
		console.log(`${msg.author.username}#${msg.author.discriminator} (${msg.author.id}) used "${msg.command}" in ${msg.channel.name}`);
		const commandName = this.aliasToCommand[msg.command];
		if (!commandName) return;
		const commandObj = this.commands[commandName];
		await commandObj.execute(this.constructBind(commandName, commandObj, msg));
	}

	constructBind(commandName, commandObj, msg) {
		const bindObj = {
			msg,
			commands: this.commands,
			aliasToCommand: this.aliasToCommand,
			commandName,
			commandObj,
			global,
			config: this.bot.config,
			db: this.bot.db,
			bot: this.bot,
		};

		bindObj.send = (text) => {
			return msg.channel.createMessage(`${commandObj.emoji} **|** ${text}`);
		};

		bindObj.reply = (text) => {
			return msg.channel.createMessage(
				`${commandObj.emoji} **| ${msg.author.username}**${text}`
			);
		};

		bindObj.error = async (text) => {
			let msgObj = await msg.channel.createMessage(
				`🚫 **| ${msg.author.username}**${text}`
			);
			setTimeout(() => {
				msgObj.delete();
			}, 5000);
			return msgObj;
		};

		bindObj.log = async (text) => {
			return await this.bot.log(`${commandObj.emoji} **|** ${text}`);
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

	parseCommand(commandObj) {
		const commandName = commandObj.alias[0];

		if (this.commands[commandName]) throw new Error('Duplicate command names');
		this.commands[commandName] = commandObj;

		for (let i in commandObj.alias) {
			const commandAlias = commandObj.alias[i];
			if (this.aliasToCommand[commandAlias])
				throw new Error('Duplicate command alias');
			this.aliasToCommand[commandAlias] = commandName;
		}
	}
}

module.exports = CommandHandler;
