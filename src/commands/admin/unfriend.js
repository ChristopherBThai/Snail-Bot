const CommandInterface = require('../CommandInterface.js');

module.exports = new CommandInterface({
	alias: ['unfriend', 'unfren'],

	emoji: '💔',

	group: "admin",

	auth: require('../../utils/permissions.js').hasHelperPerms,

	usage: "snail unfriend {...users}",

	description: "Remove users from your ping warning bypass list",

	examples: ["snail unfriend <@729569334153969705> <@210177401064390658>"],

	execute: async function () {
		if (!this.message.mentions.length) {
			this.error(', please mention at least one friend!');
			return;
		}

		let friends = this.message.mentions.map((member) => member.id);

		await this.snail_db.User.updateOne(
			{ _id: this.message.member.id },
			{ $pull: { friends: { $in: friends } } },
			{ upsert: true }
		);

		await this.reply(`, I removed ${this.message.mentions.length} users from your friends list!`);
	},
});
