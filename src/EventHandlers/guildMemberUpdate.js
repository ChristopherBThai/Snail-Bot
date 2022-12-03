const global = require('../utils/global.js');
const got = require('got');
const roleEmoji = '🏷️';
const patreonFailEmoji = '😥';
const blankEmoji = '<:blank:735753896026308669>';

module.exports = class GuildMemberUpdateHandler {
	constructor(bot) {
		this.bot = bot;
		this.db = bot.db;
	}

	async handle(guild, member, oldMember) {
		// Deprecated
		// this.checkRolePerk(guild, member, oldMember);
		this.checkPatreonPerk(guild, member, oldMember);
	}

	async checkPatreonPerk(guild, member, oldMember) {
		let animal, daily, changed;

		if (global.hasRoles(oldMember, this.bot.config.roles.daily_perk)) {
			if (!global.hasRoles(member, this.bot.config.roles.daily_perk)) {
				// Lost perk
				daily = false;
				changed = true;
			}
		} else if (global.hasRoles(member, this.bot.config.roles.daily_perk)) {
			// Gain perk
			daily = true;
			changed = true;
		}
		if (global.hasRoles(oldMember, this.bot.config.roles.animal_perk)) {
			if (!global.hasRoles(member, this.bot.config.roles.animal_perk)) {
				// Lost perk
				animal = false;
				changed = true;
			}
		} else if (global.hasRoles(member, this.bot.config.roles.animal_perk)) {
			// Gain perk
			animal = true;
			changed = true;
		}

		if (!changed) return;

		const query = { password: process.env.OWO_TOKEN, user: member.id };
		if (typeof animal == 'boolean') query.animal = animal;
		if (typeof daily == 'boolean') query.daily = daily;

		try {
			await got.post(`${process.env.OWO_URI}/patreon-perks`, {
				json: query,
				responseType: 'json',
			});
		} catch (err) {
			console.error(err);
			// await this.msgUser(member.id, `${patreonFailEmoji} **|** It seems like we failed to add your patreon perks! Please try using the command \`owo patreon\` in a few days.`);
		}
	}

	async checkRolePerk(guild, member, oldMember) {
		if (global.hasRoles(oldMember, this.bot.config.roles.role_change)) {
			if (!global.hasRoles(member, this.bot.config.roles.role_change)) {
				const user = await this.db.User.findById(member.id);
				if (
					user &&
					user.role &&
					user.role.active &&
					!global.hasBenefit(user.roleBenefit)
				) {
					// lost role perks
					try {
						await guild.deleteRole(user.role._id);
					} catch (err) {
						console.error(err);
					}
					await this.db.User.updateOne(
						{ _id: member.id },
						{ $set: { 'role.active': false } }
					);
					await this.msgUser(
						member.id,
						`${roleEmoji} **|** Your role perks for **OwO Bot Support** has expired! Thanks for supporting the server!`
					);
					console.log(`Role Perks expired for ${member.username}`);
				}
			}
		} else if (global.hasRoles(member, this.bot.config.roles.role_change)) {
			// gained perks
			const user = await this.db.User.findById(member.id);
			if (!user || !global.hasBenefit(user.roleBenefit)) {
				if (user && user.role) {
					// Already has existing role, add that
					let userRole = guild.roles.get(user.role._id);
					if (userRole) {
						await userRole.edit(
							{ name: user.role.name, color: user.role.color },
							member.id + ' regained their role perk'
						);
					} else {
						userRole = await guild.createRole(
							{
								name: user.role.name,
								color: user.role.color,
							},
							member.id + ' regained their role perk'
						);
					}
					let upperPosition = guild.roles.get(
						this.bot.config.roles.role_upper
					).position;
					await userRole.editPosition(upperPosition - 1);
					await guild.addMemberRole(
						member.id,
						userRole.id,
						member.id + ' edited their role'
					);

					await this.db.User.updateOne(
						{ _id: member.id },
						{
							role: {
								_id: userRole.id,
								name: userRole.name,
								color: userRole.color,
								active: true,
							},
						}
					);
					await this.msgUser(
						member.id,
						`${roleEmoji} **|** Thanks for supporting the server! You now have the ability to change roles on **OwO Bot Support**!\n${blankEmoji} **|** You regained your role named: **${userRole.name}**\n${blankEmoji} **|** You can change your role by using the command \`snail changerole {hexcode} {roleName}\``
					);
					console.log(`Readding Role Perks for ${member.username}`);
				} else {
					// No role, notify user
					await this.msgUser(
						member.id,
						`${roleEmoji} **|** Thanks for supporting the server! You now have the ability to change roles on **OwO Bot Support**!\n${blankEmoji} **|** You can do so by using the command \`snail changerole {hexcode} {roleName}\``
					);
					console.log(`First time Role Perks for ${member.username}`);
				}
			}
		}
	}

	async msgUser(userId, text) {
		const userDm = await this.bot.getDMChannel(userId);
		return userDm.createMessage(text);
	}
};
