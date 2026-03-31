const Command = require('../Command');

module.exports = new Command({
    aliases: ['help'],
    group: 'Util',
    cooldown: 5000,
    usage: 'help {command}',
    description: 'Get information on a command or list all commands.',
    execute: async function(ctx) {
        if (ctx.args.length == 0) {
            await displayCommands(ctx);
        } else {
            await displayCommand(ctx);
        }
    }
});

/** @param {import('../Command').Context} ctx */
async function displayCommands(ctx) {
    const MEMBER = ctx.message.member;

    const embed = {
        author: {
            name: 'Command List',
            icon_url: MEMBER.avatarURL
        },
        description: `Here is the list of my commands!\nFor more info on a specific command, use \`snail help {command}\`!`,
        fields: [],
        timestamp: new Date(),
        color: ctx.bot.config.colors.embed
    };

    
    for (const group in ctx.bot.commandHandler.commandGroups) {
        let groupString = '';

        for (const command of ctx.bot.commandHandler.commandGroups[group]) {
            if (command.auth(MEMBER)) groupString += `\`${command.name}\` `;
        }

        if (groupString) {
            embed.fields.push({
                name: group,
                value: groupString
            });
        }
    }

    await ctx.send({embeds: [embed]});
}

/** @param {import('../Command').Context} ctx */
async function displayCommand(ctx) {
    const command = ctx.bot.commandHandler.commands[ctx.args[0].toLowerCase()];

    if (!command) {
        return await ctx.error('I could not find that command! :c');
    }

    if (!command.auth(ctx.message.member)) return;

    let description = '';

    if (command.aliases.length > 1) {
        description += '### Aliases\n';
        for (const alias of command.aliases) {
            description += `\`${alias}\` `;
        }
        description += '\n';
    }

    if (command.description) {
        description += `### Description\n${command.description}\n`;
    }

    if (command.examples?.length) {
        description += `### Example Usage\n`;
        for (const example of command.examples) {
            description += `${example}\n`;
        }
        description += '\n';
    }

    const embed = {
        author: {
            name: `${ctx.bot.commandHandler.prefix} ${command.usage ?? command.name}`,
            icon_url: ctx.message.member.avatarURL
        },
        description,
        timestamp: new Date(),
        color: ctx.bot.config.colors.embed
    };

    await ctx.send({embeds: [embed]});
}