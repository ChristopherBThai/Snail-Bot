const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({

	alias: ["ping", "pong"],

	emoji: '🏓',

	execute: async function() {
		if (this.command == "ping") {
			this.send("Pong!");
		} else {
			this.send("Ping!");
		}
	}

});
