const CommandInterface = require('../../CommandInterface.js');
const { hasModeratorPerms } = require("../../../utils/global.js");
const CONFIG = require("../../../config.json");
const DATA = require("../../../data/quests.json");

module.exports = new CommandInterface({
	alias: ['questlist', 'ql'],

	emoji: '📃',

	group: "admin",

	auth: hasModeratorPerms,

	usage: "snail questlist [clear|remove|setmax] {...arguments}",

	description: "Manage the quest list. Note that when clearing the entire list, users will not be notified.",

	examples: ["snail questlist clear all", "snail ql clear cookie", "snail ql setmax cookie 10", "snail ql remove <@729569334153969705> <@210177401064390658>"],

	execute: async function () {
		let subcommand = this.msg.args[0]?.toLowerCase();

		switch (subcommand) {
			case "clear": {
				let type = this.msg.args[1]?.toLowerCase();
				let users = [];

				switch (type) {
					case "all": {
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

				if (users.length != 0) {
					users = [...new Set(users)];
					let message = `The quest list for ${type} was reset and all quests were removed from it. If you want your quest added back, please use \`owo quest\` again.\n\n`
					message += users.map(id => `<@${id}>`).join(" ");
					await this.bot.createMessage(CONFIG.channels.questHelp, message);
				}

				break;
			}
			case "setmax": {
				let type = this.msg.args[1]?.toLowerCase();
				let amount = parseInt(this.msg.args[2]);

				if (!amount || amount < 1) {
					await this.error(`, ${this.msg.args[2]} is not a valid number! Please select a number greater than 0.`);
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
				await this.reply(`, I have set the max number of quests for the ${type} list to ${amount}!`);

				break;
			}
			case "remove": {
				if (!this.msg.mentions.length) {
					this.error(', please mention at least one user!');
					return;
				}

				let users = this.msg.mentions.map((member) => member.id);
				this.bot.questList.quests = this.bot.questList.quests.filter(quest => !users.includes(quest.discordID));

				await this.bot.updateQuestList();
				await this.reply(`, I removed ${this.msg.mentions.length} users from the quest list!`);

				break;
			}
			case "settings": {
				let maxQuests = Object.entries(DATA).map(([type, data]) => {
					return `**${data.name}:** ${this.bot.questList.maxQuests[type] ?? "infinity"}`
				}).join("\n");

				const embed = {
					author: {
						name: `Quest List Settings`,
					},
					fields: [
						{
							name: "Max Quests",
							value: maxQuests
						}
					],
					timestamp: new Date(),
					color: 0xf1c40f,
				};

				await this.msg.channel.createMessage({ embed });
				break;
			}
			default: {
				await this.error(", that is not a valid subcommand! The proper usage is `snail questlist [clear|remove|setmax|settings] {...arguments}`");
			}
		}
	},
});
