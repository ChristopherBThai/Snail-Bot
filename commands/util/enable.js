const Command = require('../Command');
const { hasManagerPerms, parseChannelID } = require('../../util');

module.exports = new Command({
    aliases: ['enable', 'disable', 'enabled'],
    group: 'Util',
    auth: hasManagerPerms,
    usage: '[enable|disable|enabled] {...commands} {...channels}',
    description: 'Toggle commands in a set of channels. You can list multiple commands and channels at once!',
    examples: [
        '[enable|disable] tag ping <#420107107203940362> 696528295084425336',
        'enable tag',
        'enabled',
    ],
    execute: async function (ctx) {
        // Split args into channels and commands
        let channels = [];
        let commands = [];
        for (const arg of ctx.args) {
            const channelID = parseChannelID(arg);
            if (channelID) channels.push(channelID);
            else commands.push(arg);
        }

        if (!channels.length) channels = [ctx.message.channel.id];

        if (ctx.name == 'enabled') {
            return await displayEnabledCommands(ctx, channels);
        }

        await toggleCommands(ctx, channels, commands, this.aliases);
    },
});

function getAllCommandNames(ctx) {
    return [...new Set(Object.values(ctx.bot.commandHandler.commands).map(command => command.name))];
}

async function toggleCommands(ctx, channels, commands, aliases) {
    // Remove non-command args and normalize casing
    commands = commands
        .map(command => command.toLowerCase())
        .filter(command => ctx.bot.commandHandler.commands[command] || command == 'all');

    // Replace potential aliases with command names
    commands = commands.includes('all')
        ? getAllCommandNames(ctx)
        : commands.map(command => ctx.bot.commandHandler.commands[command].name);

    // Remove duplicate commands and prevent disabling this command
    commands = [...new Set(commands)].filter(command => !aliases.includes(command));

    if (!commands.length) return await ctx.error('please list at least one valid command!');

    if (ctx.name == 'enable') {
        await ctx.bot.commandHandler.enableCommands(channels, commands);
    } else {
        await ctx.bot.commandHandler.disableCommands(channels, commands);
    }

    await ctx.send(`I ${ctx.name}d ${commands.map(command => `\`${command}\``).join(', ')} in ${channels.map(id => `<#${id}>`).join(', ')}!`);
}

async function displayEnabledCommands(ctx, channels) {
    const commands = getAllCommandNames(ctx).sort();
    const disabledCommandsByChannel = await ctx.bot.commandHandler.getDisabledCommands(channels);
    const fields = [];

    for (const channelID of channels) {
        const disabledCommands = disabledCommandsByChannel[channelID];
        const commandList = commands.map(command => disabledCommands.has(command) ? `~~\`${command}\`~~` : `\`${command}\``);

        fields.push({
            name: `<#${channelID}>`,
            value: commandList.join(', ')
        });
    }

    await ctx.send({
        embeds: [{
            author: { name: 'Enabled Commands' },
            timestamp: new Date(),
            color: ctx.bot.config.colors.embed,
            fields
        }]
    });
}
