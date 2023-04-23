module.exports = class GuildMemberRemoveHandler {
        constructor(bot) {
                this.bot = bot;
        }

        async handle(guild, member) {
                this.bot.questList.quests = this.bot.questList.quests.filter(quest => member.id != quest.discordID);
        }
};