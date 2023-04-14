const CommandInterface = require('../../CommandInterface.js');
const {hasHelperPerms} = require('../../../utils/global.js');

module.exports = new CommandInterface({
	alias: ['unfriend', 'unfren'],

	emoji: '💔',

	group: "admin",
	
    auth: hasHelperPerms,

	usage: "snail unfriend {...users}",

    description: "Remove users from your ping warning bypass list",

    examples: ["snail unfriend <@729569334153969705> <@210177401064390658>"],

	execute: async function () {
		if (!this.msg.mentions.length) {
			this.error(', please mention at least one friend!');
			return;
		}

		let friends = this.msg.mentions.map((member) => member.id);

		await this.db.User.updateOne(
			{ _id: this.msg.member.id },
			{ $pull: { friends: { $in: friends } } },
			{ upsert: true }
		);

		await this.reply(`, I removed ${this.msg.mentions.length} users from your friends list!`);
	},
});
