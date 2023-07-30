const Command = require('../Command.js');
const QUEST_DATA = require('../../data/quests.json');
const { parseChannelID, parseUserID } = require('../../utils/global.js');
const { getUniqueUsername } = require('../../utils/global.js');
const MAX_SECTION_SIZE = 1984;

module.exports = new Command({
    alias: ['questlist', 'ql'],

    group: 'Module',

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: 'snail questlist {...arguments}',

    description:
        '- `snail ql clear [all, cookie, pray, curse, action]`\n - Will clear a list without notifying users\n' +
        '- `snail ql notifyclear [all, cookie, pray, curse, action]`\n - Will clear a list AND notify all users that were cleared\n' +
        '- `snail ql remove [all, cookie, pray, curse, action] {...users}`\n - Will remove users from the specified list\n' +
        '- `snail ql setchannel {channel}`\n - Sets the channel the quest list will be maintained in\n' +
        '- `snail ql setmax [cookie, pray, curse, action] {number}`\n - Sets the max number of quests shown at a time of the specified type\n' +
        '- `snail ql setrepostinterval {number}`\n - Sets how often the quest list is reposted; The list will be reposted every {number} messages\n' +
        '- `snail ql setemptymessage {message}`\n - Sets a message to display when the list is empty\n' +
        '- `snail ql forceupdate`\n - Force the quest list to update\n' +
        '- `snail ql view`\n - See all the users on the quest list in a raw format\n',

    examples: [
        'snail questlist clear all',
        'snail questlist notifyclear cookie',
        'snail ql remove cookie <@210177401064390658>',
        'snail ql remove all <@729569334153969705> <@210177401064390658>',
        'snail ql setmax cookie 10',
        'snail ql setrepostinterval 15',
        'snail ql setemptymessage Wow! The list is empty. Yay!',
        'snail ql forceupdate',
        'snail ql view',
    ],

    execute: async function (ctx) {
        const QuestList = await ctx.bot.modules['questlist'];

        if (!QuestList) {
            await ctx.error(
                "I don't have a Quest List module. Did Wifu forget to delete this command or was the module deleted?"
            );
            return;
        }

        let subcommand = ctx.args.shift()?.toLowerCase();

        switch (subcommand) {
            case 'clear':
            case 'notifyclear': {
                let type = ctx.args.shift()?.toLowerCase();

                switch (type) {
                    case 'all':
                        break;
                    case 'cookie':
                    case 'pray':
                    case 'curse':
                        type += 'By';
                        break;
                    case 'action':
                        type = 'emoteBy';
                        break;
                    default: {
                        await ctx.error(
                            'that is not a valid quest type! The valid types are `all`, `cookie`, `pray`, `curse`, and `action`'
                        );
                        return;
                    }
                }

                let users = (
                    type == 'all' ? QuestList.quests : QuestList.quests.filter((quest) => quest.type == type)
                ).map((quest) => quest.discordID);
                QuestList.quests = type == 'all' ? [] : QuestList.quests.filter((quest) => quest.type != type);

                await QuestList.update();
                await ctx.send(
                    `I have cleared the ${type == 'all' ? 'quest' : QUEST_DATA[type].name.toLowerCase()} list!`
                );

                if (subcommand == 'notifyclear' && users.length != 0) {
                    users = [...new Set(users)];
                    let message = `The quest list for ${type.slice(
                        0,
                        -2
                    )} was reset and all quests were removed from it. If you want your quest added back, please use \`owo quest\` again.\n\n`;
                    message += users.map((id) => `<@${id}>`).join(' ');
                    await ctx.bot.createMessage(QuestList.channel, message);
                }

                break;
            }
            case 'remove': {
                let type = ctx.args.shift()?.toLowerCase();

                switch (type) {
                    case 'all':
                        break;
                    case 'cookie':
                    case 'pray':
                    case 'curse':
                        type += 'By';
                        break;
                    case 'action':
                        type = 'emoteBy';
                        break;
                    default: {
                        await ctx.error(
                            'that is not a valid quest type! The valid types are `all`, `cookie`, `pray`, `curse`, and `action` and the command is `snail ql remove [type] {@users...}`'
                        );
                        return;
                    }
                }

                let users = ctx.args.map((user) => parseUserID(user)).filter((user) => user);

                if (users.length == 0) {
                    await ctx.error('please list at least one valid user!');
                    return;
                }

                QuestList.quests = QuestList.quests.filter(
                    (quest) => !((quest.type == type || type == 'all') && users.includes(quest.discordID))
                );

                await QuestList.update();
                await ctx.send(`I removed ${users.length} users from the quest list!`);

                break;
            }
            case 'setchannel': {
                let channelID = parseChannelID(ctx.args.shift());
                if (!channelID) {
                    await ctx.error('please provide a channel mention or ID!');
                    return;
                }

                const channel = ctx.bot.getChannel(channelID);
                if (!channel) {
                    await ctx.error(`I do not have access to <#${channelID}>! :c`);
                    return;
                }

                QuestList.channel = channelID;
                await ctx.bot.setConfiguration(`${QuestList.id}_channel`, channelID);
                QuestList.lastSent = QuestList.repostInterval;
                await QuestList.update();
                await ctx.send(`I have set the Quest List channel to <#${channelID}>!`);
                break;
            }
            case 'setmax': {
                let type = ctx.args.shift()?.toLowerCase();
                let amount = parseInt(ctx.args[0]);

                if (!amount || amount < 1) {
                    await ctx.error(`${ctx.args[0]} is not a valid number! Please select a number greater than 0.`);
                    return;
                }

                switch (type) {
                    case 'cookie':
                    case 'pray':
                    case 'curse':
                        type += 'By';
                        break;
                    case 'action':
                        type = 'emoteBy';
                        break;
                    default: {
                        await ctx.error(
                            'that is not a valid quest type! The valid types are `cookie`, `pray`, `curse`, and `action`'
                        );
                        return;
                    }
                }

                QuestList.capacity[type] = amount;
                await QuestList.update();
                await ctx.bot.setConfiguration(`${QuestList.id}_${type.slice(0, -2)}_capacity`, amount);
                await ctx.send(`I have set the max number of quests for the ${type.slice(0, -2)} list to ${amount}!`);
                break;
            }
            case 'setrepostinterval': {
                let amount = parseInt(ctx.args[0]);

                if (!amount || amount < 1) {
                    await ctx.error(`${ctx.args[0]} is not a valid number! Please select a number greater than 0.`);
                    return;
                }

                QuestList.repostInterval = amount;
                await QuestList.update();
                await ctx.bot.setConfiguration(`${QuestList.id}_repost_interval`, amount);
                await ctx.send(`I have set the quest list to repost every ${amount} messages!`);
                break;
            }
            case 'setemptymessage': {
                let message = ctx.args.join(' ');

                if (!message) {
                    await ctx.error('please provide a message!');
                    return;
                }

                QuestList.emptyMessage = message;
                await QuestList.update();
                await ctx.bot.setConfiguration(`${QuestList.id}_empty_message`, message);
                await ctx.send(`I have set the quest list empty message to \n\`\`\`${message}\`\`\``);
                break;
            }
            case 'forceupdate': {
                await QuestList.update();
                await ctx.send(`I have updated the quest list!`);
                break;
            }
            case 'view': {
                if (QuestList.quests.length == 0) {
                    await ctx.send('The list is empty!');
                    break;
                }

                const QUESTS_GROUPED_BY_TYPE = QuestList.quests.reduce((groups, quest) => {
                    const TYPE = quest.type;
                    groups[TYPE] = [...(groups[TYPE] ?? []), quest];
                    return groups;
                }, {});

                let text = '';
                for (const [type, data] of Object.entries(QUEST_DATA).filter(
                    ([type]) => QUESTS_GROUPED_BY_TYPE[type]
                )) {
                    const userIDs = [...new Set(QUESTS_GROUPED_BY_TYPE[type].map((quest) => quest.discordID))];
                    const typeText = `${data.emoji} __**${data.name} List (${userIDs.length})**__\n`;

                    if (text.length + typeText.length > MAX_SECTION_SIZE) {
                        await ctx.send(text);
                        text = typeText;
                    } else {
                        text += typeText;
                    }

                    for (const id of userIDs) {
                        let user = await ctx.bot.getUser(id);
                        const userText = `${id} ${getUniqueUsername(user)}\n`;

                        if (text.length + userText.length > MAX_SECTION_SIZE) {
                            await ctx.send(text);
                            text = userText;
                        } else {
                            text += userText;
                        }
                    }
                }

                await ctx.send(text);
                break;
            }
            default: {
                await ctx.error(
                    'that is not a valid subcommand! The proper usage is `snail ql [clear|notifyclear|remove|setchannel|setmax|setrepostinterval|setemptymessage|forceupdate|view] {...arguments}`'
                );
                break;
            }
        }
    },
});
