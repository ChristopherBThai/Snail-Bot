const Command = require('../Command');
const { hasManagerPerms } = require('../../util');

module.exports = new Command({
    aliases: ['nick'],
    group: 'Util',
    auth: hasManagerPerms,
    usage: 'nick {reset | nick}',
    description: 'Set my nickname!',
    execute: async function (ctx) {
        let nick = ctx.args.join(' ');

        if (!nick) {
            await ctx.error('please provide a nickname!');
            return;
        }

        if (nick.length > 32 || nick.length < 1) {
            await ctx.error('the nickname must be 1 to 32 characters long!');
            return;
        }

        const RESET = nick.toLowerCase() == 'reset';
        if (RESET) nick = '';

        await ctx.bot.editGuildMember(ctx.bot.config.guild, '@me', { nick });

        if (RESET) {
            await ctx.send('I have reset my nickname!');
        } else {
            await ctx.send(`I have set my nickname to \`${nick}\`!`);
        }
    },
});
