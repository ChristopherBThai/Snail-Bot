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

    execute: async function (ctx) {
        switch (ctx.command) {
            case 'tag': {
                let subcommand = ctx.args.shift()?.toLowerCase();
                let name = ctx.args.shift()?.toLowerCase();
                let data = ctx.args.join(' ');
                let tag;

                // If the first arg wasn't one of the subcommands, then it is the tag name
                if (!subcommand) {
                    await ctx.error(`please provide a tag name!`);
                    return;
                }

                if (['add', 'edit', 'delete'].includes(subcommand)) {
                    // Only managers+ can add/edit/delete tags
                    if (!hasManagerPerms(ctx.member)) {
                        await ctx.error('you do not have permission to use this command!');
                        return;
                    }

                    // add/edit/delete subcommands require a tag name
                    if (!name) {
                        await ctx.error(`please provide a tag name!`);
                        return;
                    }

                    // All subcommands will need to check wether this exists or not anyway, so I'm fetching it out here instead of inside each switch branch
                    tag = await ctx.bot.snail_db.Tag.findById(name);
                } else {
                    tag = await ctx.bot.snail_db.Tag.findById(subcommand);
                }

                if (['add', 'edit'].includes(subcommand)) {
                    // add/edit subcommands require data
                    if (!data) {
                        await ctx.error(`please provide some data for the tag!`);
                        return;
                    }
                }

                if (subcommand == 'add') {
                    if (tag) {
                        await ctx.error(`that tag already exists!`);
                        return;
                    }

                    // @ts-ignore Definitely exists since it is checked for a handful of lines above.
                    if (!/^[a-z0-9]+$/.test(name)) {
                        await ctx.error(`tag names can only contain alphanumeric characters!`);
                        return;
                    }
                } else {
                    // all other subcommands require the tag to exist
                    if (!tag) {
                        await ctx.error(`that tag does not exist!`);
                        return;
                    }
                }

                switch (subcommand) {
                    case 'add': {
                        await ctx.snail_db.Tag.create({ _id: name, data });
                        await ctx.send(`I created the tag \`${name}\`!`);
                        break;
                    }
                    case 'edit': {
                        await ctx.snail_db.Tag.updateOne({ _id: name }, { data });
                        await ctx.send(`I updated the tag \`${name}\`!`);
                        break;
                    }
                    case 'delete': {
                        await ctx.snail_db.Tag.deleteOne({ _id: name });
                        await ctx.send(`I deleted the tag \`${name}\`!`);
                        break;
                    }
                    default: {
                        await ctx.send(tag.data);
                        break;
                    }
                }

                break;
            }
            case 'tags': {
                const tags = (await ctx.snail_db.Tag.find({})).map((tag) => `\`${tag._id}\``).sort();

                if (!tags) {
                    await ctx.error(`Oh no! I don't have any tags :(`);
                    return;
                }

                const embed = {
                    title: `Tags (${tags.length})`,
                    description: tags.join(` `),
                    timestamp: new Date(),
                    color: ctx.config.embedcolor,
                };

                await ctx.send({ embed });
                break;
            }
        }
    },
});
