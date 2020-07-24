const CommandHandler = require('../CommandHandlers/CommandHandler.js');
const global = require('../utils/global.js');

module.exports = class MessageCreateHandler {
	constructor (bot) {
		this.bot = bot;
		this.prefixes = bot.config.prefix;
		this.command = new CommandHandler(bot);
	}

	handle (msg) {
		if (msg.author.bot) return;
		const args = this.hasPrefix(msg.content);
		if (args) {
			msg.command = args[0].toLowerCase();
			msg.args = args.splice(1);
			this.command.execute(msg);
		}
		this.checkModMention(msg);
	}

	hasPrefix (content) {
		for (let i in this.prefixes) {
			let prefix = this.prefixes[i];
			if (content.toLowerCase().trim().startsWith(prefix)) {
				return content.trim().slice(prefix.length).trim().split(/ +/g);
			}
		}
	}

	async checkModMention (msg) {
		if (msg.mentions && msg.mentions.length > 0) {
			msg.mentions.forEach(async (mention) => {
				const member = msg.channel.guild.members.get(mention.id);
				if(global.hasRoles(member, this.bot.config.roles.mods) ||
					global.hasRoles(member, this.bot.config.roles.helpers)) {

					// Tags dnd or offline helper/mod
					if (member.status === 'dnd' || member.status === 'offline' || !member.status) {
						await msg.channel.createMessage(`⚠️ **|** Please refrain from tagging \`offline\` or \`do not disturb\` helpers/mods!`);
						await this.bot.createMessage(this.bot.config.channels.log, `⚠️ **|** ${msg.author.mention} tagged ${member.username}#${member.discriminator} in ${msg.channel.mention}`);
					}

					// Tags in spam channel
					else if (this.bot.config.channels.spam.includes(msg.channel.id)) {
						await msg.channel.createMessage(`⚠️ **|** Please refrain from tagging helper/mods in spam channels!`);
						await this.bot.createMessage(this.bot.config.channels.log, `⚠️ **|** ${msg.author.mention} tagged ${member.username}#${member.discriminator} in ${msg.channel.mention}`);
					}
				}
			});
		}
	}
}
