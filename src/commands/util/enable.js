const Command = require('../Command.js');

module.exports = new Command({
    alias: ['enable', 'disable', 'enabled'],

    group: "Util",

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: "snail [enable|disable|enabled] {...commands} {...channels}",

    description: "Toggle command in a set of channels. You can list multiple commands and channels at once!",

    examples: ["snail [enable|disable] tag ping <#420107107203940362> <#696528295084425336>", "snail enable tag", "snail enabled"],

    execute: async function () {
        const channels = this.message.channelMentions.length == 0 ? [this.message.channel.id] : this.message.channelMentions;

        switch (this.message.command) {
            case "enable":
            case "disable": {
                let cmds = this.message.args.filter(cmd => (!/<#\d+>/.test(cmd)))   // Filter out channel mentions
                    .map(cmd => cmd.toLowerCase())                                  // Make all lowercase 
                    .filter(cmd => this.commands[cmd] || cmd == "all")              // Filter out command names that don't exist unless it's the "all" argument

                if (cmds.includes("all")) {
                    cmds = [...new Set(Object.values(this.commands).map(cmd => cmd.alias[0]))];
                } else {
                    cmds = cmds.map(cmd => this.commands[cmd].alias[0]);
                }

                cmds = cmds.filter(cmd => !this.command.alias.includes(cmd))    // Filter out this command and its aliases

                if (cmds.length == 0) {
                    await this.error("please list at least one valid command!");
                    return;
                }

                const operation = this.message.command == "enable" ? { $pull: { disabledCommands: { $in: cmds } } } : { $addToSet: { disabledCommands: cmds } };

                for (const channel of channels) {
                    await this.snail_db.Channel.updateOne({ _id: channel }, operation, { upsert: true });
                }

                await this.send(`I ${this.message.command}d ${cmds.map(cmd => `\`${cmd}\``).join(", ")} in ${channels.map(id => `<#${id}>`).join(", ")}!`);

                break;
            }
            case "enabled": {
                const commands = [...new Set(Object.values(this.commands).map(cmd => cmd.alias[0]))].sort();
                const fields = [];

                for (const channelID of channels) {
                    const channel = await this.snail_db.Channel.findById(channelID);

                    const commandList = commands.map(cmd => {
                        if (channel.disabledCommands.includes(cmd)) return `~~\`${cmd}\`~~`;
                        else return `\`${cmd}\``;
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
                    color: this.config.embedcolor,
                    fields
                };

                await this.send({ embed });
                break;
            }
        }
    },
});
