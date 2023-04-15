const CommandHandler = require('../CommandHandlers/CommandHandler.js');
const global = require('../utils/global.js');
const CONFIG = require("../config.json");

const QUEST_DATA = require("../data/quests.json");
const EMBED_FIELD_CHARACTER_LIMIT = 1023;	// One less just to be safe
const MESSAGES_UNTIL_REPOST = 15;
let QUEST_LIST = [];
let QUEST_LIST_MESSAGE = null;
let MESSAGES_SINCE_LAST_POST = 15;

module.exports = class MessageCreateHandler {
	constructor(bot) {
		this.bot = bot;
		this.prefixes = bot.config.prefix;
		this.command = new CommandHandler(bot);
	}

	handle(msg) {
		if (msg.channel.id == CONFIG.channels.questHelp) {
			this.manageQuestHelp(msg);
		}
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
		const SENDER_ID = msg.author.id;

		if (SENDER_ID == CONFIG['owo-bot']) {
			// Delete quest logs to keep channel clean
			const isQuestLog = msg.embeds?.[0]?.author?.name.endsWith("Quest Log");
			if (isQuestLog) msg.delete();

			// Update when quest is completed in channel
			const MESSAGE = msg.content;

			if (MESSAGE.includes?.("You finished a quest and earned") ||
				MESSAGE.includes?.("prays for") ||
				MESSAGE.includes?.("puts a curse on") ||
				MESSAGE.includes?.("You got a cookie from")) {
				await this.updateQuestList();
			}

			return;
		}

		// Ignore if snail
		if (SENDER_ID == this.bot.user.id) return;

		const MESSAGE = msg.content.toLowerCase();
		// Ignore if message is not quest command
		if (!MESSAGE.startsWith("owo quest") && !MESSAGE.startsWith("owo q")) {
			MESSAGES_SINCE_LAST_POST++;

			if (MESSAGES_SINCE_LAST_POST >= MESSAGES_UNTIL_REPOST) await this.updateQuestList();
			return;
		};

		// Fetch the user's quests
		const result = await this.getUsersQuests([SENDER_ID]);

		// Filter for the quests that can be added to the list
		const new_quests = result.filter(quest => checkValidQuest(quest));

		QUEST_LIST.push(...new_quests);

		if (new_quests.length == 0) {
			await global.warn(msg, "You don't have any new quests to add to the list! Only unlocked Cookie, Pray, Curse, Battle, and Emote quests can be added!", 7500);
		} else {
			let text = `<@${SENDER_ID}>, I have added your quest(s) to the list!\n` + new_quests.map(quest => `- \`${questToString(quest)}\`\n`).join("") + "\nPlease note that older quests will be shown first! If you don't see your quest it is in the queue!";
			let message = await msg.channel.createMessage(text);
			setTimeout(() => {
				message.delete();
			}, 7500);
			await this.updateQuestList();
		}

		msg.delete();
	}

	async getUsersQuests(users) {
		if (users.length == 0) return [];
		const sql = `SELECT q.qname as type, q.level, q.count, UNIX_TIMESTAMP(q.claimed) as claimed, q.locked, u.id as discordID FROM quest q INNER JOIN user u ON q.uid = u.uid WHERE u.id IN (${users.join(", ")}) ORDER BY claimed asc;`
		return await this.bot.owo_db.query(sql);
	}

	async updateQuestList() {
		const USERS_ON_LIST = [...new Set(QUEST_LIST.map(quest => quest.discordID))];
		const UPDATED_QUESTS = await this.getUsersQuests(USERS_ON_LIST);

		const UPDATED_QUEST_LIST = [];

		for (const QUEST of QUEST_LIST) {
			const UPDATED_QUEST = UPDATED_QUESTS.find(quest => areSameQuest(quest, QUEST));

			// This will not exist if quest was rerolled or completed
			if (UPDATED_QUEST) {
				UPDATED_QUEST_LIST.push(UPDATED_QUEST);
			}
		}

		QUEST_LIST = UPDATED_QUEST_LIST;

		const embed = await this.generateQuestListEmbed(QUEST_LIST);

		if (!QUEST_LIST_MESSAGE || MESSAGES_SINCE_LAST_POST >= MESSAGES_UNTIL_REPOST) {
			QUEST_LIST_MESSAGE = await this.bot.createMessage(CONFIG.channels.questHelp, { embed });
			MESSAGES_SINCE_LAST_POST = 0;
		} else {
			QUEST_LIST_MESSAGE.edit({ embed });
		}
	}

	async generateQuestListEmbed(questList) {
		const GROUPED_QUESTS = questList.reduce((groups, quest) => {
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

		// It's only like this to preserve the order...
		for (const TYPE of ["cookieBy", "prayBy", "curseBy", "friendlyBattle", "emoteBy"]) {
			if (!GROUPED_QUESTS[TYPE]) continue;

			if (!embed.fields) embed.fields = [];

			let questCount = 0;
			let value = "";

			while (value.length <= EMBED_FIELD_CHARACTER_LIMIT && questCount < GROUPED_QUESTS[TYPE].length) {
				const QUEST = GROUPED_QUESTS[TYPE][questCount];
				const QUEST_COMPLETION = `${QUEST.count}/${QUEST_DATA[QUEST.type].count[QUEST.level]}`;
				const USER = this.bot.users.get(QUEST.discordID);

				const QUEST_STRING = `\`${QUEST_COMPLETION}\` \`${USER.username}#${USER.discriminator}\` <@${QUEST.discordID}>\n`;

				if (value.length + QUEST_STRING.length <= EMBED_FIELD_CHARACTER_LIMIT) {
					value += QUEST_STRING;
					questCount++;
				} else {
					break;
				};
			}

			embed.fields.push({
				name: `${QUEST_DATA[TYPE].name} List ${questCount}/${GROUPED_QUESTS[TYPE].length}`,
				value: value ?? "???"
			});
		}

		return embed;
	}
};

function questToString(quest) {
	let count = QUEST_DATA[quest.type].count[quest.level];
	let text = "";

	switch (quest.type) {
		case 'emoteBy':
			text = 'Have a friend use an action command on you ' + count + ' times!';
			break;
		case 'cookieBy':
			text = 'Receive a cookie from ' + count + ' friends!';
			break;
		case 'prayBy':
			text = 'Have a friend pray to you ' + count + ' times!';
			break;
		case 'curseBy':
			text = 'Have a friend curse you ' + count + ' times!';
			break;
		case 'friendlyBattle':
			text = 'Battle with a friend ' + count + ' times!';
			break;
		default:
			text = 'Invalid Quest';
			break;
	}

	return text;
}

function checkValidQuest(newQuest) {
	// Check that it's one of the quests that can be added to the list
	if (!Object.keys(QUEST_DATA).includes(newQuest.type)) return false;

	// Check locked
	if (newQuest.locked == 1) return false;

	// Note: reroll changes claimed time
	if (QUEST_LIST.some(quest => areSameQuest(newQuest, quest))) return false;

	return true;
}

function areSameQuest(quest1, quest2) {
	return quest1.discordID == quest2.discordID && quest1.claimed == quest2.claimed;
}