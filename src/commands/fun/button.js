const { Constants } = require('eris');
const Command = require('../Command.js');

module.exports = new Command({
    alias: ['button'],

    group: 'Fun',

    cooldown: 1000,

    usage: 'button',

    description: 'make a button',

    execute: async function (ctx) {
        await ctx.send({
            content: this.description,
            components: [
                {
                    type: Constants.ComponentTypes.ACTION_ROW,
                    components: [
                        {
                            type: Constants.ComponentTypes.BUTTON,
                            style: 1,
                            label: 'Button Command',
                            custom_id: 'button',
                        },
                        {
                            type: Constants.ComponentTypes.BUTTON,
                            style: 1,
                            label: '🐌',
                            custom_id: 'snail',
                        },
                        {
                            type: Constants.ComponentTypes.BUTTON,
                            style: 1,
                            label: 'Help Snail',
                            custom_id: 'help snail',
                        },
                        {
                            type: Constants.ComponentTypes.BUTTON,
                            style: 1,
                            label: 'Ping Command',
                            custom_id: 'ping',
                        },
                        {
                            type: Constants.ComponentTypes.BUTTON,
                            style: 1,
                            label: 'Nick Command',
                            custom_id: 'nick A very cool nick',
                        },
                    ],
                },
                {
                    type: Constants.ComponentTypes.ACTION_ROW,
                    components: [
                        {
                            type: Constants.ComponentTypes.BUTTON,
                            style: 1,
                            label: 'Tags command',
                            custom_id: 'tags',
                        },
                        {
                            type: Constants.ComponentTypes.BUTTON,
                            style: 1,
                            label: 'Markdown Tag',
                            custom_id: 'tag markdown',
                        },
                    ],
                },
            ],
        });
    },
});
