const CommandInterface = require('../../CommandInterface.js');
const {hasAdminPerms} = require('../../../utils/global.js');

module.exports = new CommandInterface({
    alias: ['tags'],

    emoji: '🏷️',

    execute: async function () {
        const tags = await this.db.Tag.find({});

        let tagList = tags.map((tag) => `\`${tag._id}\``).sort().join(` `);

        if (!tagList) {
            this.error(`Oh no! I don't have any tags :(`);
            return;
        }

        let embed = {
            author: {
                name: `Tags`,
            },
            description: tagList,
            timestamp: new Date(),
            color: 0xf1c40f
        };

        await this.msg.channel.createMessage({ embed });
    }
});

