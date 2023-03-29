const permaBanThreshold = 99999;

module.exports = class MessageChannel {
	constructor(bot) {
		this.bot = bot;
	}

	// Not Connected to OwO. Will be very useful once it is though! 
	async handle(payload) {
		// const { userId, isBanned, hoursBanned } = payload;
		// const guild = this.bot.guilds.get(this.bot.config.guild);
		// const member = guild.members.get(userId);

		// if (!member) return;
		
		// if (hoursBanned > permaBanThreshold) {
		// 	let channel;
		// 	let auditLogMessage = "Bot Banned";

		// 	try {
		// 		channel = await this.bot.getDMChannel(member.id);
		// 		await channel.createMessage("You have been banned from OwO permanently. You will not be unbanned.");
		// 	} catch (err) {
		// 		auditLogMessage = "Bot Banned (Unable to DM)";
		// 	}

		// 	await guild.banMember(member.id, 0, auditLogMessage);
		// }
	}
};
