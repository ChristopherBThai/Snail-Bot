module.exports = class PresenceUpdateHandler {
	constructor(bot) {
		this.bot = bot;
		this.slowmode = 30;
	}

	async handle(other, oldPresence) {
		if (other.user.id == this.bot.config['owo-bot']) {
			if (other.status == 'online' && oldPresence.status != 'online') {
				// Bot is online, revert server to normal mode
				console.log('Bot is back online!');
				await this.setLimit(0, `Bot is back online! Removing slowmode!`);
			} else if (other.status != 'online') {
				// Bot is offline, make server go into slowmode
				console.log('Bot is offline!');
				await this.setLimit(
					this.slowmode,
					`The bot is down right now, it will take some time to come back online! If you have any questions please post it all in one message\n*Setting slowmode to ${this.slowmode} seconds*`
				);
			}
		}
	}

	async setLimit(timer, text) {
		const promises = [];
		for (let i in this.bot.config.channels.chat) {
			let channelID = this.bot.config.channels.chat[i];
			let guildID = this.bot.channelGuildMap[channelID];
			if (!guildID) throw new Error('Invalid channel id in watchlist');
			let guild = this.bot.guilds.get(guildID);
			let channel = guild.channels.get(channelID);

			promises.push(channel.createMessage(text));
			promises.push(
				channel.edit({
					rateLimitPerUser: timer,
				})
			);
		}

		await Promise.all(promises);
	}
};
