const { parseUserID } = require('../utils/global');

module.exports = class Logger extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'logger',
            name: 'Logger',
            description: `Logs stuff 1984 style.`,
            toggleable: true,
        });

        // Defaults
        this.publicChannel = undefined;
        this.privateChannel = undefined;
        this.tracking = {
            dyno: false,
        };

        this.addEvent('DynoMessage', this.checkModerationLog);
    }

    async onceReady() {
        await super.onceReady();

        this.publicChannel = (await this.bot.getConfiguration(`${this.id}_public_channel`)) ?? this.publicChannel;
        this.privateChannel = (await this.bot.getConfiguration(`${this.id}_private_channel`)) ?? this.privateChannel;

        this.tracking = {
            dyno: (await this.bot.getConfiguration(`${this.id}_tracking_dyno`)) ?? this.tracking.dyno,
        };
    }

    async checkModerationLog(message) {
        if (!this.tracking.dyno) return;
        if (message.channel.id != this.privateChannel) return;

        const embed = message.embeds?.[0];

        if (embed?.author?.name?.startsWith('Case')) {
            const USER_ID = parseUserID(embed.fields.find(({ name }) => name == 'User').value);

            await this.publicLog({
                content: `<@${USER_ID}>`,
                allowedMentions: { users: [USER_ID] },
                embed: {
                    ...embed,
                    fields: embed?.fields.filter(({ name }) => name != 'Moderator'),
                },
            });
            await message.addReaction('📝');
        }
    }

    async publicLog(message) {
        if (this.publicChannel) await this.bot.createMessage(this.publicChannel, message);
        else console.log(`Log attempt failed (No Public Channel Set): ${message}`);
    }

    async privateLog(message) {
        if (this.privateChannel) await this.bot.createMessage(this.privateChannel, message);
        else console.log(`Log attempt failed (No Private Channel Set): ${message}`);
    }

    getConfigurationOverview() {
        return (
            `${super.getConfigurationOverview()}\n` +
            `- Public Channel: <#${this.publicChannel}>\n` +
            `- Private Channel: <#${this.privateChannel}>\n` +
            `- Tracking\n` +
            ` - Dyno: ${this.tracking.dyno}\n`
        );
    }
};
