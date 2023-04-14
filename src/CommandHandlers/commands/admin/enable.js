const CommandInterface = require('../../CommandInterface.js');
const {hasAdminPerms} = require('../../../utils/global.js');

module.exports = new CommandInterface({
	alias: ['enable'],

	emoji: '✔',

    group: "admin",
	
    auth: hasAdminPerms,

	usage: "snail enable {...commands} {...channels}",

    description: "Enable command(s) in a set of channels or the current channel. You can list multiple commands to enable multiple at once.",

    examples: ["snail enable tag ping <#420107107203940362> <#696528295084425336>", "snail enable tag"],

	execute: async function () {
        const args = this.msg.args.map(cmd => cmd.toLowerCase());
        const channels = this.msg.channelMentions.length == 0 ? [this.msg.channel.id] : this.msg.channelMentions;
        let enabledCommands = args
            .filter(arg => (!/<#\d+>/.test(arg)))                                       // Filter out channel mentions 
            .filter(arg => this.commands[arg] || arg == "all")                          // Filter out command names that don't exist unless it's the "all" argument

        if (enabledCommands.includes("all")) {
            enabledCommands = Object.values(this.commands).map(command => command.alias[0]);
        } else {
            enabledCommands = enabledCommands.map(command => this.commands[command].alias[0]);
        }

        enabledCommands = enabledCommands.filter(arg => arg != "disable" && arg != "enable" && arg != "enabled");    // Filter out "disable", "enable", and "enabled"

        if (enabledCommands.length == 0) {
            this.error(", please list at least one valid command");
            return;
        }

        for (const channel of channels) {
            await this.db.Channel.updateOne(
                { _id: channel },
                { $pull: {disabledCommands: { $in: enabledCommands }} },
                { upsert: true }
            );
        }

		await this.reply(`, I enabled ${enabledCommands.map(command => `\`${command}\``).join(", ")} in ${channels.map(channel => `<#${channel}>`).join(", ")}`);
	},
});
