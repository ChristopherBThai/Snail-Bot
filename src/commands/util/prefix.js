const Command = require('../Command.js');

module.exports = new Command({
    alias: ['prefix'],

    group: 'Util',

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: 'snail prefix {prefix}',

    description: 'View or set a custom prefix for snail!',

    execute: async function () {
        const prefix = this.message.args.shift()?.toLowerCase();
        if (!prefix) {
            await this.send(`The current prefix is \`${await this.bot.getConfiguration(`prefix`)}\``);
            return;
        }

        this.bot.modules['commandhandler'].prefix = prefix;
        await this.bot.setConfiguration(`prefix`, prefix);
        await this.send(`I have set the prefix to \`${prefix}\`!`);
    },
});
