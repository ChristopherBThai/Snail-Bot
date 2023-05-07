const CommandInterface = require('../CommandInterface.js');

module.exports = new CommandInterface({
    alias: ['help'],

    emoji: '🏓',

    cooldown: 1000,

    usage: "snail help {command}",

    description: "Displays a list of commands or more information on a specific command",

    examples: ["snail help ping", "snail help"],

    execute: async function () {

        if (this.message.args.length == 0) displayCommands.bind(this)();
        else {
            let commandAlias = this.message.args[0];
            const command = this.bot.commands[commandAlias];

            if (!command) {
                this.error(", I could not find that command! :c");
                return;
            }

            displayCommand.bind(this)(command);
        }

    },
});

async function displayCommands() {
    const COMMANDS = Object.values(this.bot.commands).reduce((groups, command) => {
        if (!(command.auth?.(this.message.member) ?? true)) return groups;                  // If no perms for command, then don't add to lists

        if (!command.group) return groups;                                              // If no group, then skip

        const GROUP = command.group.charAt(0).toUpperCase() + command.group.slice(1);   // Capitalize group name

        const NAME = command.alias[0];

        if (!groups[GROUP]) groups[GROUP] = [];

        if (groups[GROUP].includes(NAME)) return groups;

        groups[GROUP].push(NAME);
        return groups;
    }, {});

    let embed = {
        author: {
            name: `Command List`,
            icon_url: this.message.author.avatarURL
        },
        description: `Here is the list of my commands!\nFor more info on a specific command, use \`snail help {command}\``,
        timestamp: new Date(),
        color: 0xf1c40f,
    };

    for (const GROUP in COMMANDS) {
        if (!embed.fields) embed.fields = [];

        embed.fields.push({
            name: GROUP,
            value: COMMANDS[GROUP].map(command => `\`${command}\``).join(" ")
        })
    }

    await this.message.channel.createMessage({ embed });
}

async function displayCommand(command) {
    if (!(command.auth?.(this.message.member) ?? true)) {
        this.error(', you do not have permission to use this command!');
        return;
    }

    if (!command.usage || !command.description) {
        this.error(", I don't have information on that command! :c")
        return;
    }

    let embed = {
        author: {
            name: command.usage,
            icon_url: this.message.author.avatarURL
        },
        timestamp: new Date(),
        color: 0xf1c40f,
        fields: [{
            name: "Description",
            value: command.description
        }]
    };

    if (command.alias.length > 1) {
        embed.fields.push({
            name: "Aliases",
            value: command.alias.join(", ")
        })
    }

    if ((command.examples?.length ?? 0) > 0) {
        embed.fields.push({
            name: "Example usage",
            value: command.examples.join(", ")
        })
    }

    embed.fields.push({
        name: "",
        value: '```Make sure to remove brackets when typing commands!\n[] = optional arguments\n{} = optional user input```'
    });

    await this.message.channel.createMessage({ embed });
}