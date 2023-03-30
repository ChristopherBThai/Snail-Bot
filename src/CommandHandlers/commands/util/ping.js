const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({
	alias: ['ping', 'pong'],

	emoji: '🏓',

	execute: async function () {
		if (this.msg.command == 'ping') {
			await this.send('Pong!');
		} else {
			await this.send('Ping!');
		}
	},
});
