const CommandInterface = require('../../CommandInterface.js');
const {hasHelperPerms} = require('../../../utils/global.js');

module.exports = new CommandInterface({
	alias: ['addfriend', 'addfren'],

	emoji: '💞',

	group: "admin",

	auth: hasHelperPerms,

	usage: "snail addfriend {...users}",

    description: "Add users to your ping warning bypass list",

    examples: ["snail addfriend <@729569334153969705> <@210177401064390658>"],

	execute: async function () {
		if (!this.msg.mentions.length) {
			this.error(', please mention at least one friend!');
			return;
		}

		let friends = this.msg.mentions.map((member) => member.id);

		await this.db.User.updateOne(
			{ _id: this.msg.member.id },
			{ $addToSet: {friends} },
			{ upsert: true }
		);

		await this.reply(`, I added ${this.msg.mentions.length} users to your friends list!`);
	},
});
