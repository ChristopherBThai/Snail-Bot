const CommandInterface = require('../../CommandInterface.js');
const {isStaff} = require("../../../utils/global");

module.exports = new CommandInterface({
    alias: ['help'],

    emoji: '🏓',

    usage: "snail help {command}",

    description: "Displays a list of commands or more information on a specific command",

    examples: ["snail help ping", "snail help"],

    execute: async function () {

        if (this.msg.args.length == 0) displayCommands.bind(this)();
        else {
            let commandAlias = this.msg.args[0];
            const command = this.commands[commandAlias];

            if (!command) {
                this.error(", I could not find that command! :c");
                return;
            }

            displayCommand.bind(this)(command);
        }

    },
});

async function displayCommands() {
    let embed = {
        author: {
            name: `Command list`,
            icon_url: this.msg.author.avatarURL
        },
        description: `Here is the list my commands!\nFor more info on a specific command, use \`snail help {command}\``,
        timestamp: new Date(),
        color: 0xf1c40f,
        fields: [{
            name: "Util",
            value: '`tag` `tags` `ping`'
        }]
    };

    if (isStaff(this.msg.member)) {
        embed.fields.unshift({
            name: "Admin",
            value: '`addfriend` `listfriends` `unfriend` `roles`'
        });
    }

    await this.msg.channel.createMessage({ embed });
}

async function displayCommand(command) {
    if (!(command.auth?.(this.msg.member) ?? true)) {
        return;
    }

    if (!command.usage || !command.description) {
        this.error(", I don't have information on that command! :c")
        return;
    }

    let embed = {
        author: {
            name: command.usage,
            icon_url: this.msg.author.avatarURL
        },
        timestamp: new Date(),
        color: 0xf1c40f,
        fields: [{
            name: "",
            value: '```Make sure to remove brackets when typing commands!\n[] = optional arguments\n{} = optional user input```'
        }]
    };

    if ((command.examples?.length ?? 0) > 0) {
        embed.fields.unshift({
            name: "Example usage",
            value: command.examples.join(", ")
        })
    }

    if (command.alias.length > 1) {
        embed.fields.unshift({
            name: "Aliases",
            value: command.alias.join(", ")
        })
    }

    embed.fields.unshift({
        name: "Description",
        value: command.description
    })

    await this.msg.channel.createMessage({ embed });
}