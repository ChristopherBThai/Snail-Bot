const Command = require('../Command.js');
const { hasManagerPerms } = require('../../utils/permissions.js');

module.exports = new Command({
    alias: ['tag', 'tags'],

    group: 'Util',

    cooldown: 5000,

    usage: 'snail [tag|tags] [add|edit|delete] {data}',

    description: 'Manage or view existing tags!',

    examples: [
        'snail tags',
        'snail tag add gems Gems improve your hunt!',
        'snail tag edit gems Gems improve your hunt and give you a chance to find gem tier pets!',
        'snail tag delete gems',
    ],

    execute: async function () {
        switch (this.message.command) {
            case 'tag': {
                let subcommand = this.message.args.shift()?.toLowerCase();
                let name = this.message.args.shift()?.toLowerCase();
                let data = this.message.args.join(' ');
                let tag;

                if (['add', 'edit', 'delete'].includes(subcommand)) {
                    // Only managers+ can add/edit/delete tags
                    if (!hasManagerPerms(this.message.member)) {
                        await this.error('you do not have permission to use this command!');
                        return;
                    }

                    // add/edit/delete subcommands require a tag name
                    if (!name) {
                        await this.error(`please provide a tag name!`);
                        return;
                    }

                    // All subcommands will need to check wether this exists or not anyway, so I'm fetching it out here instead of inside each switch branch
                    tag = await this.bot.snail_db.Tag.findById(name);
                } else {
                    // If the first arg wasn't one of the subcommands, then it is the tag name
                    if (!subcommand) {
                        await this.error(`please provide a tag name!`);
                        return;
                    }

                    tag = await this.bot.snail_db.Tag.findById(subcommand);
                }

                if (['add', 'edit'].includes(subcommand)) {
                    // add/edit subcommands require data
                    if (!data) {
                        await this.error(`please provide some data for the tag!`);
                        return;
                    }
                }

                if (subcommand == 'add') {
                    if (tag) {
                        await this.error(`that tag already exists!`);
                        return;
                    }

                    if (!/^[a-z0-9]+$/.test(name)) {
                        await this.error(`tag names can only contain alphanumeric characters!`);
                        return;
                    }
                } else {
                    // all other subcommands require the tag to exist
                    if (!tag) {
                        await this.error(`that tag does not exist!`);
                        return;
                    }
                }

                switch (subcommand) {
                    case 'add': {
                        await this.snail_db.Tag.create({ _id: name, data });
                        await this.send(`I created the tag \`${name}\`!`);
                        break;
                    }
                    case 'edit': {
                        await this.snail_db.Tag.updateOne({ _id: name }, { data });
                        await this.send(`I updated the tag \`${name}\`!`);
                        break;
                    }
                    case 'delete': {
                        await this.snail_db.Tag.deleteOne({ _id: name });
                        await this.send(`I deleted the tag \`${name}\`!`);
                        break;
                    }
                    default: {
                        await this.send(tag.data);
                        break;
                    }
                }

                break;
            }
            case 'tags': {
                const tags = (await this.snail_db.Tag.find({})).map((tag) => `\`${tag._id}\``).sort();

                if (!tags) {
                    await this.error(`Oh no! I don't have any tags :(`);
                    return;
                }

                const embed = {
                    title: `Tags (${tags.length})`,
                    description: tags.join(` `),
                    timestamp: new Date(),
                    color: this.config.embedcolor,
                };

                await this.send({ embed });
                break;
            }
        }
    },
});
