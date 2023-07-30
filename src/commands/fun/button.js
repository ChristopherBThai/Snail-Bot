const { Constants, ComponentInteraction } = require('eris');
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
                            custom_id:
                                '🐌🐌🐌🐌🐌🐌🐌🐌🐌1🐌🐌🐌🐌🐌🐌🐌🐌🐌2🐌🐌🐌🐌🐌🐌🐌🐌🐌3🐌🐌🐌🐌🐌🐌🐌🐌🐌4🐌🐌🐌🐌🐌🐌🐌🐌🐌5🐌🐌🐌🐌🐌🐌🐌🐌🐌6🐌🐌🐌🐌🐌🐌🐌🐌🐌7🐌🐌🐌🐌🐌🐌🐌🐌🐌8🐌🐌🐌🐌🐌🐌🐌🐌🐌9🐌🐌🐌🐌🐌🐌🐌🐌🐌0',
                        },
                        {
                            type: Constants.ComponentTypes.BUTTON,
                            style: 2,
                            label: 'GIMME DAT SWEET ROLE',
                            custom_id: 'add_role:1134265495512698900',
                        },
                        {
                            type: Constants.ComponentTypes.BUTTON,
                            style: 3,
                            label: "I'm done being cool",
                            custom_id: 'remove_role:1134265495512698900',
                        },
                        {
                            type: Constants.ComponentTypes.BUTTON,
                            style: 4,
                            label: 'launch nukes',
                            custom_id: 'click_four:hi',
                        },
                    ],
                },
            ],
        });
    },

    interactionHandler: async (interaction) => {
        if (!(interaction instanceof ComponentInteraction)) return;

        // FIXME: keep only interactions from this command

        // Handle button interaction
        const custom_id = interaction.data.custom_id;
        const [cmd, ...args] = custom_id.split(':');

        console.error(`Component Interaction Received (${custom_id}).`);
        console.log(cmd);

        switch (cmd) {
            case 'add_role': {
                if (args.length != 1) {
                    throw new Error(`Incorrect argument count for command ${cmd}\nExpected 1 but got ${args.length}.`);
                }
                const [role] = args;
                await interaction.member.addRole(role);

                await interaction.createMessage({
                    content: `Your role has been added. 😎`,
                    flags: Constants.MessageFlags.EPHEMERAL,
                });
                break;
            }
            case 'remove_role': {
                const [role] = args;
                await interaction.member.removeRole(role);

                await interaction.createMessage({
                    content: `Your coolness has been revoked.`,
                    flags: Constants.MessageFlags.EPHEMERAL,
                });
                break;
            }
            default: {
                await interaction.createMessage({
                    content: `The button has been pressed.`,
                    flags: Constants.MessageFlags.EPHEMERAL,
                });
            }
        }
    }
});
