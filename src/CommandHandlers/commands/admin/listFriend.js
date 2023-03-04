const CommandInterface = require('../../CommandInterface.js');

module.exports = new CommandInterface({
	alias: ['listfriend', 'listfren', 'friendlist', 'frenlist'],

	emoji: '❤',

	mods: true,
	helpers: true,

	execute: async function () {
		const user = await this.bot.db.User.findById(this.msg.author.id);

		let friendList = user?.friends?.map((id) => `<@${id}>`).join(`\n`);

		if (!friendList) {
			this.error(`You don’t have any friends yet! Kidnap some with \`snail addfriend @user\`!`);
			return;
		}

		let embed = {
			timestamp: new Date(),
			author: {
				name: `${this.msg.author.username}'s Friends`,
				icon_url: this.msg.author.avatarURL
			},
			description: friendList
		};

		await this.msg.channel.createMessage({ embed });
	},
});
