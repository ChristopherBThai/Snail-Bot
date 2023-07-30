const Command = require('../Command.js');

module.exports = new Command({
    alias: ['ping', 'pong'],

    group: 'Util',

    cooldown: 5000,

    usage: 'snail ping',

    description: 'Pong!',

    execute: async function (ctx) {
        if (ctx.command == 'ping') await ctx.send(`Pong!`);
        else await ctx.send(`Ping!`);
    },
});
