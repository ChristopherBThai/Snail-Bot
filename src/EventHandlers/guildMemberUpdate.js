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
		this.checkPatreonPerk(guild, member, oldMember);
	}

	async checkPatreonPerk(guild, member, oldMember) {
		let animal, daily, changed;

		if (global.hasRole(oldMember, this.bot.config.roles.daily_perk)) {
			if (!global.hasRole(member, this.bot.config.roles.daily_perk)) {
				// Lost perk
				daily = false;
				changed = true;
			}
		} else if (global.hasRole(member, this.bot.config.roles.daily_perk)) {
			// Gain perk
			daily = true;
			changed = true;
		}
		if (global.hasRole(oldMember, this.bot.config.roles.animal_perk)) {
			if (!global.hasRole(member, this.bot.config.roles.animal_perk)) {
				// Lost perk
				animal = false;
				changed = true;
			}
		} else if (global.hasRole(member, this.bot.config.roles.animal_perk)) {
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
		}
	}
};
