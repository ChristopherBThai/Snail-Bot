const CommandInterface = require('../../CommandInterface.js');
const {hasAdminPerms} = require('../../../utils/global.js');

module.exports = new CommandInterface({
    alias: ['tags'],

    emoji: '🏷️',

    execute: async function () {
        const tags = await this.db.Tag.find({});

        let tag_list = tags.map((tag) => `\`${tag._id}\``).sort().join(` `);

        if (!tag_list) {
            this.error(`Oh no! I don't have any tags :(`);
            return;
        }

        let embed = {
            author: {
                name: `Tags`,
            },
            description: tag_list,
            timestamp: new Date(),
            color: 0xf1c40f
        };

        await this.msg.channel.createMessage({ embed });
    }
});

