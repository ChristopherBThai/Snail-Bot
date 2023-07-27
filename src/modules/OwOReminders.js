const OWO_PRAY_CURSE_COOLDOWN = 300000;

module.exports = class OwOReminders extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'oworeminders',
            name: 'OwO Reminders',
            description: `Handlers reminders for commands like \`pray\`, \`curse\`, \`hunt\`, and \`battle\`.`,
            toggleable: true,
        });

        this.reminders = {};

        this.addEvent('OwOCommand', this.checkReminder);
    }

    async checkReminder({ command, args, message }) {
        if (!['pray', 'curse'].includes(command)) return;

        const SENDER_ID = message.author.id;
        const CHANNEL_ID = message.channel.id;
        const ENABLED = (await this.bot.snail_db.User.findById(SENDER_ID))?.reminders?.luck?.enabled;

        if (!ENABLED) return;

        if (!this.reminders[SENDER_ID]) this.reminders[SENDER_ID] = {};

        if (!this.reminders[SENDER_ID].luck) {
            this.reminders[SENDER_ID].luck = CHANNEL_ID;
            setTimeout(async () => {
                const ENABLED = (await this.bot.snail_db.User.findById(SENDER_ID))?.reminders?.luck?.enabled;
                if (ENABLED)
                    await this.bot.createMessage(
                        this.reminders[SENDER_ID].luck,
                        `<@${SENDER_ID}> your pray/curse cooldown is over!`
                    );
                this.reminders[SENDER_ID].luck = undefined;
            }, OWO_PRAY_CURSE_COOLDOWN);
        }
    }
};
