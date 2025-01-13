const { getUid } = require('../utils/global');
const query = require('../databases/mysql/mysql.js');

module.exports = class Supporter extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'supporter',
            name: 'Supporter',
            description: 'Manages OwO supporter updates.',
            toggleable: true,
        });

        // Defaults
        this.cachedSupporters = {};

        this.addEvent('OwOCommand', this.onOwOCommand);
        this.addEvent('guildMemberAdd', this.onJoin);
    }

    async onOwOCommand({ command, message }) {
        if (!['patreon', 'donate', 'support', 'supporter'].includes(command)) return;
        this.checkUser(message.author);
    }

    async onJoin(guild, member) {
        this.checkUser(member.user);
    }

    async checkUser(user) {
        const uid = await getUid(user);
    }

    getConfigurationOverview() {
        return `${super.getConfigurationOverview()}\n` + `- Cached Users: ${Object.keys(this.cachedSupporters).length}`;
    }
};
