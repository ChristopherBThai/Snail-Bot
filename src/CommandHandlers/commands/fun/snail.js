const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({
	alias: ['snail', '🐌'],

	emoji: '🐌',

	usage: "snail snail",

    description: "🐌",

	execute: async function () {
		await this.msg.channel.createMessage(`🐌`);
	},
});
