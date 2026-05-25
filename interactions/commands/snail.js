const Command = require('../InteractionCommand');

module.exports = new Command({
    type: 1,
    name: 'snail',
    definition: {
        type: 1,
        name: 'snail',
        description: '🐌'
    },
    execute: async function (ctx) {
        await ctx.send('🐌');
    }
});
