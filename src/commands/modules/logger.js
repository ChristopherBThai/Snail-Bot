const Command = require('../Command.js');
const { parseChannelID } = require("../../utils/global.js");

module.exports = new Command({
	alias: ['logger'],

	group: "Module",

	auth: require("../../utils/permissions.js").hasManagerPerms,

	usage: "snail logger {...arguments}",

	description: "- `snail logger setpublicchannel {channel}`\n - Set the channel for public logs\n" +
		"- `snail logger setprivatechannel {channel}`\n - Set the channel where Dyno logs can be parsed in order to log publicly\n" +
		"- `snail logger trackdyno {true|false}`\n - Whether or not dyno logs and Snail's perma ban logs are posted in the public logs\n",

	examples: [
		"snail logger setpublicchannel <#1128355136679452754>",
		"snail logger setprivatechannel <#548309597727883274>",
		"snail logger trackdyno true",
	],

	execute: async function () {
		const Logger = await this.bot.modules["logger"];

		if (!Logger) {
			await this.error("I don't have a Logger module. Did Wifu forget to delete this command or was the module deleted?");
			return;
		}

		let subcommand = this.message.args.shift()?.toLowerCase();

        switch(subcommand) {
            case "setpublicchannel": {
                let channelID = parseChannelID(this.message.args.shift());
				if (!channelID) {
					await this.error('please provide a channel mention or ID!');
					return;
				}

				const channel = this.bot.getChannel(channelID);
				if (!channel) {
					await this.error(`I do not have access to <#${channelID}>! :c`);
					return;
				}

				Logger.publicChannel = channelID;
				await this.bot.setConfiguration(`${Logger.id}_public_channel`, channelID);
				await this.send(`I have set the public logging channel to <#${channelID}>!`);
                break;
            }
            case "setprivatechannel": {
                let channelID = parseChannelID(this.message.args.shift());
				if (!channelID) {
					await this.error('please provide a channel mention or ID!');
					return;
				}

				const channel = this.bot.getChannel(channelID);
				if (!channel) {
					await this.error(`I do not have access to <#${channelID}>! :c`);
					return;
				}

				Logger.privateChannel = channelID;
				await this.bot.setConfiguration(`${Logger.id}_private_channel`, channelID);
				await this.send(`I have set the private logging channel to <#${channelID}>!`);
                break;
            }
            case "trackdyno": {
                let bool = this.message.args.shift().toLowerCase();

                if (bool == "true") {
                    Logger.tracking.dyno = true;
                    await this.bot.setConfiguration(`${Logger.id}_tracking_dyno`, true);
                    await this.send(`I am now logging dyno moderation commands in <#${Logger.publicChannel}>!`);
                } else if (bool == "false") {
                    Logger.tracking.dyno = false;
                    await this.bot.setConfiguration(`${Logger.id}_tracking_dyno`, false);
                    await this.send(`I am no longer logging dyno moderation commands in <#${Logger.publicChannel}>!`);
                } else {
                    await this.error(`${bool} is not a valid option. Please choose \`true\` or \`false\`.`);
                }
                break;
            }
            default: {
				await this.error("that is not a valid subcommand! The proper usage is `snail logger [setpublicchannel|setprivatechannel|trackdyno] {...arguments}`");
                break;
            }
        }
	},
});
