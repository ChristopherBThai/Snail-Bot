const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({

	alias: ["removefriend", "removefren"],

	emoji: '💔',

	mods: true,
	helpers: true,

	execute: async function() {
		if (!this.msg.mentions.length) {
			this.error(", please mention at least one friend!");
			return;
		}

		let exfriends = {};
		this.msg.mentions.forEach((member) => {
			exfriends[`friends.${member.id}`] = member.id;
		});

		await this.db.User.updateOne(
			{ _id: this.msg.member.id },
			{ $unset: exfriends },
			{ upsert: true }
		);
		
		await this.reply(`, I removed ${this.msg.mentions.length} from your friends list!`);
	}

});
