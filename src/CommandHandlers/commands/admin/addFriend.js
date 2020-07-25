const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({

	alias: ["addfriend", "addfren"],

	emoji: '💞',

	mods: true,
	helpers: true,

	execute: async function() {
		if (!this.msg.mentions.length) {
			this.error(", please mention at least one friend!");
			return;
		}

		let friends = {};
		this.msg.mentions.forEach((member) => {
			friends[`friends.${member.id}`] = member.id;
		});

		await this.db.User.updateOne(
			{ _id: this.msg.member.id },
			{ $set: friends },
			{ upsert: true }
		);
		
		await this.reply(`, I added ${this.msg.mentions.length} to your friends list!`);
	}

});
