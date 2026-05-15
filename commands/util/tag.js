const Command = require('../Command');
const { hasManagerPerms } = require('../../util');

const UPDATE_SUBCOMMANDS = ['add', 'edit', 'delete'];

module.exports = new Command({
    aliases: ['tag', 'tags'],
    group: 'Util',
    cooldown: 5000,
    usage: '[tag|tags] [add|edit|delete] [tag name] {message | json}',
    description: 'Manage or view existing tags! You use embeds by copying the json data for a message from this [website](https://glitchii.github.io/embedbuilder/)',
    examples: [
        'tags',
        'tag add gems Gems improve your hunt!',
        'tag edit gems Gems improve your hunt and give you a chance to find gem tier pets!',
        'tag delete gems',
    ],
    execute: async function (ctx) {
        if (ctx.name == 'tags') {
            const tags = (await ctx.mongo.Tag.find({}, { _id: 1 }).sort({ _id: 1 }).lean()).map(tag => `\`${tag._id}\``);

            if (!tags.length) return await ctx.error('Oh no! I don\'t have any tags :(');

            return await ctx.send({
                embeds: [{
                    title: `Tags (${tags.length})`,
                    description: tags.join(' '),
                    timestamp: new Date(),
                    color: ctx.bot.config.colors.embed
                }]
            });
        }

        const subcommand = ctx.args.shift()?.toLowerCase();

        if (!subcommand) return await ctx.error('please provide a tag name!');

        // Using tag, not updating
        if (!UPDATE_SUBCOMMANDS.includes(subcommand)) {
            const tag = await ctx.mongo.Tag.findById(subcommand);
            if (!tag) return await ctx.error('that tag does not exist!');

            let message;
            try {
                message = JSON.parse(tag.data);
            } catch {
                message = tag.data;
            }

            return await ctx.send(message);
        }

        // Only managers+ can update tags
        if (!hasManagerPerms(ctx.message.member)) return;

        const name = ctx.args.shift()?.toLowerCase();
        if (!name) return await ctx.error('please provide a tag name!');

        if (!/^[a-z0-9]+$/.test(name)) {
            return await ctx.error('tag names can only contain alphanumeric characters!');
        }

        const data = ctx.args.join(' ');
        // TODO: Support attachments

        switch (subcommand) {
            case 'add': {
                if (!data) return await ctx.error('please provide some data for the tag!');

                const tag = await ctx.mongo.Tag.findById(name);
                if (tag) return await ctx.error('that tag already exists!');

                await ctx.mongo.Tag.create({ _id: name, data });
                await ctx.send(`I created the tag \`${name}\`!`);
                break;
            }
            case 'edit': {
                if (!data) return await ctx.error('please provide some data for the tag!');

                const tag = await ctx.mongo.Tag.findById(name);
                if (!tag) return await ctx.error('that tag does not exist!');

                await ctx.mongo.Tag.updateOne({ _id: name }, { data });
                await ctx.send(`I updated the tag \`${name}\`!`);
                break;
            }
            case 'delete': {
                const tag = await ctx.mongo.Tag.findById(name);
                if (!tag) return await ctx.error('that tag does not exist!');

                await ctx.mongo.Tag.deleteOne({ _id: name });
                await ctx.send(`I deleted the tag \`${name}\`!`);
                break;
            }
        }
    },
});
