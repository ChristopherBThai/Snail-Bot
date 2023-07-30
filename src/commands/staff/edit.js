const Command = require('../Command.js');
const { parseMessageLink } = require('../../utils/global.js');

module.exports = new Command({
    alias: ['edit'],

    group: 'Staff',

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: 'snail edit {message link} {message|json}',

    description:
        'Edit **any** message snail has sent! You can even edit a message to have an embed by copying the json data for a message from this [website](https://glitchii.github.io/embedbuilder/)!',

    examples: [
        'snail edit https://discord.com/channels/420104212895105044/542629170157715456/1131855197656854559 All hail our ruler lord snail!! 🐌',
    ],

    execute: async function (ctx) {
        const messageLink = parseMessageLink(ctx.args[0]);
        const message = ctx.args.splice(1).join(' ');

        if (!messageLink) {
            await ctx.error(
                'please provide a valid message link! The proper usage is `snail echo {message link} {message}`'
            );
            return;
        }

        const channel = ctx.bot.getChannel(messageLink.channel);
        if (!channel) {
            await ctx.error(`I do not have access to <#${messageLink.channel}>! Did you copy the wrong message link?`);
            return;
        }

        if (!message) {
            await ctx.error('please provide a message!');
            return;
        }

        let messageObj;

        try {
            messageObj = await ctx.bot.getMessage(messageLink.channel, messageLink.message);
        } catch {
            await ctx.error('I could not find or do not have access to that message! :c');
            return;
        }

        let embed;

        try {
            embed = JSON.parse(message);
        } catch (error) {}

        if (!embed) {
            await messageObj.edit({ content: message, embeds: [] });
        } else {
            try {
                if (embed.embed || embed.embeds) await messageObj.edit(embed);
                else await messageObj.edit({ content: '', embed });
            } catch (error) {
                await ctx.error(
                    'please provide data in atleast one of the embed following embed fields! `Description` `Thumbnail Url` `Title` `Author Name`'
                );
                return;
            }
        }

        await ctx.send(`I have edited ${ctx.args[0]}`);
    },
});
