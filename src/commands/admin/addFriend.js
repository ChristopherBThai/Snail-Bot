const CommandInterface = require('../CommandInterface.js');

module.exports = new CommandInterface({
	alias: ['addfriend', 'addfren'],

	emoji: '💞',

	group: "admin",

	auth: require('../../utils/permissions.js').hasHelperPerms,

	usage: "snail addfriend {...users}",

	description: "Add users to your ping warning bypass list",

	examples: ["snail addfriend <@729569334153969705> <@210177401064390658>"],

	execute: async function () {
		if (!this.message.mentions.length) {
			this.error(', please mention at least one friend!');
			return;
		}

		let friends = this.message.mentions.map((member) => member.id);

		await this.snail_db.User.updateOne(
			{ _id: this.message.member.id },
			{ $addToSet: { friends } },
			{ upsert: true }
		);

		await this.reply(`, I added ${this.message.mentions.length} users to your friends list!`);
	},
});
