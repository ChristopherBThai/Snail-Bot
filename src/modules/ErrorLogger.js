module.exports = class ErrorLogger {
	constructor(bot) {
		this.bot = bot;
        this.events = {
            "error": this.log
        }
	}

	log(err, id) {
		console.error(`[${id}] ${err}`);
	}
};
