const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({

	alias: ["clearroles","clearrole"],

	emoji: '🏷️',

	mods: true,

	execute: async function() {
		await this.msg.channel.guild.fetchAllMembers(120000);
		const roles = {};
		this.msg.channel.guild.roles.forEach(role => {
			roles[role.id] = {
				id: role.id,
				name: role.name,
				position: role.position,
				members: 0
			}
		});
		this.msg.channel.guild.members.forEach(member => {
			member.roles.forEach(roleId => {
				roles[roleId].members++;
			});
		});

		let upperPosition = roles[this.config.roles.role_upper].position;
		let lowerPosition = roles[this.config.roles.role_lower].position;
		
		let unusedRoles = []
		let failedRoles = [];
		for(let i in roles) {
			const role = roles[i];
			if (!role.members && role.position > lowerPosition && role.position < upperPosition) {
				try {
					await this.msg.channel.guild.deleteRole(role.id, "Unused role")
					unusedRoles.push(role.name);
				} catch (err) {
					console.error(err);
					failedRoles.push(role.name);
				}

			}
		}

		await this.reply(`, I deleted ${unusedRoles.length} unused roles!\n\`${unusedRoles.join(", ")}\``);
		if (failedRoles.length) {
			await this.error(`, I failed to delete ${failedRoles.length} roles!\n\`${failedRoles.join(", ")}\``);
		}
	}

});
