const CommandInterface = require('../CommandInterface.js');

module.exports = new CommandInterface({
    alias: ['disable'],

    emoji: '❌',

    group: "admin",

    auth: require('../../utils/permissions.js').hasAdminPerms,

    usage: "snail disable {...commands} {...channels}",

    description: "Disable command(s) in a set of channels or the current channel. You can list multiple commands to disable multiple at once.",

    examples: ["snail disable tag ping <#420107107203940362> <#696528295084425336>", "snail disable tag"],

    execute: async function () {
        const args = this.message.args.map(cmd => cmd.toLowerCase());
        const channels = this.message.channelMentions.length == 0 ? [this.message.channel.id] : this.message.channelMentions;
        let disabledCommands = args
            .filter(arg => (!/<#\d+>/.test(arg)))                   // Filter out channel mentions 
            .filter(arg => this.bot.commands[arg] || arg == "all")  // Filter out command names that don't exist unless it's the "all" argument

        if (disabledCommands.includes("all")) {
            disabledCommands = Object.values(this.bot.commands).map(command => command.alias[0]);
        } else {
            disabledCommands = disabledCommands.map(command => this.bot.commands[command].alias[0]);
        }

        disabledCommands = disabledCommands.filter(arg => arg != "disable" && arg != "enable" && arg != "enabled");    // Filter out "disable", "enable", and "enabled"

        if (disabledCommands.length == 0) {
            this.error(", please list at least one valid command");
            return;
        }

        for (const channel of channels) {
            await this.snail_db.Channel.updateOne(
                { _id: channel },
                { $addToSet: { disabledCommands } },
                { upsert: true }
            );
        }

        await this.reply(`, I disabled ${disabledCommands.map(command => `\`${command}\``).join(", ")} in ${channels.map(channel => `<#${channel}>`).join(", ")}`);
    },
});
