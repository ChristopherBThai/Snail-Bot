const { isStaff } = require("../utils/permissions");
const { getUniqueUsername } = require("../utils/global");

module.exports = class WarnStaffMention extends require("./Module") {
    constructor(bot) {
        super(bot, {
            id: "pingwarnings",
            name: "Ping Warnings",
            description: `Yells at users if they ping staff.`,
            toggleable: true
        });

		// TODO! Make these customizable
		// TODO! Make warning customizable
        this.ignoreChannels = [];
        this.spamChannels = [];

        this.addEvent("UserMessage", this.checkStaffMention);
    }

    async checkStaffMention({author, channel, member, mentions}) {
		if (author.bot) return;                                 // Ignore if bot,
		if (mentions?.length == 0) return;                      // are no mentions,
		if (isStaff(member)) return;                            // was sent by a staff member,  
		if (this.ignoreChannels.includes(channel.id)) return;   // or was sent in an ingnore channel

		let warning = `⚠️ **|** ${author.mention}, please refrain from tagging \`offline\` or \`do not disturb\` staff members!`;
		let mentionedStaff = [];

		for (const mention of mentions) {
			const member = channel.guild.members.get(mention.id);

            // Ignore if the mentioned user wasn't staff
			if (!isStaff(member)) continue;

            // Ignore if the staff member has the author on their friend list
			const user = await this.bot.snail_db.User.findById(mention.id);
			if (user?.friends?.includes(author.id)) continue;

			let isDnd = member.status == "dnd";
			let isOffline = member.status == "offline";
			let isUndefined = !member.status;
			let inSpam = this.spamChannels.includes(channel.id);

			if (isDnd || isOffline || isUndefined || inSpam) mentionedStaff.push(member);

			if (inSpam) warning = `⚠️ **|** ${author.mention}, please refrain from tagging staff members in spam channels!`;
		}

        // Ignore if no bad mentions were found
		if (mentionedStaff.length == 0) return;
		
		let warnMessage = await channel.createMessage(warning);
		
        // Don't log if in debug mode
		if (this.bot.config.debug) return;

		let logMessage = mentionedStaff.map(
			member => `⚠️ **|** ${author.mention} tagged ${getUniqueUsername(member)} in ${warnMessage.jumpLink}`
		).join(`\n`);

		await this.bot.modules["logger"]?.privateLog(logMessage);
	}
}