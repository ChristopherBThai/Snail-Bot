const Command = require('../Command.js');
const { parseChannelID } = require('../../utils/global.js');

module.exports = new Command({
    alias: ['echo'],

    group: 'Staff',

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: 'snail echo {channel} {message|json}',

    description:
        'Echo a message into a channel! You can even echo a message with an embed by copying the json data for a message from this [website](https://glitchii.github.io/embedbuilder/)!',

    examples: [
        'snail echo <#420107107203940362> All hail our ruler lord snail!! 🐌',
        'snail echo <#420111691507040266> OwO is currently offline, thank you for your patience as we resolve the issue!',
    ],

    execute: async function (ctx) {
        const channelID = parseChannelID(ctx.args[0]);

        if (!channelID) {
            await ctx.error('please provide a channel mention or ID! The proper usage is `snail echo {channel} {message}`');
            return;
        }

        const channel = ctx.bot.getChannel(channelID);
        if (!channel) {
            await ctx.error(`I do not have access to <#${channelID}>! :c`);
            return;
        }

        const message = ctx.args.splice(1).join(' ');

        if (!message) {
            await ctx.error('please provide a message!');
            return;
        }

        let embed;

        try {
            embed = JSON.parse(message);
        } catch (error) { }

        if (!embed) {
            await ctx.bot.createMessage(channelID, message);
        } else {
            try {
                if (embed.embed || embed.embeds) await ctx.bot.createMessage(channelID, embed);
                else await ctx.bot.createMessage(channelID, { embed });
            } catch (error) {
                await ctx.error('please provide data in atleast one of the embed following embed fields! `Description` `Thumbnail Url` `Title` `Author Name`');
                return;
            }
        }

        await ctx.send(`I have echoed your message in <#${channelID}>!`);
    },
});
