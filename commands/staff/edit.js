const Command = require('../Command');
const { hasManagerPerms, parseMessageLink, downloadURL } = require('../../util');

module.exports = new Command({
    aliases: ['edit'],
    group: 'Staff',
    auth: hasManagerPerms,
    usage: 'edit {message link} {message | json}',
    description: 'Edit **any** message Snail has sent! You can even edit a message to have an embed by copying the json data for a message from this [website](https://glitchii.github.io/embedbuilder/)',
    examples: ['edit https://discord.com/channels/420104212895105044/542629170157715456/1131855197656854559 All hail our ruler lord Snail!! 🐌'],
    execute: async function (ctx) {
        const MESSAGE_LINK_RAW = ctx.args.shift();
        if (!MESSAGE_LINK_RAW) return ctx.error('please provide a message to edit!');

        const MESSAGE_LINK_IDS = parseMessageLink(MESSAGE_LINK_RAW);
        if (!MESSAGE_LINK_IDS) return ctx.error('please provide a valid channel or message link!');

        const { channelID: CHANNEL_ID, messageID: MESSAGE_ID } = MESSAGE_LINK_IDS;

        // Check for access to channel
        const CHANNEL = ctx.bot.getChannel(CHANNEL_ID);
        if (!CHANNEL) return ctx.error(`I do not have access to <#${CHANNEL_ID}>! :c`);

        const MESSAGE_OBJECT = await ctx.bot.getMessage(CHANNEL_ID, MESSAGE_ID);
        if (!MESSAGE_OBJECT) return ctx.error('I could not find that message! :c');

        const CONTENT = ctx.args.join(' ');
        const FILES = await Promise.all(ctx.message.attachments.map(async a => { return { file: await downloadURL(a.url), name: a.filename }; }));
        const ATTACHMENTS = FILES.map(({_, name}, id) => { return {filename: name, id}; });
        if (!CONTENT && !FILES.length) return ctx.error('please provide some content to echo!');

        let message = {content: '', embeds: [], file: FILES, attachments: ATTACHMENTS};
        try {
            /**
             * TODO: This breaks when parses as valid json, but isn't a valid object e.g. a list "[]"
             *       I don't think it'll be an issue, but noting here just in case
             */
            const PARSED = JSON.parse(CONTENT);
            if (typeof PARSED === 'object') message = {...message, ...PARSED};
            else message.content = CONTENT;
        } catch {
            message.content = CONTENT;
        }

        // TODO: Confirmation message with buttons?
        try {
            await MESSAGE_OBJECT.edit(message);
        } catch (error) {
            ctx.error(`there was an error sending that message. Did you forget an embed field? (${error})`);            
            return;
        }

        await ctx.send(`I have edited ${MESSAGE_OBJECT.jumpLink}`);
    },
});
