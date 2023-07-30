const Command = require('../Command.js');

module.exports = new Command({
    alias: ['help'],

    cooldown: 5000,

    usage: 'snail help {command}',

    description: 'Displays a list of commands or more information on a specific command!',

    execute: async function (ctx) {
        if (ctx.args.length == 0) {
            const commands = Object.values(ctx.commands).reduce((groups, command) => {
                // If no authorization, then do not add to groups
                if (!command.auth(ctx.member)) return groups;

                // If no defined group, then do not add to groups
                if (!command.group) return groups;

                const group = command.group;
                const name = command.alias[0];

                // If the group is not already defined, then instanciate it
                if (!groups[group]) groups[group] = [];

                // If the command has multiple aliases, then only include it once
                if (groups[group].includes(name)) return groups;

                groups[group].push(name);
                return groups;
            }, {});

            const embed = {
                author: {
                    name: `Command List`,
                    icon_url: ctx.bot.user.avatarURL,
                },
                description: `Here is the list of my commands!\nFor more info on a specific command, use \`snail help {command}\`!`,
                timestamp: new Date(),
                color: ctx.config.embedcolor,
            };

            for (const group in commands) {
                if (!embed.fields) embed.fields = [];

                embed.fields.push({
                    name: group,
                    value: commands[group].map((command) => `\`${command}\``).join(' '),
                });
            }

            await ctx.send({ embed });
        } else {
            let alias = ctx.args[0].toLowerCase();
            const command = ctx.commands[alias];

            if (!command) {
                await ctx.error('I could not find that command! :c');
                return;
            }

            if (!command.auth(ctx.member) || !command.usage || !command.description) {
                await ctx.error("I don't have information on that command! :c");
                return;
            }

            const embed = {
                author: {
                    name: command.usage,
                    icon_url: ctx.bot.user.avatarURL,
                },
                fields: [
                    {
                        name: 'Description',
                        value: command.description,
                    },
                ],
                timestamp: new Date(),
                color: ctx.config.embedcolor,
            };

            if (command.alias.length > 1) {
                embed.fields.unshift({
                    name: 'Aliases',
                    value: command.alias.join(', '),
                });
            }

            if (command.examples?.length) {
                embed.fields.push({
                    name: 'Example usage',
                    value: command.examples.map((example) => `- ${example}`).join('\n'),
                });
            }

            await ctx.send({ embed });
        }
    },
});
