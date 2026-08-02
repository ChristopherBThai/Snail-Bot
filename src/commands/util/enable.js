const Command = require('../Command.js');
const { parseChannelID } = require('../../utils/global.js');
const { ChannelTypes } = require('eris').Constants;

module.exports = new Command({
    alias: ['enable', 'disable', 'enabled'],

    group: 'Util',

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: 'snail [enable|disable|enabled] {...commands} {...channels}',

    description: 'Toggle command in a set of channels. You can list multiple commands and channels at once!',

    examples: [
        'snail [enable|disable] tag ping <#420107107203940362> 696528295084425336',
        'snail enable tag',
        'snail enabled',
    ],

    execute: async function () {
        let channels = this.message.args.map((channel) => parseChannelID(channel)).filter((channel) => channel);
        if (channels.length == 0) channels = [this.message.channel.id];

        switch (this.message.command) {
            case 'enable':
            case 'disable': {
                const precedingArgs = this.message.args.slice(0, -1);
                const disableAllChannels =
                    this.message.command == 'disable' &&
                    this.message.args[this.message.args.length - 1]?.toLowerCase() == 'all' &&
                    precedingArgs.length > 0 &&
                    precedingArgs.every((cmd) => !parseChannelID(cmd) && this.commands[cmd.toLowerCase()]);
                let cmds = this.message.args
                    .filter((cmd) => !parseChannelID(cmd)) // Filter out channels
                    .map((cmd) => cmd.toLowerCase()) // Make all lowercase
                    .filter((cmd) => this.commands[cmd] || cmd == 'all'); // Filter out command names that don't exist unless it's the "all" argument

                if (disableAllChannels && cmds.length > 1) {
                    channels = this.bot.guilds
                        .get(this.message.guildID)
                        .channels.filter((channel) => channel.type != ChannelTypes.GUILD_CATEGORY)
                        .map((channel) => channel.id);
                    cmds.pop();
                }

                if (cmds.includes('all')) {
                    cmds = [...new Set(Object.values(this.commands).map((cmd) => cmd.alias[0]))];
                } else {
                    cmds = cmds.map((cmd) => this.commands[cmd].alias[0]);
                }

                cmds = cmds.filter((cmd) => !this.command.alias.includes(cmd)); // Filter out this command and its aliases

                if (cmds.length == 0) {
                    await this.error('please list at least one valid command!');
                    return;
                }

                const operation =
                    this.message.command == 'enable'
                        ? { $pull: { disabledCommands: { $in: cmds } } }
                        : { $addToSet: { disabledCommands: cmds } };

                for (const channel of channels) {
                    await this.snail_db.Channel.updateOne({ _id: channel }, operation, { upsert: true });
                }

                if (disableAllChannels) {
                    await this.send(
                        `I ${this.message.command}d ${cmds.map((cmd) => `\`${cmd}\``).join(', ')} in ${
                            channels.length
                        } eligible channels!`
                    );
                } else {
                    await this.send(
                        `I ${this.message.command}d ${cmds.map((cmd) => `\`${cmd}\``).join(', ')} in ${channels
                            .map((id) => `<#${id}>`)
                            .join(', ')}!`
                    );
                }

                break;
            }
            case 'enabled': {
                const commands = [...new Set(Object.values(this.commands).map((cmd) => cmd.alias[0]))].sort();
                const fields = [];

                for (const channelID of channels) {
                    const channel = await this.snail_db.Channel.findById(channelID);

                    const commandList = commands.map((cmd) => {
                        if (channel?.disabledCommands.includes(cmd)) return `~~\`${cmd}\`~~`;
                        else return `\`${cmd}\``;
                    });

                    fields.push({
                        name: `<#${channelID}>`,
                        value: `${commandList.join(', ')}`,
                    });
                }

                let embed = {
                    author: {
                        name: `Enabled Commands`,
                    },
                    timestamp: new Date(),
                    color: this.config.embedcolor,
                    fields,
                };

                await this.send({ embed });
                break;
            }
        }
    },
});
