const Command = require('../Command.js');

module.exports = new Command({
    alias: ['prefix'],

    group: 'Util',

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: 'snail prefix {prefix}',

    description: 'View or set a custom prefix for snail!',

    execute: async function (ctx) {
        const prefix = ctx.args.shift()?.toLowerCase();
        if (!prefix) {
            await ctx.send(`The current prefix is \`${await ctx.bot.getConfiguration(`prefix`)}\``);
            return;
        }

        ctx.bot.modules['commandhandler'].prefix = prefix;
        await ctx.bot.setConfiguration(`prefix`, prefix);
        await ctx.send(`I have set the prefix to \`${prefix}\`!`);
    },
});
