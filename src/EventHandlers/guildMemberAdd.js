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
			await guild.banMember(member.id, 0, 'Bot banned');
		}
	}
};
