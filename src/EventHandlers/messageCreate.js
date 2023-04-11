const CommandHandler = require('../CommandHandlers/CommandHandler.js');
const global = require('../utils/global.js');

module.exports = class MessageCreateHandler {
	constructor(bot) {
		this.bot = bot;
		this.prefixes = bot.config.prefix;
		this.command = new CommandHandler(bot);
	}

	handle(msg) {
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
};
