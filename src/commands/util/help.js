const Command = require('../Command.js');

const EMBED_FIELD_VALUE_LIMIT = 1024;

module.exports = new Command({
    alias: ['help'],

    cooldown: 5000,

    usage: 'snail help {command}',

    description: 'Displays a list of commands or more information on a specific command!',

    execute: async function () {
        if (this.message.args.length == 0) await displayCommands.bind(this)();
        else {
            let alias = this.message.args[0].toLowerCase();
            const command = this.commands[alias];

            if (!command) {
                await this.error('I could not find that command! :c');
                return;
            }

            await displayCommand.bind(this)(command);
        }
    },
});

async function displayCommands() {
    const commands = Object.values(this.commands).reduce((groups, command) => {
        // If no authorization, then do not add to groups
        if (!command.auth(this.message.member)) return groups;

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
            icon_url: this.bot.user.avatarURL,
        },
        description: `Here is the list of my commands!\nFor more info on a specific command, use \`snail help {command}\`!`,
        timestamp: new Date(),
        color: this.config.embedcolor,
    };

    for (const group in commands) {
        if (!embed.fields) embed.fields = [];

        embed.fields.push({
            name: group,
            value: commands[group].map((command) => `\`${command}\``).join(' '),
        });
    }

    await this.send({ embed });
}

async function displayCommand(command) {
    if (!command.auth(this.message.member) || !command.usage || !command.description) {
        await this.error("I don't have information on that command! :c");
        return;
    }

    const embed = {
        author: {
            name: command.usage,
            icon_url: this.bot.user.avatarURL,
        },
        fields: buildEmbedFields('Description', command.description),
        timestamp: new Date(),
        color: this.config.embedcolor,
    };

    if (command.alias.length > 1) {
        embed.fields.unshift({
            name: 'Aliases',
            value: command.alias.join(', '),
        });
    }

    if (command.examples?.length) {
        embed.fields.push(
            ...buildEmbedFields('Example usage', command.examples.map((example) => `- ${example}`).join('\n'))
        );
    }

    await this.send({ embed });
}

function buildEmbedFields(name, value) {
    const chunks = splitFieldValue(value);
    return chunks.map((chunk, index) => ({
        name: index ? `${name} continued` : name,
        value: chunk,
    }));
}

function splitFieldValue(value) {
    const chunks = [];
    for (const line of String(value).split('\n')) {
        let remaining = line || ' ';
        while (remaining.length > EMBED_FIELD_VALUE_LIMIT) {
            chunks.push(remaining.slice(0, EMBED_FIELD_VALUE_LIMIT));
            remaining = remaining.slice(EMBED_FIELD_VALUE_LIMIT);
        }

        const lastIndex = chunks.length - 1;
        const separator = chunks[lastIndex] ? '\n' : '';
        if (
            chunks[lastIndex] &&
            chunks[lastIndex].length + separator.length + remaining.length <= EMBED_FIELD_VALUE_LIMIT
        ) {
            chunks[lastIndex] += `${separator}${remaining}`;
            continue;
        }
        chunks.push(remaining);
    }
    return chunks;
}
