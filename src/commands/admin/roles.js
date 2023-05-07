const CommandInterface = require('../CommandInterface.js');

module.exports = new CommandInterface({
	alias: ['roles'],

	emoji: '🏷️',

	group: "admin",

	auth: require('../../utils/permissions.js').hasAdminPerms,

	usage: "snail roles",

	description: "View the amount of users assigned to each role!",

	execute: async function () {
		await this.message.channel.guild.fetchAllMembers(120000);
		const roles = {};
		this.message.channel.guild.roles.forEach((role) => {
			roles[role.id] = {
				name: role.name,
				position: role.position,
				color: role.color,
				members: 0,
			};
		});
		this.message.channel.guild.members.forEach((member) => {
			member.roles.forEach((roleId) => {
				roles[roleId].members++;
			});
		});

		const roleArray = Object.values(roles).sort(
			(a, b) => b.position - a.position
		);
		let replyText = '';
		roleArray.forEach((role) => {
			let roleText = `${role.name.padEnd(25, ' ')} (${role.members})\n`;
			if (replyText.length + roleText.length > 1900) {
				this.message.channel.createMessage('```\n' + replyText + '```');
				replyText = roleText;
			} else {
				replyText += roleText;
			}
		});
		this.message.channel.createMessage('```\n' + replyText + '```');
	},
});
