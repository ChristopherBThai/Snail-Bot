module.exports = class PresenceUpdateHandler {
	constructor (bot) {
		this.bot = bot;
	}

	async handle (guild, invite) {
		await this.bot.createMessage(this.bot.config.channels.log, `📫 **|** ${invite.inviter.mention} created a new invite link \`https://discord.gg/${invite.code}\``);
	}

}
