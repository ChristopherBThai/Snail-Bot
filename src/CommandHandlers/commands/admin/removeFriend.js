const CommandInterface = require('../../CommandInterface.js');
const {hasHelperPerms} = require('../../../utils/global.js');

module.exports = new CommandInterface({
	alias: ['removefriend', 'removefren', 'unfriend', 'unfren'],

	emoji: '💔',

	auth: hasHelperPerms,

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
