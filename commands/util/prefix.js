const Command = require('../Command');
const { hasManagerPerms } = require('../../util');

module.exports = new Command({
    aliases: ['prefix'],
    group: 'Util',
    auth: hasManagerPerms,
    usage: 'prefix {prefix}',
    description: 'View or set a custom prefix for Snail!',
    execute: async function (ctx) {
        const prefix = ctx.args.shift()?.toLowerCase();

        if (!prefix) {
            const currentPrefix = ctx.bot.commandHandler.prefix;
            if (currentPrefix) return await ctx.send(`The current prefix is \`${currentPrefix}\`!`);
            return await ctx.send('I don\'t have a prefix set!');
        }

        await ctx.bot.commandHandler.applyAndSaveCustomPrefix(prefix);
        await ctx.send(`I have set the prefix to \`${prefix}\`!`);
    },
});
