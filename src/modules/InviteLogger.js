module.exports = class InviteLogger {
	constructor(bot) {
		this.bot = bot;
		this.events = {
			"inviteCreate": this.log
		}
	}

	async log(guild, invite) {
		if (this.bot.config.debug) return;
		await this.bot.log(`📫 **|** ${invite.inviter.mention} created a new invite link \`${invite.code}\``);
	}
};
