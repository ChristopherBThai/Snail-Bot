const Command = require('../Command.js');

module.exports = new Command({
	alias: ['ping', 'pong'],

    group: "Util",

	cooldown: 5000,

	usage: "snail ping",

	description: "Pong!",

	execute: async function () {
        if (this.message.command == "ping") await this.send(`Pong!`);
        else await this.send(`Ping!`);
	},
});
