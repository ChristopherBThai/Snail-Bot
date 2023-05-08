const OWO_PRAY_CURSE_COMMAND = ["owo pray", "owo curse", "owopray", "owocurse"];
const OWO_PRAY_CURSE_COOLDOWN = 300000;
let REMINDERS = [];

module.exports = class CommandHandler {
    constructor(bot) {
        this.bot = bot;
        this.events = {
            "messageCreate": this.checkReminder,
        }
    }

    async checkReminder(message) {
        if (message.author.bot) return;

        const SENDER_ID = message.author.id, MESSAGE = message.content;
        const ENABLED = (await this.bot.snail_db.User.findById(SENDER_ID))?.reminders?.luck?.enabled;

        if (!ENABLED) return;

        if (OWO_PRAY_CURSE_COMMAND.some(command => MESSAGE.toLowerCase().startsWith(command))) {
            if (!REMINDERS.includes(SENDER_ID)) {
                REMINDERS.push(SENDER_ID);
                setTimeout(async () => {
                    REMINDERS = REMINDERS.filter(userID => userID != SENDER_ID);
                    let enabled = (await this.bot.snail_db.User.findById(SENDER_ID))?.reminders?.luck?.enabled;
                    if (enabled) await this.bot.createMessage(this.bot.config.channels.questHelp, `<@${SENDER_ID}> your pray/curse cooldown is over!`);
                }, OWO_PRAY_CURSE_COOLDOWN);
            }
            return;
        }

    }
};