module.exports = class OwOReminders extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'marketmanager',
            name: 'Market Manager',
            description: `Automatically detects and manages simple rule breakers in the ticket market.`,
            toggleable: true,
        });

        // https://discord.com/developers/docs/resources/channel#bulk-delete-messages
        // https://github.com/ChristopherBThai/Snail-Bot/blob/dd2c3939ba9c6f72174354dff245eeeb56bd86fa/src/utils/marketUtil.js

        // TODO just get these via the message link
        // this.advertismentChannel = undefined;
        // this.tradingChannel = undefined;
        this.sellers = [];
        // this.

        // this.addEvent('messageDelete', this.prugeTradingChannel);
    }

    // async prugeTradingChannel(count = 0, limit = 3) {
    //     let msgs = await this.bot.getMessages(this.tradingChannel, { limit });
    //     let lastmsg = msgs.pop();

    //     msgs[0].member;

    //     if (msgs.length >= 2) {
    //         await this.bot.deleteMessages(
    //             this.tradingChannel,
    //             msgs.map((msg) => msg.id),
    //             'Ticket Market purge'
    //         );
    //         if (msgs.length < limit) {
    //             await this.prugeTradingChannel(count + msgs.length, limit);
    //             return;
    //         }
    //     } else if (msgs.length == 1) {
    //         await this.bot.deleteMessage(
    //             this.tradingChannel,
    //             msgs[0].id,
    //             'Ticket Market purge'
    //         );
    //     } else {

    //     }
    //     this.bot.deleteMessages('', []);
    //     console.log(msgs.map((msg) => msg.content));
    // }
};
