const permaBanThreshold = 99999;

module.exports = class GuildMemberAddHandler {
	constructor(bot) {
		this.bot = bot;
	}

	async handle(guild, member) {
		// Select the user by id only if they are currently banned and their ban is longer than the perma ban threshold
		const sql = `SELECT id FROM timeout WHERE id = ? AND TIMESTAMPDIFF(HOUR, time, NOW()) < penalty AND penalty > ${permaBanThreshold};`;
		const result = await this.bot.owo_db.query(sql, [member.id]);
		
		if (result[0]) {
			let channel;
			let auditLogMessage = "Bot Banned";

			try {
				channel = await this.bot.getDMChannel(member.id);
				await channel.createMessage("You have been banned from OwO permanently. You will not be unbanned.");
			} catch (err) {
				auditLogMessage = "Bot Banned (Unable to DM)";
			}

			console.log(`Banned ${member.username}#${member.discriminator} because they were ` + auditLogMessage);
			await guild.banMember(member.id, 0, auditLogMessage);
		}
	}
};
