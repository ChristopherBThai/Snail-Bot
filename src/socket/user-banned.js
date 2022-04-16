const bannedRole = require('../utils/bannedRole.js');
module.exports = class MessageChannel {
	constructor (bot) {
		this.bot = bot;
	}

	async handle (payload) {
		const { userId, isBanned, hoursBanned } = payload;
		const guild = this.bot.guilds.get(this.bot.config.guild);
		const member = guild.members.get(userId);

		if (!member) return;

		/*
		*/
		if (isBanned) {
			await guild.addMemberRole(member.id, this.bot.config.roles.banned, member.id + " was banned");
			// TODO add to mongoose
		} else {
			await guild.removeMemberRole(member.id, this.bot.config.roles.banned, member.id + " was unbanned");
			// TODO add to mongoose
		}
	}

	async init () {
		const usersBanned = await this.bot.db.User.find({ hoursBanned: { $gt: 0 }});
		console.log(usersBanned);
		// check mongoose and add settimeout
		// Add stuff for lift, messageCreate, memberJoin
	}
}
