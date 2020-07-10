const requireDir = require('require-dir');
const CommandInterface = require('./CommandInterface.js');

class CommandHandler {

	constructor(bot){
		this.bot = bot;
		this.initCommands();
	}

	async execute (command, msg) {
		const commandName = this.aliasToCommand[command.toLowerCase()];
		if (!commandName) return;
		const commandObj = this.commands[commandName];
		await commandObj.execute(this.constructBind(command, commandName, commandObj, msg));
	}

	constructBind (command,  commandName, commandObj, msg) {
		const bindObj = {
			msg,
			commands: this.commands,
			aliasToCommand: this.aliasToCommand,
			command: command.toLowerCase(),
			commandName,
			commandObj
		}

		bindObj.send = (text) => {
			return msg.channel.createMessage(`${commandObj.emoji} **|** ${text}`);
		}

		return bindObj;
	}

	initCommands () {
		const dir = requireDir('./commands', {recurse: true});
		this.commands = {};
		this.aliasToCommand = {};

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

	parseCommand (commandObj) {
		const commandName = commandObj.alias[0];

		if (this.commands[commandName]) throw new Error("Duplicate command names");
		this.commands[commandName] = commandObj;

		for (let i in commandObj.alias) {
			const commandAlias = commandObj.alias[i];
			if (this.aliasToCommand[commandAlias]) throw new Error("Duplicate command alias");
			this.aliasToCommand[commandAlias] = commandName;
		}
	}

}

module.exports = CommandHandler;
