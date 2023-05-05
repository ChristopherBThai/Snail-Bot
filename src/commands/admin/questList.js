const CommandInterface = require('../CommandInterface.js');
const CONFIG = require("../../config.json");
const QUEST_DATA = require("../../data/quests.json");
const MAX_MESSAGE_LENGTH = 1980;

module.exports = new CommandInterface({
	alias: ['questlist', 'ql'],

	emoji: '📃',

	group: "admin",

	auth: require("../../utils/permissions.js").hasModeratorPerms,

	usage: "snail questlist [clear|notifyclear|remove|setmax|settings|setrepostinterval] {...arguments}",

	description: "`snail ql clear [all, cookie, pray, curse, action]` - Will clear a list without notifying users\n" +
		"`snail ql notifyclear [all, cookie, pray, curse, action]` - Will clear a list AND notify all users that were cleared\n" +
		"`snail ql remove [all, cookie, pray, curse, action] {...mentions}` - Will remove users from the specified list. Only works with mentions, but can mention many users\n" +
		"`snail ql setmax [cookie, pray, curse, action] {number}` - Sets the max number of quests shown at a time of the specified type\n" +
		"`snail ql settings` - See the current quest list settings\n" +
		"`snail ql setrepostinterval {number}` - Sets how often the quest list is reposted; The list will be reposted every {number} messages\n",

	examples: ["snail questlist clear all", "snail ql clear cookie", "snail ql setmax cookie 10", "snail ql remove all <@729569334153969705> <@210177401064390658>"],

	execute: async function () {
		let subcommand = this.message.args[0]?.toLowerCase();

		switch (subcommand) {
			case "clear":
			case "notifyclear": {
				let type = this.message.args[1]?.toLowerCase();
				let users = [];

				switch (type) {
					case "all": {
						users = this.bot.questList.quests.map(quest => quest.discordID);
						this.bot.questList.quests = [];
						break;
					}
					case "cookie": {
						users = this.bot.questList.quests.filter(quest => quest.type == "cookieBy").map(quest => quest.discordID);
						this.bot.questList.quests = this.bot.questList.quests.filter(quest => quest.type != "cookieBy");
						break;
					}
					case "pray": {
						users = this.bot.questList.quests.filter(quest => quest.type == "prayBy").map(quest => quest.discordID);
						this.bot.questList.quests = this.bot.questList.quests.filter(quest => quest.type != "prayBy");
						break;
					}
					case "curse": {
						users = this.bot.questList.quests.filter(quest => quest.type == "curseBy").map(quest => quest.discordID);
						this.bot.questList.quests = this.bot.questList.quests.filter(quest => quest.type != "curseBy");
						break;
					}
					case "action": {
						users = this.bot.questList.quests.filter(quest => quest.type == "emoteBy").map(quest => quest.discordID);
						this.bot.questList.quests = this.bot.questList.quests.filter(quest => quest.type != "emoteBy");
						break;
					}
					default: {
						await this.error(", that is not a valid quest type! The valid types are `all`, `cookie`, `pray`, `curse`, and `action`");
						return;
					};
				}

				await this.bot.updateQuestList();
				await this.reply(`, I have cleared the ${type == "all" ? "quest" : type} list!`);

				if (subcommand == "notifyclear" && users.length != 0) {
					users = [...new Set(users)];
					let message = `The quest list for ${type} was reset and all quests were removed from it. If you want your quest added back, please use \`owo quest\` again.\n\n`
					message += users.map(id => `<@${id}>`).join(" ");
					await this.bot.createMessage(CONFIG.channels.questHelp, message);
				}

				break;
			}
			case "setmax": {
				let type = this.message.args[1]?.toLowerCase();
				let amount = parseInt(this.message.args[2]);

				if (!amount || amount < 1) {
					await this.error(`, ${this.message.args[2]} is not a valid number! Please select a number greater than 0.`);
					return;
				}

				switch (type) {
					case "cookie": this.bot.questList.maxQuests["cookieBy"] = amount; break;
					case "pray": this.bot.questList.maxQuests["prayBy"] = amount; break;
					case "curse": this.bot.questList.maxQuests["curseBy"] = amount; break;
					case "action": this.bot.questList.maxQuests["emoteBy"] = amount; break;
					default: {
						await this.error(", that is not a valid quest type! The valid types are `cookie`, `pray`, `curse`, and `action`");
						return;
					};
				}

				await this.bot.updateQuestList();
				await this.snail_db.QuestListSetting.updateOne({ _id: type + "Max" }, { value: amount }, { upsert: true })
				await this.reply(`, I have set the max number of quests for the ${type} list to ${amount}!`);

				break;
			}
			case "remove": {
				let type = this.message.args[1]?.toLowerCase();

				switch (type) {
					case "all": type = "all"; break;
					case "cookie": type = "cookieBy"; break;
					case "pray": type = "prayBy"; break;
					case "curse": type = "curseBy"; break;
					case "action": type = "emoteBy"; break;
					default: {
						await this.error(", that is not a valid quest type! The valid types are `all`, `cookie`, `pray`, `curse`, and `action` and the command is `snail questlist remove [type] {@users...}`");
						return;
					};
				}

				if (!this.message.mentions.length) {
					this.error(', please mention at least one user!');
					return;
				}

				let users = this.message.mentions.map((member) => member.id);
				this.bot.questList.quests = this.bot.questList.quests.filter(quest => !((quest.type == type || type == "all") && users.includes(quest.discordID)));

				await this.bot.updateQuestList();
				await this.reply(`, I removed ${this.message.mentions.length} users from the quest list!`);

				break;
			}
			case "settings": {
				let maxQuests = Object.entries(QUEST_DATA).map(([type, data]) => {
					return `**${data.name}:** ${this.bot.questList.maxQuests[type] ?? "infinity"}`
				}).join("\n");

				const embed = {
					author: {
						name: `Quest List Settings`,
					},
					fields: [
						{
							name: "__Max Quests__",
							value: maxQuests
						},
						{
							name: "__Repost Interval__",
							value: `The quest list is reposted every \`${this.bot.questList.messageCountRepostInterval}\` messages`
						}
					],
					timestamp: new Date(),
					color: 0xf1c40f,
				};

				await this.message.channel.createMessage({ embed });
				break;
			}
			case "forceupdate": {
				await this.bot.updateQuestList();
				await this.reply(`, I have updated the quest list!`);
				break;
			}
			case "viewqueue": {
				const QUESTS_GROUPED_BY_TYPE = this.bot.questList.quests.reduce((groups, quest) => {
					const TYPE = quest.type;
					groups[TYPE] = [...groups[TYPE] ?? [], quest];
					return groups;
				}, {});

				const MESSAGES = Object.entries(QUEST_DATA).filter(([type]) => QUESTS_GROUPED_BY_TYPE[type]).map(([type, data]) => {
					let usersOnList = [...new Set(QUESTS_GROUPED_BY_TYPE[type].map(quest => quest.discordID))];

					let text = usersOnList.reduce((list, user) => {
						let { nick, username } = this.bot.guilds.get(CONFIG.guild).members.get(user);
						return list += `${user} ${nick ?? username}\n`;
					}, "");

					return `${data.emoji} __**${data.name} List (${usersOnList.length})**__\n${text}`;
				}).join("\n").match(new RegExp('(.|[\r\n]){1,' + MAX_MESSAGE_LENGTH + '}', 'g')) ?? [];

				if (MESSAGES.length == 0) {
					this.reply(", The list is empty!");
					break;
				}

				for (const message of MESSAGES) {
					await this.message.channel.createMessage(message);
				}

				break;
			}
			case "setrepostinterval": {
				let amount = parseInt(this.message.args[1]);

				if (!amount || amount < 1) {
					await this.error(`, ${this.message.args[1]} is not a valid number! Please select a number greater than 0.`);
					return;
				}

				this.bot.questList.messageCountRepostInterval = amount;

				await this.bot.updateQuestList();
				await this.snail_db.QuestListSetting.updateOne({ _id: "MessageCountRepostInterval" }, { value: amount }, { upsert: true });
				await this.reply(`, I have set the quest list to repost every ${amount} messages!`);

				break;
			}
			default: {
				await this.error(", that is not a valid subcommand! The proper usage is `snail questlist [clear|notifyclear|remove|setmax|settings|setrepostinterval] {...arguments}`");
			}
		}
	},
});
