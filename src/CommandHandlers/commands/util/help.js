const CommandInterface = require('../../CommandInterface.js');
const {isStaff} = require("../../../utils/global");

module.exports = new CommandInterface({
    alias: ['help'],

    emoji: '🏓',

    cooldown: 1000,

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
            name: `Command List`,
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
            value: '`addfriend` `listfriends` `unfriend` `roles` `disable` `enable` `enabled` `echo` `editmessage`'
        });
    }

    await this.msg.channel.createMessage({ embed });
}

async function displayCommand(command) {
    if (!(command.auth?.(this.msg.member) ?? true)) {
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
            icon_url: this.msg.author.avatarURL
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

    await this.msg.channel.createMessage({ embed });
}