const Command = require('../Command.js');
const { parseChannelID } = require('../../utils/global.js');

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

    execute: async function (ctx) {
        let channels = ctx.args.map((channel) => parseChannelID(channel)).filter((channel) => channel);
        if (channels.length == 0) channels = [ctx.channel.id];

        switch (ctx.command) {
            case 'enable':
            case 'disable': {
                let cmds = ctx.args
                    .filter((cmd) => !parseChannelID(cmd)) // Filter out channels
                    .map((cmd) => cmd.toLowerCase()) // Make all lowercase
                    .filter((cmd) => ctx.commands[cmd] || cmd == 'all'); // Filter out command names that don't exist unless it's the "all" argument

                if (cmds.includes('all')) {
                    cmds = [...new Set(Object.values(ctx.commands).map((cmd) => cmd.alias[0]))];
                } else {
                    cmds = cmds.map((cmd) => ctx.commands[cmd].alias[0]);
                }

                cmds = cmds.filter((cmd) => !this.alias.includes(cmd)); // Filter out this command and its aliases

                if (cmds.length == 0) {
                    await ctx.error('please list at least one valid command!');
                    return;
                }

                const operation =
                    ctx.command == 'enable'
                        ? { $pull: { disabledCommands: { $in: cmds } } }
                        : { $addToSet: { disabledCommands: cmds } };

                for (const channel of channels) {
                    await ctx.snail_db.Channel.updateOne({ _id: channel }, operation, { upsert: true });
                }

                await ctx.send(
                    `I ${ctx.command}d ${cmds.map((cmd) => `\`${cmd}\``).join(', ')} in ${channels
                        .map((id) => `<#${id}>`)
                        .join(', ')}!`
                );

                break;
            }
            case 'enabled': {
                const commands = [...new Set(Object.values(ctx.commands).map((cmd) => cmd.alias[0]))].sort();
                const fields = [];

                for (const channelID of channels) {
                    const channel = await ctx.snail_db.Channel.findById(channelID);

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
                    color: ctx.config.embedcolor,
                    fields,
                };

                await ctx.send({ embed });
                break;
            }
        }
    },
});
