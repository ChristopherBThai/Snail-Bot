const CommandInterface = require('../CommandInterface.js');

module.exports = new CommandInterface({
    alias: ['echo'],

    emoji: '📢',

    group: "admin",

    auth: require('../../utils/permissions.js').hasModeratorPerms,

    usage: "snail echo {channel} {message|embedJsonData}",

    description: "Have snail echo a message into a channel! You can even echo a message with an embed by copying the json data of an embed from this embed builder website! https://atlas.bot/tools/embed-builder",

    examples: ["snail echo <#420107107203940362> All hail our ruler lord snail!! 🐌", "snail echo <#420111691507040266> OwO is currently offline, thank you for your patience as we resolve the issue!"],

    execute: async function () {
        let channelID = this.message.channelMentions[0];
        let message = this.message.args.splice(1).join(" ");

        if (!channelID) {
            await this.error(', please mention a channel! The proper usage is `snail echo {channel} {message}`');
            return;
        }

        if (!message) {
            await this.error(', please provide a message to echo!');
            return;
        }

        if (!this.message.args[0].includes(channelID)) {
            await this.error(', please mention a channel before the message! The proper usage is `snail echo {channel} {message}`');
            return;
        }

        let embed = null;

        try {
            embed = JSON.parse(message)
        } catch (error) { }

        if (!embed) {
            await this.bot.createMessage(channelID, message);
        } else {
            try {
                await this.bot.createMessage(channelID, { embed });
            } catch (error) {
                await this.error(", please provide data in atleast one of the embed following embed fields! `Description` `Thumbnail Url` `Title` `Author Name`");
                return;
            }
        }

        await this.reply(`, I have echoed your message in <#${channelID}>!`);
    },
});

