const Command = require('../commands/Command');
const Module = require('./Module');
const { flattenRequireDir, getName, isStaff } = require('../util');
const requireDir = require('require-dir');

module.exports = class CommandHandler extends Module {
    static LogTypes = Object.freeze({
        ...Module.LogTypes,
        COMMAND_NO_PREFIX: 'command.no_prefix',
        COMMAND_NO_COMMAND: 'command.no_command',
        COMMAND_UNKNOWN: 'command.unknown',
        COMMAND_UNAUTHORIZED: 'command.unauthorized',
        COMMAND_DISABLED: 'command.disabled',
        COMMAND_COOLDOWN: 'command.cooldown',
        COMMAND_EXECUTE: 'command.execute',
        COMMAND_ERROR: 'command.error'
    });

    /** @type {Object<string, import('../commands/Command')>} */
    commands = {};
    /** @type {Object<string, [import('../commands/Command')]>} */
    commandGroups = {};
    /** @type {Object<string, Set<string>>} */
    _disabledCommands = {};
    /** @type {Object<string, {lastUsed: number, warned: boolean}>} */
    _cooldown = {};
    /** @type {[string]} */
    _prefixes = [];
    /** @type {string | undefined} */
    _customPrefix;

    constructor(bot) {
        super(bot, {
            id: 'command_handler',
            name: 'Command Handler',
            description: 'Checks if messages are commands and executes them if they are.',
            toggleable: false
        });

        this._loadCommands();
        this._addEvent('userMessage', this._parseMessage);
    }

    async _onceReady() {
        await super._onceReady();
        this._setCustomPrefix(await this._bot.getConfig(`${this._id}_prefix`));
    }

    _loadCommands() {
        /** @type {[import('../commands/Command')]} */     
        const commands = flattenRequireDir(requireDir('../commands', { recurse: true }), Command);
        for (const command of commands) {
            // Create alias map
            for (const alias of command.aliases) {
                if (this.commands[alias]) {
                    throw new Error(`Duplicate command alias, '${alias}', used for ${this.commands[alias].name} and ${command.name} commands! Only registering alias under ${this.commands[alias].name} command.`);
                } else {
                    this.commands[alias] = command;
                }
            }

            // Create group map
            const GROUP = command.group;
            if (!GROUP) continue;

            if (!this.commandGroups[GROUP]) this.commandGroups[GROUP] = [];

            this.commandGroups[GROUP].push(command); 
        }
    }

    /** @arg {import('eris').Message<import('eris').GuildTextableChannel>} message */
    async _parseMessage(message) {
        // Check if message starts with one of the prefixes
        const prefix = this._prefixes.find(prefix => message.content.toLowerCase().trim().startsWith(prefix));
        if (!prefix) {
            this.log({
                level: this.LogLevels.TRACE,
                type: this.LogTypes.COMMAND_NO_PREFIX,
                data: this._getMessageLogData(message)
            });
            return;
        }

        // Parse alias and args
        const args = message.content.trim().slice(prefix.length).trim().split(/ +/g);
        const alias = args.shift()?.toLowerCase();
        if (!alias) {
            this.log({
                level: this.LogLevels.TRACE,
                type: this.LogTypes.COMMAND_NO_COMMAND,
                data: {
                    ...this._getMessageLogData(message),
                    prefix
                }
            });
            return;
        }

        // Check if a command with such alias exists
        const command = this.commands[alias];
        if (!command) {
            this.log({
                level: this.LogLevels.TRACE,
                type: this.LogTypes.COMMAND_UNKNOWN,
                data: {
                    ...this._getMessageLogData(message),
                    prefix,
                    alias
                }
            });
            return;
        }
        const commandName = command.name;

        // Check if the user is authorized to use the command
        if (!command.auth(message.member)) {
            this.log({
                level: this.LogLevels.DEBUG,
                type: this.LogTypes.COMMAND_UNAUTHORIZED,
                data: {
                    ...this._getMessageLogData(message),
                    prefix,
                    alias,
                    command: commandName
                }
            });
            return;
        }

        // Check if the command is disabled in the current channel
        const key = `${message.author.id}_${commandName}`;
        const disabledCommands = await this.getDisabledCommands([message.channel.id]);
        if (disabledCommands[message.channel.id].has(commandName)) {
            this.log({
                level: this.LogLevels.DEBUG,
                type: this.LogTypes.COMMAND_DISABLED,
                data: {
                    ...this._getMessageLogData(message),
                    prefix,
                    alias,
                    command: commandName
                }
            });
            return;
        }

        // Check if the user is not staff and is on cooldown for the command
        if (command.cooldown && !isStaff(message.member)) {
            const cooldown = this._cooldown[key];
            const now = Date.now();

            if (cooldown) {
                const cooldownEndTime = cooldown.lastUsed + command.cooldown;
                const cooldownRemaining = cooldownEndTime - now;
                
                // Only warn once per cooldown
                if (!cooldown.warned) {
                    cooldown.warned = true;
                    const ERROR_MESSAGE = await message.channel.createMessage(`🚫 **| ${getName(message.author)}**, slow down and try the command again in **<t:${cooldownEndTime / 1000 | 0}:R>**`);
                    setTimeout(async () => { 
                        await ERROR_MESSAGE.delete();
                    }, cooldownRemaining);
                }

                this.log({
                    level: this.LogLevels.DEBUG,
                    type: this.LogTypes.COMMAND_COOLDOWN,
                    data: {
                        ...this._getMessageLogData(message),
                        prefix,
                        alias,
                        command: commandName,
                        cooldownRemaining
                    }
                });
                return;
            }

            this._cooldown[key] = { lastUsed: now, warned: false };
            setTimeout(() => { delete this._cooldown[key]; }, command.cooldown);
        }

        this.log({
            level: this.LogLevels.INFO,
            type: this.LogTypes.COMMAND_EXECUTE,
            data: {
                ...this._getMessageLogData(message),
                prefix,
                alias,
                command: commandName,
                args: [...args]
            }
        });
        await this._executeCommand(message, command, alias, args);  
    }

    _getMessageLogData(message) {
        return {
            guildID: message.channel.guild?.id,
            channelID: message.channel.id,
            messageID: message.id,
            userID: message.author.id
        };
    }

    /**
     * @param {import('eris').Message<import('eris').GuildTextableChannel>} message 
     * @param {Command} command 
     * @param {string} alias 
     * @param {[string]} args 
     */
    async _executeCommand(message, command, alias, args) {
        /** @type {import('../commands/Command').Context} */
        const ctx = { 
            message,
            name: alias,
            args,
            bot: this._bot,
            // TODO Config?
            mongo: this._bot.mongo,
            // TODO mysql?
            send: async (msg, file) => { await message.channel.createMessage(msg, file); },
            error: async (msg, timeout=5000) => {
                const ERROR_MESSAGE = await message.channel.createMessage(`🚫 **| ${getName(message.author)}**, ${msg}`);
                setTimeout(async () => { 
                    await ERROR_MESSAGE.delete();
                }, timeout);
            }
        };

        try {
            await command.execute(ctx);
        } catch (error) {
            this.log({
                level: this.LogLevels.ERROR,
                type: this.LogTypes.COMMAND_ERROR,
                data: {
                    ...this._getMessageLogData(message),
                    alias,
                    command: command.name,
                    error: error.message,
                    stack: error.stack
                }
            }, true);
            await ctx.error('there was an unexpected error running that command!');
        }
    }

    _setCustomPrefix(prefix) {
        this._customPrefix = prefix;
        this._prefixes = [prefix, ...this._bot.config.prefixes].filter(Boolean);
    }

    async setAndSaveCustomPrefix(prefix) {
        this._setCustomPrefix(prefix);
        await this._bot.setConfig(`${this._id}_prefix`, prefix);
    }

    state() {
        return {
            ...super.state(),
            commands: Object.fromEntries(
                Object.entries(this.commands).map(([alias, command]) => [alias, command.name])
            ),
            commandGroups: Object.fromEntries(
                Object.entries(this.commandGroups).map(([group, commands]) => [
                    group,
                    commands.map(command => command.name)
                ])
            ),
            disabledCommands: Object.fromEntries(
                Object.entries(this._disabledCommands).map(([channelID, commands]) => [
                    channelID,
                    [...commands].sort()
                ])
            ),
            cooldown: this._cooldown,
            prefixes: this._prefixes,
            customPrefix: this._customPrefix
        };
    }

    async getDisabledCommands(channelIDs) {
        const missingChannelIDs = channelIDs.filter(channelID => !this._disabledCommands[channelID]);

        if (missingChannelIDs.length) {
            const channels = await this._bot.mongo.Channel.find({ _id: { $in: missingChannelIDs } });
            for (const channel of channels) {
                this._disabledCommands[channel.id] = new Set(channel.disabledCommands ?? []);
            }

            for (const channelID of missingChannelIDs) {
                if (!this._disabledCommands[channelID]) this._disabledCommands[channelID] = new Set();
            }
        }

        return Object.fromEntries(channelIDs.map(channelID => [channelID, this._disabledCommands[channelID]]));
    }

    async enableCommands(channelIDs, commands) {
        const disabledCommandsByChannel = await this.getDisabledCommands(channelIDs);

        for (const channelID of channelIDs) {
            const disabledCommands = disabledCommandsByChannel[channelID];
            for (const command of commands) disabledCommands.delete(command);

            await this._bot.mongo.Channel.updateOne(
                { _id: channelID },
                { $pull: { disabledCommands: { $in: commands } } },
                { upsert: true }
            );
        }
    }

    async disableCommands(channelIDs, commands) {
        const disabledCommandsByChannel = await this.getDisabledCommands(channelIDs);

        for (const channelID of channelIDs) {
            const disabledCommands = disabledCommandsByChannel[channelID];
            for (const command of commands) disabledCommands.add(command);

            await this._bot.mongo.Channel.updateOne(
                { _id: channelID },
                { $addToSet: { disabledCommands: { $each: commands } } },
                { upsert: true }
            );
        }
    }

    get prefix() {
        return this._customPrefix;
    }
};
