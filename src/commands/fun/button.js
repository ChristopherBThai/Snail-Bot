const { Constants } = require('eris');
const Command = require('../Command.js');

module.exports = new Command({
    alias: ['button'],

    group: 'Fun',

    cooldown: 1000,

    usage: 'button',

    description: 'make a button',

    execute: async function () {
        await this.send({
            content: 'Button Menu Example',
            components: [
                {
                    type: Constants.ComponentTypes.ACTION_ROW,
                    components: [
                        {
                            type: Constants.ComponentTypes.BUTTON,
                            style: 1,
                            label: 'Button one',
                            custom_id: 'button'
                        },
                        {
                            type: Constants.ComponentTypes.BUTTON,
                            style: 1,
                            label: '🐌',
                            custom_id: 'snail'
                        },
                        {
                            type: Constants.ComponentTypes.BUTTON,
                            style: 1,
                            label: 'Ping Command',
                            custom_id: 'ping'
                        },
                    ],
                },
            ],
        });
    }
});
