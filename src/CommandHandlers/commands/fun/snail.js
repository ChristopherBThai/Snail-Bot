const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({

	alias: ["snail", "🐌"],

	emoji: '🐌',

	execute: async function() {
		await this.msg.channel.createMessage(`🐌`);
	}

});
