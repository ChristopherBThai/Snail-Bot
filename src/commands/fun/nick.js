const Command = require('../Command.js');

module.exports = new Command({
    alias: ['nick'],

    group: 'Fun',

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: 'snail nick {reset|nick}',

    description: "Set Snail's nickname!",

    execute: async function (ctx) {
        const nick = ctx.args.join(' ');
        if (!nick) {
            await ctx.error('please provide a nickname!');
            return;
        }

        if (nick.length > 32 || nick.length < 1) {
            await ctx.error('the name must be between 1 and 32 characters long (inclusive)!');
            return;
        }

        await ctx.bot.editGuildMember(ctx.config.guild, '@me', {
            nick: nick.toLowerCase() == 'reset' ? '' : nick,
        });

        if (nick.toLowerCase() == 'reset') await ctx.send('I have reset my nickname!');
        else await ctx.send(`I have set my nickname to \`${nick}\`!`);
    },
});
