const global = require('./global.js');

class MarketUtil {
	constructor(bot) {
		this.bot = bot;
		setInterval(this.sweepMarket.bind(this), 1000 * 60 * 60);
		this.sweepMarket();
	}

	async sweepMarket(start = '1064202915348238486', deleteCounter = 0) {
		const limit = 50;
		const messages = await this.bot.getMessages(this.bot.config.channels.market, limit, null, start);
		console.log(messages.length + ' messages found');

		const messagesToDelete = [];
		for (let i = 0; i < messages.length; i++) {
			const message = messages[i];
			if (global.hasRole(message.member, this.bot.config.roles.mods)
				|| global.hasRole(message.member, this.bot.config.roles.helpers)) {
				console.log(`Ignoring message from ${message.member.username}`);
				return;
			}
			const diff = (Date.now() - message.timestamp) / (1000 * 60 * 60);
			console.log(message.id + ' ' + diff);
			if (diff > 24) {
				deleteCounter++;
				console.log(`[${deleteCounter}][${Math.floor(diff)}Deleting messages from ${message.author.username}#${message.author.discriminator} `);
				await this.bot.deleteMessage(this.bot.config.channels.market, message.id, `${Math.floor(diff)}h old`);
			}
		}

		console.log(`Deleting ${deleteCounter} messages`);

		if (messages.length >= limit) {
			console.log('Did not get all market messages, retrying sweep');
			setTimeout(() => {
				this.sweepMarket(messages[messages.length - 1].id, deleteCounter)
			}, 10000);
		} else {
			console.log('Done with sweep');
		}
	}
}

module.exports = MarketUtil;
