const CommandInterface = require('../../CommandInterface.js');
const { hasAdminPerms } = require('../../../utils/global.js');

module.exports = new CommandInterface({
    alias: ['editmessage'],

    emoji: '📝',

    auth: hasAdminPerms,

    usage: "snail editmessage {channel} {messageID} {message|embedJsonData}",

    description: "Edit **any** message snail has sent! You can even edit a message to have an embed by copying the json data of an embed from this embed builder website! https://atlas.bot/tools/embed-builder",

    examples: ["snail editmessage <#420107107203940362> 1091199441249247242 All hail our ruler lord snail!! 🐌"],

    execute: async function () {
        let channelID = this.msg.channelMentions[0];
        let messageID = this.msg.args[1];
        let message = this.msg.args.splice(2).join(" ");

        if (!channelID) {
            await this.error(', please mention a channel! The proper usage is `snail editmessage {channel} {messageID} {message|embedJsonData}`');
            return;
        }

        if (!messageID) {
            await this.error(', please include a message ID! The proper usage is `snail editmessage {channel} {messageID} {message|embedJsonData}`');
            return;
        }

        if (!message) {
            await this.error(', please provide a message to echo!');
            return;
        }

        if (!this.msg.args[0].includes(channelID)) {
            await this.error(', please mention a channel before the message and messageID! The proper usage is `snail echo snail editmessage {channel} {messageID} {message|embedJsonData}`');
            return;
        }

        let messageObj = null;

        try {
            messageObj = await this.bot.getMessage(channelID, messageID);
        } catch {
            this.error(", I could not find that message! :c");
            return;
        }

        let embed = null;

        try {
            embed = JSON.parse(message)
        } catch (error) { }

        if (!embed) {
            await messageObj.edit({content: message, embeds: []});
        } else {
            try {
                await messageObj.edit({ content: "", embed });
            } catch (error) {
                await this.error(", please provide data in atleast one of the embed following embed fields! `Description` `Thumbnail Url` `Title` `Author Name`");
                return;
            }
        }

        await this.reply(`, I have edited a message in <#${channelID}>!`);
    },
});

