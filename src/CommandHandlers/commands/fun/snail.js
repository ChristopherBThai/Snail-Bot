const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({
	alias: ['snail', '🐌'],

	emoji: '🐌',

	cooldown: 1000,

	usage: "snail snail",

    description: "🐌",

	execute: async function () {
		await this.msg.channel.createMessage(`🐌`);
	},
});
