module.exports = class PresenceUpdateHandler {
	constructor(bot) {
		this.bot = bot;
	}

	async handle(guild, invite) {
		await this.bot.log(`📫 **|** ${invite.inviter.mention} created a new invite link \`${invite.code}\``);
	}
};
