const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({

	alias: ["changerole", "cr", "role"],

	emoji: '🏷️',

	execute: async function() {
		const user = await this.db.User.findById(this.msg.author.id);

		// Check if they have perms to change roles
		if (!(this.global.hasRoles(this.msg.member, this.config.roles.role_change)
				|| (user && this.global.hasBenefit(user.roleBenefit)))) {
			if (user && user.role && user.role.active) {
				try {
					await this.msg.channel.guild.deleteRole(user.role._id);
				} catch (err) {console.error(err)}
				await this.db.User.updateOne(
					{ _id: this.msg.author.id },
					{ $set: { 'role.active': false } }
				);
			}
			await this.error(", you don't have Patreon perks to change your roles!");
			console.log(`Failed to change role for ${this.msg.author.username}`);
			return;
		}

		// arg parsing/validation
		if (this.msg.args.length < 2) {
			await this.error(", the correct command arguments are `changerole {hexcode} {role name}`");
			return;
		}
		let hexcode = this.msg.args[0].toLowerCase().replace(/#/gi, '');
		let roleName = this.msg.args.splice(1).join(' ');
		roleName = this.global.removeBadWords(roleName);
		if (hexcode.length !== 6) {
			await this.error(", Invalid hexcode! It should look something like this: `#ABCDEF`");
			return;
		}
		hexcode = parseInt(hexcode, 16);
		if (!hexcode) {
			await this.error(", Invalid hexcode! It should look something like this: `#ABCDEF`");
			return;
		}
		if (roleName.length > 100) {
			await this.error(", The role name is too long! Must be under 100 characters.");
			return;
		}

		let userRole;
		try {
			// Assign roles
			if (user && user.role && user.role._id) {
				userRole = await updateRole.bind(this)(user.role._id, hexcode, roleName);
			} else {
				userRole = await addRole.bind(this)(hexcode, roleName);
			}
		} catch (err) {
			console.error(err);
			await this.error(", failed to edit roles, please contact a mod");
			return;
		}

		await this.reply(`, you changed your role to <@&${userRole.id}>!`);
		await this.log(`${this.msg.author.mention} changed their role to **${userRole.name}** #${userRole.color.toString(16).padStart(6, '0')}`);
		console.log(`Changed role for ${this.msg.author.username}`);

	}

});

// Updates existing role for that user
async function updateRole (id, hexcode, roleName) {
	// Get existing role
	const existingRole = this.msg.channel.guild.roles.get(id);
	if (!existingRole) {
		return await addRole.bind(this)(hexcode, roleName);
	}

	// Edit changes
	await existingRole.edit({ name: roleName, color: hexcode }, this.msg.author.id + " edited their role");

	// Add role to member
	await this.msg.channel.guild.addMemberRole(this.msg.member.id, id, this.msg.author.id + " edited their role");

	// Save to db
	await this.db.User.updateOne(
		{ _id: this.msg.author.id },
		{
			role: {
				_id: id,
				color: hexcode,
				name: roleName
			}
		},
		{ upsert: true }
	);

	return existingRole;
}

// Adds role for the user
async function addRole (hexcode, roleName) {
	// Create role
	const newRole = await this.msg.channel.guild.createRole({
		name: roleName,
		color: hexcode
	}, this.msg.author.id + " edited their role");

	// Change position
	let upperPosition = this.msg.channel.guild.roles.get(this.config.roles.role_upper).position;
	await newRole.editPosition(upperPosition - 1);

	// Add role to member
	await this.msg.channel.guild.addMemberRole(this.msg.member.id, newRole.id, this.msg.author.id + " edited their role");

	await this.db.User.updateOne(
		{ _id: this.msg.author.id },
		{
			role: {
				_id: newRole.id,
				color: hexcode,
				name: roleName
			}
		},
		{ upsert: true }
	);

	return newRole;
}
