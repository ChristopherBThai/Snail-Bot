const Command = require('../Command.js');

module.exports = new Command({
    alias: ['snail', '🐌'],

    group: 'Fun',

    cooldown: 1000,

    usage: 'snail snail',

    description: '🐌',

    execute: async function (ctx) {
        await ctx.send(`🐌`);
    },
});
