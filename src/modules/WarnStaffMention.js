const permissions = require('../utils/permissions');

module.exports = class WarnStaffMention {
    constructor(bot) {
        this.bot = bot;
		this.events = {
			"messageCreate": this.checkStaffMention,
		}
    }

    async checkStaffMention({author, channel, member, mentions}) {
		if (author.bot) return;
		
		if (mentions?.length == 0) return;								// Ignore if there are no mentions,
		if (permissions.isStaff(member)) return;						// was sent by a staff member,  
		if (this.bot.config.channels.questHelp == channel.id) return;	// or was sent in quest help

		let warning = `⚠️ **|** ${author.mention}, please refrain from tagging \`offline\` or \`do not disturb\` staff members!`;
		let mentionedStaff = [];

		for (const mention of mentions) {
			const member = channel.guild.members.get(mention.id);

			if (!permissions.isStaff(member)) continue;					// Ignore if the mentioned user wasn't staff

			const user = await this.bot.snail_db.User.findById(mention.id);
			if (user?.friends?.includes(author.id)) continue;			// Ignore if the staff member has the author on their friend list 

			let isDnd = member.status == "dnd";
			let isOffline = member.status == "offline";
			let isUndefined = !member.status;
			let inSpam = this.bot.config.channels.spam.includes(channel.id);

			if (isDnd || isOffline || isUndefined || inSpam) mentionedStaff.push(member);

			if (inSpam) warning = `⚠️ **|** ${author.mention}, please refrain from tagging staff members in spam channels!`;
		}

		if (mentionedStaff.length == 0) return;	// Ignore if no bad mentions were found
		
		let warnMessage = await channel.createMessage(warning);
		
		if (this.bot.config.debug) return;		// Don't log if in debug mode

		let logMessage = mentionedStaff.map(
			member => `⚠️ **|** ${author.mention} tagged ${member.username}#${member.discriminator} in ${channel.mention} ${warnMessage.jumpLink}`
		).join(`\n`);

		await this.bot.log(logMessage);
	}
};