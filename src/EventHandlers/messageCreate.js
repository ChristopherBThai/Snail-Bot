const CommandHandler = require('../CommandHandlers/CommandHandler.js');
const global = require('../utils/global.js');
const CONFIG = require("../config.json");
const QUEST_DATA = require("../data/quests.json");

const UPDATE_TRIGGER_PHRASES = ["You finished a quest and earned", "prays for", "puts a curse on", "You got a cookie from"];
const OWO_QUEST_COMMAND = ["owo quest", "owoquest", "owoq", "owo q"];
const MESSAGE_TIMEOUT = 15000;
const EMBED_FIELD_CHARACTER_LIMIT = 1023;	// One less just to be safe
const MESSAGES_UNTIL_REPOST = 15;
const WARNINGS = {};
let MESSAGES_SINCE_LAST_POST = MESSAGES_UNTIL_REPOST;

module.exports = class MessageCreateHandler {
	constructor(bot) {
		this.bot = bot;
		this.bot.questList = [];
		this.bot.questListMessage = null;
		this.bot.updateQuestList = this.updateQuestListMessage.bind(this);
		this.bot.maxQuests = {};
		this.prefixes = bot.config.prefix;
		this.command = new CommandHandler(bot);
	}

	handle(msg) {
		if (msg.channel.id == CONFIG.channels.questHelp) this.manageQuestHelp(msg);
		if (msg.author.bot) return;
		const args = this.hasPrefix(msg.content);
		if (args) {
			msg.command = args[0].toLowerCase();
			msg.args = args.splice(1);
			this.command.execute(msg);
		}
		this.checkStaffMention(msg);
	}

	hasPrefix(content) {
		for (let i in this.prefixes) {
			let prefix = this.prefixes[i];
			if (content.toLowerCase().trim().startsWith(prefix)) {
				return content.trim().slice(prefix.length).trim().split(/ +/g);
			}
		}
	}

	async checkStaffMention(msg) {
		if (msg.mentions?.length == 0) return;											// Ignore if there are no mentions,
		if (global.isStaff(msg.member)) return;											// was sent by a staff member,  
		if (this.bot.config.channels.ignoreMention.includes(msg.channel.id)) return;	// or was sent in a mention ignored channel (only quest help at the moment)

		let warning = `⚠️ **|** ${msg.author.mention}, please refrain from tagging \`offline\` or \`do not disturb\` staff members!`;
		let mentionedStaff = [];

		for (const mention of msg.mentions) {
			const member = msg.channel.guild.members.get(mention.id);

			if (!global.isStaff(member)) continue;									// Ignore if the mentioned user wasn't staff

			const user = await this.bot.db.User.findById(mention.id);
			if (user?.friends?.includes(msg.author.id)) continue;					// Ignore if the staff member has the user on their friend list 

			let isDnd = member.status == "dnd";
			let isOffline = member.status == "offline";
			let isUndefined = !member.status;
			let inSpam = this.bot.config.channels.spam.includes(msg.channel.id);	// If mentioned in a spam channel

			if (isDnd || isOffline || isUndefined || inSpam) mentionedStaff.push(member);

			if (inSpam) warning = `⚠️ **|** ${msg.author.mention}, please refrain from tagging staff members in spam channels!`;
		}

		if (mentionedStaff.length == 0) return;	// Ignore if no bad mentions were found

		let warnMessage = await msg.channel.createMessage(warning);

		let logMessage = mentionedStaff.map(
			member => `⚠️ **|** ${msg.author.mention} tagged ${member.username}#${member.discriminator} in ${msg.channel.mention} ${warnMessage.jumpLink}`
		).join(`\n`);

		await this.bot.log(logMessage);
	}

	async manageQuestHelp(msg) {
		const SENDER_ID = msg.author.id, MESSAGE = msg.content;

		if (SENDER_ID == CONFIG['owo-bot']) {
			if (msg.embeds?.[0]?.author?.name.endsWith("Quest Log")) msg.delete();										// Delete quest logs to keep channel clean
			if (UPDATE_TRIGGER_PHRASES.some(phrase => MESSAGE.includes(phrase))) await this.updateQuestListMessage();	// Update whenever a quest is completed, someone is prayed to, someone is cursed, or receives a cookie 
			return;
		}

		// Ignore if snail
		if (SENDER_ID == this.bot.user.id) return;

		// Ignore if message is not quest command
		if (OWO_QUEST_COMMAND.every(command => !MESSAGE.toLowerCase().startsWith(command))) {
			if (++MESSAGES_SINCE_LAST_POST >= MESSAGES_UNTIL_REPOST) await this.updateQuestListMessage();	// If the list hasn't been sent for `MESSAGES_UNTIL_REPOST` messages, then call the update method to repost the list
			return;
		};

		// Fetch the user's quests
		const result = await this.getUsersQuests([SENDER_ID]);

		// Filter for the quests that can be added to the list
		const new_quests = result.filter(newQuest => {
			return Object.keys(QUEST_DATA).includes(newQuest.type)						// Check that it is a type of quest that can be added to the list
				&& newQuest.locked == 0 												// Check that the quest is unlocked
				&& !this.bot.questList.some(quest => areSameQuest(newQuest, quest));	// Check that the quest is not already on the list
		});

		this.bot.questList.push(...new_quests);		// Add the new quests to the list

		if (new_quests.length == 0) {
			const lastWarned = WARNINGS[SENDER_ID] ?? new Date(0);
			const now = Date.now();
			const difference = now - lastWarned;

			// If not longer on warning cooldown
			if (difference > MESSAGE_TIMEOUT) {
				await global.ephemeralReply(msg, `🚫 **|** <@${SENDER_ID}>, You don't have any new quests to add to the list! Only unlocked Cookie, Pray, Curse, Battle, and Emote quests can be added!`, MESSAGE_TIMEOUT);
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
					friendlyBattle: `Battle with a friend ${count} times!`,
				}[quest.type] ?? "Invalid Quest!";
				
				return `- \`${questString}\``;
			}).join("\n") + "\nPlease note that older quests will be shown first! If you don't see your quest it is in the queue!";

			await global.ephemeralReply(msg, text, MESSAGE_TIMEOUT);
			await this.updateQuestListMessage();
		}

		msg.delete();
	}

	async getUsersQuests(users) {
		if (users.length == 0) return [];
		const sql = `SELECT q.qname as type, q.level, q.count, UNIX_TIMESTAMP(q.claimed) as claimed, q.locked, u.id as discordID FROM quest q INNER JOIN user u ON q.uid = u.uid WHERE u.id IN (${users.join(", ")}) ORDER BY claimed asc;`
		return await this.bot.owo_db.query(sql);
	}

	async updateQuestListMessage() {
		const USERS_ON_LIST = [...new Set(this.bot.questList.map(quest => quest.discordID))];
		const UPDATED_QUESTS = await this.getUsersQuests(USERS_ON_LIST);

		// From the list of all the quests of users on the list, keep the ones that are already on the list and are still unlocked
		this.bot.questList = UPDATED_QUESTS.filter(updatedQuest => this.bot.questList.some(quest => areSameQuest(quest, updatedQuest) && updatedQuest.locked == 0));

		const GROUPED_QUESTS = this.bot.questList.reduce((groups, quest) => {
			const TYPE = quest.type;
			groups[TYPE] = [...groups[TYPE] ?? [], quest];
			return groups;
		}, {});

		const embed = {
			author: {
				name: `Quest List`,
			},
			description: `Type \`owo quest\` to have your quests added to the list!`,
			timestamp: new Date(),
			color: 0xf1c40f,
		};

		embed.fields = Object.entries(QUEST_DATA).filter(([type]) => GROUPED_QUESTS[type]).map(([type, data]) => {
			let questCount = 0;
			let text = "";

			for (const QUEST of GROUPED_QUESTS[type]) {
				let { count, level, discordID } = QUEST;
				let { username, discriminator } = this.bot.users.get(discordID);

				const QUEST_STRING = `\`${count}/${data.count[level]}\` \`${username}#${discriminator}\` <@${discordID}>\n`;

				if (text.length + QUEST_STRING.length > EMBED_FIELD_CHARACTER_LIMIT) break;

				text += QUEST_STRING;
				questCount++;

				if (questCount >= this.bot.maxQuests[type]) break;
			}

			return {
				name: `${data.name} List ${questCount}/${GROUPED_QUESTS[type].length}`,
				value: text ?? "If you see this, then something broke lol. Tell <@210177401064390658>. Or don't... this will probably fix itself."
			}
		});

		embed.fields.push({
			name: "Quest List FAQ",
			value: "• Remove a quest from the list or avoid adding it by locking it with `owo quest lock {1/2/3}`\n" +
				"• The list updates automatically and is reposted every 15 messages\n" +
				"• Quests finished elsewhere are automatically removed\n" + 
				"• Not all quests may be displayed at once! The ones not shown are queued. `Pray List 8/12` indicates that 8 quests are shown out of 12 and that 4 are waiting to be added\n" +
				"• Battle and Action quests can be completed in spam channels\n<#989702438317617173> <#989702567636394054> <#989702601648009276> <#989702633969295400> <#989702680911954010> <#556183345353064513>"
		})

		if (MESSAGES_SINCE_LAST_POST >= MESSAGES_UNTIL_REPOST || !this.bot.questListMessage) {
			this.bot.questListMessage = await this.bot.createMessage(CONFIG.channels.questHelp, { embed });
			MESSAGES_SINCE_LAST_POST = 0;
		} else {
			this.bot.questListMessage.edit({ embed });
		}
	}
};

function areSameQuest(quest1, quest2) {
	return quest1.discordID == quest2.discordID && quest1.claimed == quest2.claimed;
}