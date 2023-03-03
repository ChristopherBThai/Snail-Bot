const permaBanThreshold = 99999;

module.exports = class MessageChannel {
	constructor(bot) {
		this.bot = bot;
	}

	async handle(payload) {
		const { userId, isBanned, hoursBanned } = payload;
		const guild = this.bot.guilds.get(this.bot.config.guild);
		const member = guild.members.get(userId);

		if (!member) return;
		
		// let channel;
		// let auditLogMessage = "Bot banned";

		// try {
		// 	channel = await this.bot.getDMChannel(member.id);
		// 	await channel.createMessage("You have been banned from OwO permanently. You will not be unbanned.");
		// } catch (err) {
		// 	auditLogMessage = "Bot Banned (Unable to DM)";
		// }

		// await guild.banMember(member.id, 0, auditLogMessage);
	}

	async init() {
		const usersBanned = await this.bot.db.User.find({
			hoursBanned: { $gt: 0 },
		});
		console.log(usersBanned);
		// check mongoose and add settimeout
		// Add stuff for lift, messageCreate, memberJoin
	}
};
