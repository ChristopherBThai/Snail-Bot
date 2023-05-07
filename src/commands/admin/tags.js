const CommandInterface = require('../CommandInterface.js');

module.exports = new CommandInterface({
    alias: ['tags'],

    emoji: '🏷️',

    group: "util",

    cooldown: 5000,

    usage: "snail tags",

    description: "Get a list of existing tags",

    execute: async function () {
        const tags = await this.snail_db.Tag.find({});

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

        await this.message.channel.createMessage({ embed });
    }
});

