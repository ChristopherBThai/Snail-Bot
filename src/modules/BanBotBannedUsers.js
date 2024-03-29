const { getUniqueUsername } = require('../utils/global');
const PERMANENT_BAN_THRESHOLD = 99999;

module.exports = class BanBotBannedUsers extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'banpermabans',
            name: 'Ban Bot Banned Users',
            description: `Bans users from OBS who have a ban timer from OwO for atleast ${PERMANENT_BAN_THRESHOLD} hours.`,
            toggleable: true,
        });

        if (!this.bot.config.debug) this.addEvent('guildMemberAdd', this.checkUser);
    }

    async checkUser(guild, member) {
        // Select the user by id only if they are currently banned and their ban is longer than the perma ban threshold
        const sql = `SELECT id FROM timeout WHERE id = ? AND TIMESTAMPDIFF(HOUR, time, NOW()) < penalty AND penalty > ${PERMANENT_BAN_THRESHOLD};`;
        const result = await this.bot.query_owo_db(sql, [member.id]);

        if (result[0]) {
            let channel;
            let auditLogMessage = 'Permanently Bot Banned';

            try {
                channel = await this.bot.getDMChannel(member.id);
                await channel.createMessage('You have been banned from OwO permanently. You will not be unbanned.');
            } catch (err) {
                auditLogMessage += ' (Unable to DM)';
            }

            if (this.bot.modules['logger']?.tracking.dyno)
                this.bot.modules['logger'].publicLog({
                    content: `<@${member.id}>`,
                    allowedMentions: { users: [member.id] },
                    embed: {
                        timestamp: new Date().toISOString(),
                        footer: { text: `ID: ${member.id}` },
                        fields: [
                            { value: member.mention, name: 'User', inline: true },
                            { value: auditLogMessage, name: 'Reason', inline: true },
                        ],
                        // Dyno red color
                        color: 15747399,
                        author: {
                            name: `Ban | ${getUniqueUsername(member)}`,
                            icon_url: member.avatarURL,
                        },
                    },
                });
            await guild.banMember(member.id, 0, auditLogMessage);
        }
    }
};
