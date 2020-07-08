module.exports = class ReadyHandler {
	constructor (bot) {
		this.bot = bot;
	}

	handle () {
		console.log("Bot is ready!");
	}
}
