const Command = require('../Command');

module.exports = new Command({
    aliases: ['snail', '🐌'],
    group: 'Fun',
    cooldown: 1000,
    description: '🐌',
    execute: async function (ctx) {
        await ctx.send('🐌');
    },
});
