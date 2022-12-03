module.exports = class ErrorHandler {
	constructor(bot) {
		this.bot = bot;
	}

	handle(err, id) {
		console.error(`[${id}] ${err}`);
	}
};
