// const { getUniqueUsername } = require('../util');
const PERMANENT_BAN_THRESHOLD = 99999;

module.exports = class BanBotBannedUsers extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'bot_ban_firewall',
            name: 'Ban Bot Banned Users',
            description: `Bans users who have an OwO ban of at least ${PERMANENT_BAN_THRESHOLD} hours.`,
            toggleable: true
        });

        this._addEvent('guildMemberAdd', this.checkUser);
    }

    // TODO!!!
};