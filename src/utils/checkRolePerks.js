const global = require('./global.js');

let bot;

exports.init = (eris) => {
	bot = eris;
	/* Deprecated
	checkRoles();
	// 1 day interval
	setInterval(checkRoles, 86400000);
	*/
}

async function checkRoles () {
	const guild = bot.guilds.get(bot.config.guild);
	const roles = guild.roles;

	let upperPosition = roles.get(bot.config.roles.role_upper).position;
	let lowerPosition = roles.get(bot.config.roles.role_lower).position;

	const roleIds = {};
	roles.forEach(role => {
		if (role.position <= lowerPosition || role.position >= upperPosition) return;
		roleIds[role.id] = { name: role.name };
	});

	await guild.fetchAllMembers(120000);

	for (let member of guild.members.values()) {
		for (let roleId of member.roles.values()) {
			if (roleIds[roleId]) {
				const user = await bot.db.User.findById(member.id);
				if (global.hasRoles(member, bot.config.roles.role_change) || (user && global.hasBenefit(user.roleBenefit))) {
					delete roleIds[roleId]
				}
			}
		};
	};

	console.log(`Deleting ${Object.keys(roleIds).length} roles...`);
	for (let roleId in roleIds) {
		await guild.deleteRole(roleId, "Role perk expired");
	}
	console.log("Done deleting");
}

