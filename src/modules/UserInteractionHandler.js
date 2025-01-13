const requireDir = require('require-dir');
const UserInteraction = require('../user-interaction/UserInteraction');
const { isOwnerUser } = require('../utils/permissions');
const { ephemeralInteractionResponse } = require('../utils/sender');
const { getUniqueUsername } = require('../utils/global');

module.exports = class UserInteractionHandler extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'userinteractionhandler',
            name: 'User Interaction Handler',
            description: `Handle user interactions.`,
            toggleable: true,
        });

        this.interactions = {};

        const dir = requireDir('../user-interaction', { recurse: true });
        Object.values(dir)
            .flat()
            .map((file) => (file instanceof UserInteraction ? file : Object.values(file)))
            .flat()
            .filter((interaction) => interaction instanceof UserInteraction)
            .forEach((interaction) => {
                if (this.interactions[interaction.name]) {
                    throw new Error(`Duplicate user interaction name: ${interaction.name}`);
                }
                this.interactions[interaction.name] = interaction;
            });

        this.addEvent('UserInteraction', this.userInteraction);
    }

    async userInteraction(interaction) {
        const userInteraction = this.interactions[interaction.data.name];
        if (!userInteraction) {
            return;
        }

        const context = {
            interaction,
            target: this.getTargetUser(interaction),
            config: this.bot.config,
            snail_db: this.bot.snail_db,
            bot: this.bot,
            send: async (msg) => {
                return await interaction.createMessage(msg);
            },
            sendEphemeral: async (msg) => {
                const ephemeralMsg = ephemeralInteractionResponse(msg);
                return await interaction.createMessage(ephemeralMsg);
            },
            error: async (errorMsg) => {
                errorMsg = `🚫 **| ${getUniqueUsername(interaction.user)}**, ${errorMsg}`;
                const ephemeralMessage = ephemeralInteractionResponse(errorMsg);
                return await interaction.createMessage(ephemeralMessage);
            },
            createInteractionCollector: (msg, filter, opt) => {
                return this.bot.modules['interactioncollector'].create(msg, filter, opt);
            },
        };

        if (userInteraction.ownerOnly && !isOwnerUser(interaction.user)) {
            await context.error('this user command is for owners only!');
            return;
        }
        await userInteraction.execute.bind(context)();
    }

    getTargetUser({ data }) {
        return data.resolved.users.get(data.target_id);
    }
};
