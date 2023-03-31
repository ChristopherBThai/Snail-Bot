const CommandInterface = require('../../CommandInterface.js');
const {hasAdminPerms} = require('../../../utils/global.js');

module.exports = new CommandInterface({
	alias: ['enabled'],

	emoji: '📃',

	auth: hasAdminPerms,

	usage: "snail enabled {...channels}",

    description: "Get a list of the command(s) enabled in a set of channels or the current channel.",

    examples: ["snail enabled <#420107107203940362> <#696528295084425336>", "snail enabled"],

	execute: async function () {
        const channels = this.msg.channelMentions.length == 0 ? [this.msg.channel.id] : this.msg.channelMentions;
        const allCommands = [...new Set(Object.values(this.commands).map(command => command.alias[0]))].sort();
        const fields = [];

        for (const channelID of channels) {
            const channel = await this.bot.db.Channel.findById(channelID);

            const commandList = allCommands.map(command => {
                if (channel.disabledCommands.includes(command)) return `~~\`${command}\`~~`;
                else return `\`${command}\``;
            });

            fields.push({
                name: `<#${channelID}>`,
                value: `${commandList.join(", ")}`
            });
        }

        let embed = {
			author: {
				name: `Enabled Commands`,
			},
			timestamp: new Date(),
			color: 0xf1c40f,
            fields
		};

		await this.msg.channel.createMessage({ embed });
	},
});
