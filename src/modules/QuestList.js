const Sender = require('../utils/sender.js');
const QUEST_DATA = require("../data/quests.json");

const COMPLETED_QUEST_TRIGGER = "You finished a quest and earned";
const UPDATE_TRIGGER_PHRASES = [COMPLETED_QUEST_TRIGGER, "prays for", "puts a curse on", "You got a cookie from"];
const OWO_QUEST_COMMAND = ["owo quest", "owoquest", "owoq", "owo q"];
const MESSAGE_TIMEOUT = 15000;
const EMBED_FIELD_CHARACTER_LIMIT = 1023;	// One less just to be safe
const WARNINGS = {};
const COMPONENTS = [
	{
		"type": 1,
		"components": [
			{
				"type": 2,
				"label": "Queue Position",
				"style": 1,
				"custom_id": "questlist_queue_position"
			},
			{
				"type": 2,
				"label": "Reload Mentions",
				"style": 1,
				"custom_id": "questlist_reload_mentions"
			},
			{
				"type": 2,
				"label": "Toggle Reminders",
				"style": 1,
				"custom_id": "questlist_toggle_reminders"
			}
		]
	}
];

module.exports = class QuestList {
	constructor(bot) {
		this.bot = bot;
		// Defaults
		this.bot.questList = {
			quests: [],
			message: null,
			maxQuests: {
				cookieBy: 5,
				prayBy: 10,
				curseBy: 10,
				emoteBy: 5,
			},
			messageCountRepostInterval: 15,
			messagesSinceLastPost: 15
		}
		this.bot.updateQuestList = this.updateQuestListMessage.bind(this);
		this.events = {
			"ready": this.setup,
			"messageCreate": this.manageQuestList,
			"guildMemberRemove": this.removeUserFromList
		}
	}

	async setup() {
		this.bot.questList.maxQuests = {
			cookieBy: (await this.bot.snail_db.QuestListSetting.findOne({ _id: "cookieMax" }))?.value,
			prayBy: (await this.bot.snail_db.QuestListSetting.findOne({ _id: "prayMax" }))?.value,
			curseBy: (await this.bot.snail_db.QuestListSetting.findOne({ _id: "curseMax" }))?.value,
			emoteBy: (await this.bot.snail_db.QuestListSetting.findOne({ _id: "actionMax" }))?.value,
		}

		this.bot.questList.messageCountRepostInterval = (await this.bot.snail_db.QuestListSetting.findOne({ _id: "MessageCountRepostInterval" }))?.value ?? this.bot.questList.messageCountRepostInterval;
	}

	async manageQuestList(message) {
		if (message.channel.id != this.bot.config.channels.questHelp) return;	// Only listen to quest help

		const SENDER_ID = message.author.id, MESSAGE = message.content;

		if (SENDER_ID == this.bot.config['owo-bot']) {
			if (message.embeds?.[0]?.author?.name.endsWith("Quest Log")) {		// Delete quest logs to keep channel clean
				message.delete();
				return;
			}
			this.bot.questList.messagesSinceLastPost++; 																// Any other message from OwO can count towards the counter
			if (UPDATE_TRIGGER_PHRASES.some(phrase => MESSAGE.includes(phrase))) await this.updateQuestListMessage();	// Update whenever a quest is completed, someone is prayed to, someone is cursed, or receives a cookie 
			if (MESSAGE.includes(COMPLETED_QUEST_TRIGGER)) await message.addReaction("🎉");								// React "🎉" to completed quests
			return;
		}

		if (SENDER_ID == this.bot.user.id) return;

		if (OWO_QUEST_COMMAND.every(command => !(MESSAGE.toLowerCase() == command))) {
			// If the list hasn't been sent for `MESSAGES_UNTIL_REPOST` messages, then call the update method to repost the list
			if (++this.bot.questList.messagesSinceLastPost >= this.bot.questList.messageCountRepostInterval) await this.updateQuestListMessage();
			return;
		};

		// Fetch the user's quests
		const result = await this.getUsersQuests([SENDER_ID]);

		// Filter for the quests that can be added to the list
		const new_quests = result.filter(newQuest => {
			return Object.keys(QUEST_DATA).includes(newQuest.type)							// Check that it is a type of quest that can be added to the list
				&& newQuest.locked == 0 													// Check that the quest is unlocked
				&& !this.bot.questList.quests.some(quest => areSameQuest(newQuest, quest));	// Check that the quest is not already on the list
		});

		this.bot.questList.quests.push(...new_quests);	// Add the new quests to the list

		if (new_quests.length == 0) {
			const lastWarned = WARNINGS[SENDER_ID] ?? new Date(0);
			const now = Date.now();
			const difference = now - lastWarned;

			// If not longer on warning cooldown
			if (difference > MESSAGE_TIMEOUT) {
				await Sender.ephemeralReply(message, `🚫 **|** <@${SENDER_ID}>, You don't have any new quests to add to the list! Only unlocked Cookie, Pray, Curse, and Action quests can be added!`, MESSAGE_TIMEOUT);
				WARNINGS[SENDER_ID] = now;
			}
		} else {
			let text = `<@${SENDER_ID}>, I have added your quest(s) to the list!\n` + new_quests.map(quest => {
				let count = QUEST_DATA[quest.type].count[quest.level];
				let questString = {
					emoteBy: `Have a friend use an action command on you ${count} times!`,
					cookieBy: `Receive a cookie from ${count} friends!`,
					prayBy: `Have a friend pray to you ${count} times!`,
					curseBy: `Have a friend curse you ${count} times!`,
				}[quest.type] ?? "Invalid Quest!";

				return `- \`${questString}\``;
			}).join("\n") + "\nPlease note that older quests will be shown first! If you don't see your quest it is in the queue! You can help out others with their quests to advance the queue faster!";

			await Sender.ephemeralReply(message, text, MESSAGE_TIMEOUT);
			await this.updateQuestListMessage();
		}

		message.delete();
	}

	async getUsersQuests(users) {
		if (users.length == 0) return [];
		const sql = `SELECT q.qname as type, q.level, q.count, UNIX_TIMESTAMP(q.claimed) as claimed, q.locked, u.id as discordID FROM quest q INNER JOIN user u ON q.uid = u.uid WHERE u.id IN (${users.join(", ")}) ORDER BY claimed asc;`
		return await this.bot.query_owo_db(sql);
	}

	async updateQuestListMessage() {
		const USERS_ON_LIST = [...new Set(this.bot.questList.quests.map(quest => quest.discordID))];
		const UPDATED_QUESTS = await this.getUsersQuests(USERS_ON_LIST);

		// Map old quests to updated quests setting quests that have been removed as undefined and then filter for quests that still exist and aren't locked
		this.bot.questList.quests = this.bot.questList.quests.map(quest => UPDATED_QUESTS.find(updatedQuest => areSameQuest(updatedQuest, quest))).filter(quest => quest?.locked == 0);

		const QUESTS_GROUPED_BY_TYPE = this.bot.questList.quests.reduce((groups, quest) => {
			const TYPE = quest.type;
			groups[TYPE] = [...groups[TYPE] ?? [], quest];
			return groups;
		}, {});

		const embed = {
			author: {
				name: `Quest List`,
			},
			description: `Use \`owo quest\` to have your quests added to the list! Battle and Action quests can be completed in spam channels. Please read the pins for information and FAQ.\n\n<#989702438317617173> <#989702567636394054> <#989702601648009276> <#989702633969295400> <#989702680911954010> <#556183345353064513>`,
			timestamp: new Date(),
			color: 0xf1c40f,
		};

		embed.fields = Object.entries(QUEST_DATA).filter(([type]) => QUESTS_GROUPED_BY_TYPE[type]).map(([type, data]) => {
			let questCount = 0;
			let text = "";

			const QUESTS_GROUPED_BY_USER = QUESTS_GROUPED_BY_TYPE[type].reduce((groups, quest) => {
				const USER = quest.discordID;
				groups[USER] = [...groups[USER] ?? [], quest];
				return groups;
			}, {});

			for (const USER in QUESTS_GROUPED_BY_USER) {
				let { nick, username, discriminator } = this.bot.guilds.get(this.bot.config.guild).members.get(USER);
				let counts = QUESTS_GROUPED_BY_USER[USER].map(({ count, level }) => `\`${count.toString().padStart(2, "0")}/${data.count[level].toString().padStart(2, "0")}\``).join(" + ");

				const QUEST_STRING = `${counts} \`${nick ?? username}#${discriminator}\` <@${USER}>\n`;

				if (text.length + QUEST_STRING.length > EMBED_FIELD_CHARACTER_LIMIT) break;

				text += QUEST_STRING;
				questCount++;

				if (questCount >= this.bot.questList.maxQuests[type]) break;
			}

			return {
				name: `${data.emoji} __${data.name} List__ (${questCount}/${Object.keys(QUESTS_GROUPED_BY_USER).length})`,
				value: text ?? "If you see this, then something broke lol. Tell <@210177401064390658>. Or don't... this will probably fix itself."
			}
		});

		if (this.bot.questList.messagesSinceLastPost >= this.bot.questList.messageCountRepostInterval || !this.bot.questList.message) {
			this.bot.questList.messagesSinceLastPost = 0;
			this.bot.questList.message = await this.bot.createMessage(this.bot.config.channels.questHelp, { embed, components: COMPONENTS });
		} else {
			this.bot.questList.message.edit({ embed, components: COMPONENTS });
		}
	}

	removeUserFromList(guild, member) {
		this.bot.questList.quests = this.bot.questList.quests.filter(quest => member.id != quest.discordID);
	}
};

function areSameQuest(quest1, quest2) {
	return quest1.discordID == quest2.discordID && quest1.claimed == quest2.claimed;
}