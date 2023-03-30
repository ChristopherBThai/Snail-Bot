const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({
	alias: ['ping', 'pong'],

	emoji: '🏓',

	cooldown: 5000,

	usage: "snail ping",

    description: "Pong!",

    examples: ["snail ping", "snail pong"],

	execute: async function () {
		if (this.msg.command == 'ping') {
			await this.send('Pong!');
		} else {
			await this.send('Ping!');
		}
	},
});
