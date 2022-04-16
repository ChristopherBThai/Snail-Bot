exports.checkUser = async function (userId) {
	const sql = `SELECT id FROM timeout WHERE id = ? AND TIMESTAMPDIFF(HOUR, time, NOW()) < penalty;`;
	const result = await this.bot.owo_db.query(sql, [userId]);
	console.log(result);
	if (result[0]) {
		await guild.addMemberRole(member.id, this.bot.config.roles.banned, member.id + " was banned");
	} else {
		await guild.removeMemberRole(member.id, this.bot.config.roles.banned, member.id + " was unbanned");
	}
}
