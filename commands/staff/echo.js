const Command = require('../Command');
const { hasManagerPerms, parseChannelID, parseMessageLink, parseQuoted, downloadURL } = require('../../util');
const TARGETS = Object.freeze({
    CHANNEL: 'channel',
    CHANNEL_THREAD: 'channelThread',
    FORUM_THREAD: 'forumThread',
    MESSAGE_THREAD: 'messageThread'
});

module.exports = new Command({
    aliases: ['echo'],
    group: 'Staff',
    auth: hasManagerPerms,
    usage: 'snail echo {channel | message link} ["thread name"] {message | json}',
    description: 'Echo a message into a channel! You can even echo a message with an embed by copying the json data for a message from this [website](https://glitchii.github.io/embedbuilder/)',
    examples: [
        'echo <#420111691507040266> OwO is currently offline, thank you for your patience as we resolve the issue!',
        'echo <#1275170010511179826> "Best suggestion ever!" Add gem dust 🥺🥺'
    ],
    execute: async function (ctx) {
        const TARGET_RAW = ctx.args.shift();
        if (!TARGET_RAW) return ctx.error('please provide a target to echo to!');

        // Parse target as channel, else try as message link
        let target = TARGETS.CHANNEL,
            channelID = parseChannelID(TARGET_RAW),
            messageID;

        if (!channelID) {
            const MESSAGE_LINK_IDS = parseMessageLink(TARGET_RAW);
            if (!MESSAGE_LINK_IDS) return ctx.error('please provide a valid channel or message link!');

            ({ channelID, messageID } = MESSAGE_LINK_IDS);
            target = TARGETS.MESSAGE_THREAD;
        }

        // Check for access to channel
        const CHANNEL = ctx.bot.getChannel(channelID);
        if (!CHANNEL) return ctx.error(`I do not have access to <#${channelID}>! :c`);

        // Check if a thread name was provided
        let THREAD_NAME;
        [THREAD_NAME, ctx.args] = parseQuoted(ctx.args);
        if (THREAD_NAME && target == TARGETS.CHANNEL) target = TARGETS.CHANNEL_THREAD;

        // Echo based on channel type and args
        const CHANNEL_TYPE = CHANNEL.type;

        // These channels do not support the creation of threads
        // 2 GUILD_VOICE, 10 GUILD_NEWS_THREAD, 11 GUILD_PUBLIC_THREAD, 12 GUILD_PRIVATE_THREAD, 13 GUILD_STAGE
        if ([2, 10, 11, 12, 13].includes(CHANNEL_TYPE)) {
            if (target == TARGETS.CHANNEL_THREAD || target == TARGETS.MESSAGE_THREAD) return ctx.error('I cannot create a thread in that channel type! :c');
            return echoMessage(ctx, target, { channelID });
        }

        // Creating a message in a forum channel is equivalent to creating a new thread in that channel.
        // 15 GUILD_FORUM
        if (CHANNEL_TYPE == 15) {
            if (!THREAD_NAME) return ctx.error('I cannot create a thread in a forum channel without a valid thread name! :c');
            if (target == TARGETS.MESSAGE_THREAD) return ctx.error('I cannot create a thread in that channel type! :c');
            target = TARGETS.FORUM_THREAD;
            return echoMessage(ctx, target, { channelID }, THREAD_NAME);
        }

        // If thread name exists, then create, else echo normally
        // 0 GUILD_TEXT, 5 GUILD_NEWS
        if ([0, 5].includes(CHANNEL_TYPE)) {
            if (target == TARGETS.MESSAGE_THREAD) {
                if (!THREAD_NAME) return ctx.error('I cannot create a thread off a message without a valid thread name! :c');
                else return echoMessage(ctx, target, { channelID, messageID }, THREAD_NAME);
            } else if (target == TARGETS.CHANNEL_THREAD) {
                if (CHANNEL_TYPE == 5) return ctx.error('I can only create a thread off of a message in an annoucement channel! :c'); // Why? Am I missing something?!
            }
            return echoMessage(ctx, target, { channelID }, THREAD_NAME);
        }

        // Unsupported channel type (DM?)
        ctx.error(`I cannot echo to that channel type! (type=${CHANNEL_TYPE}) :c`);
    },
});

// TODO: Confirmation message with buttons?
async function echoMessage(ctx, target, { channelID, messageID }, threadName) {
    const CONTENT = ctx.args.join(' ');
    const ATTACHMENTS = await Promise.all(ctx.message.attachments.map(async a => { return { file: await downloadURL(a.url), name: a.filename }; }));
    if (!CONTENT && !ATTACHMENTS.length) return ctx.error('please provide some content to echo!');

    let message = {};
    try {
        message = JSON.parse(CONTENT);
    } catch {
        message.content = CONTENT;
    }

    let echoTargetLink;

    try {
        switch (target) {
            case TARGETS.CHANNEL: {
                const MESSAGE = await ctx.bot.createMessage(channelID, message, ATTACHMENTS);
                echoTargetLink = MESSAGE.jumpLink;
                break;
            }
            case TARGETS.CHANNEL_THREAD: {
                const THREAD = await ctx.bot.createThread(channelID, {name: threadName});
                const MESSAGE = await THREAD.createMessage(message, ATTACHMENTS);
                echoTargetLink = MESSAGE.jumpLink;
                break;
            }
            case TARGETS.FORUM_THREAD: {
                const THREAD = await ctx.bot.createThread(channelID, {name: threadName, message}, ATTACHMENTS);            
                echoTargetLink = `<#${THREAD.id}>`;
                break;
            }
            case TARGETS.MESSAGE_THREAD: {
                const THREAD = await ctx.bot.createThreadWithMessage(channelID, messageID, {name: threadName});
                await THREAD.createMessage(message, ATTACHMENTS);
                echoTargetLink = `<#${THREAD.id}>`;
                break;
            }
            default: {
                ctx.error(`this code should be unreachable. Echo target=${target} found.`);
                return;
            }
        }
    } catch {
        ctx.error('there was an error sending that message. Did you forget an embed field?');
        return;
    }

    ctx.send(`I have echoed your message in ${echoTargetLink}!`);
}
