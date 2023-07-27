module.exports = class OwOOfflineSlowmode extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'lockdown',
            name: 'OBS Lockdown',
            description: `Settings for lockdown and toggles slowmode on a list of channels when OwO is offline.`,
            toggleable: true,
        });

        // TODO! Make this customizable
        this.slowmode = 30;
        this.channels = ['420107107203940362', '420111691507040266'];

        if (!this.bot.config.debug) this.addEvent('presenceUpdate', this.checkChange);
    }

    async checkChange(other, oldPresence) {
        if (other.user.id == this.bot.config.owobot) {
            if (other.status == 'online' && oldPresence.status != 'online') {
                // Bot is online, revert server to normal mode
                console.log('Bot is back online!');
                await this.setLimit(0, `Bot is back online! Removing slowmode!`);
            } else if (other.status != 'online') {
                // Bot is offline, make server go into slowmode
                console.log('Bot is offline!');
                await this.setLimit(
                    this.slowmode,
                    `The bot is down right now, it will take some time to come back online! If you have any questions please post it all in one message\n*Setting slowmode to ${this.slowmode} seconds*`
                );
            }
        }
    }

    async setLimit(timer, text) {
        const promises = [];
        for (const channelID of this.channels) {
            const guildID = this.bot.channelGuildMap[channelID];
            const guild = this.bot.guilds.get(guildID);
            const channel = guild?.channels.get(channelID);

            // @ts-ignore
            promises.push(channel?.createMessage(text));
            promises.push(
                channel?.edit({
                    rateLimitPerUser: timer,
                })
            );
        }

        await Promise.all(promises);
    }
};
