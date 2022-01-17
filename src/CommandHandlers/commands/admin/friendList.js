const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({

	alias: ["friends", "friendlist", "listfriends"],

	emoji: ':people_hugging:',

	mods: true,
	helpers: true,

	execute: async function() {

		let user = await this.db.User.findById(this.msg.member.id);
		if (!user || !user.friends || user.friends.size === 0) {
			await this.error("You don’t have any friends yet! Kidnap some with `snail addfriend @user`!");
			return;
		}

		// there's probably a better way to do this, but I'm lazy and didn't want the trailing return and it's 1 AM
		let friendList = '<@';
		friendList += Array.from(user.friends.keys()).join('>\r\n<@');
		friendList += '>';

		let embed = {
			"color": 16698700,
			"timestamp": new Date(),
			"author": {
				"name": `${this.msg.author.username}'s Friends`,
				"icon_url": this.msg.author.avatarURL
			},
			"description" : friendList
		};

		await this.msg.channel.createMessage({embed : embed});
	}

});
