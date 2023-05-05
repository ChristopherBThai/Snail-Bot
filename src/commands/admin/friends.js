const CommandInterface = require('../CommandInterface.js');

module.exports = new CommandInterface({
	alias: ['friends', 'frens'],

	emoji: '❤',

	group: "admin",

	auth: require('../../utils/permissions.js').hasHelperPerms,

	usage: "snail friends",

	description: "View the users on your ping warning bypass list",

	execute: async function () {
		const user = await this.bot.snail_db.User.findById(this.message.author.id);

		let friendList = user?.friends?.map((id) => `<@${id}>`).join(` `);

		if (!friendList) {
			this.error(`, you don’t have any friends yet! Kidnap some with \`snail addfriend @user\`!`);
			return;
		}

		let embed = {
			author: {
				name: `${this.message.author.username}'s Friends`,
				icon_url: this.message.author.avatarURL
			},
			description: friendList,
			timestamp: new Date(),
			color: 0xf1c40f
		};

		await this.message.channel.createMessage({ embed });
	},
});
