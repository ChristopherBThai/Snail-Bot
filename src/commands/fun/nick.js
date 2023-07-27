const Command = require('../Command.js');

module.exports = new Command({
	alias: ['nick'],

	group: "Fun",

    auth: require('../../utils/permissions.js').hasManagerPerms,

	usage: "snail nick {reset|nick}",

	description: "Set Snail's nickname!",

	execute: async function () {
        const nick = this.message.args.join(" ");
        if (!nick) {
            await this.error("please provide a nickname!");
            return;
        }

        if (nick.length > 32 || nick.length < 1) {
            await this.error("the name must be between 1 and 32 characters long (inclusive)!");
            return;
        }

        await this.bot.editGuildMember(this.config.guild, "@me", {
           nick: nick.toLowerCase() == "reset" ? "" : nick
        });

        if (nick.toLowerCase() == "reset") await this.send("I have reset my nickname!");
        else await this.send(`I have set my nickname to \`${nick}\`!`);
	},
});
