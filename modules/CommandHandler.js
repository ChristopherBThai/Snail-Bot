const Command = require('../commands/Command');
const { flattenRequireDir, getName, isStaff } = require('../util');
const requireDir = require('require-dir');

const DISABLED_WARNING_TIMEOUT = 30_000;

module.exports = class CommandHandler extends require('./Module') {
    /** @type {Object<string, import('../commands/Command')>} */
    commands = {};
    /** @type {Object<string, [import('../commands/Command')]>} */
    commandGroups = {};
    /** @type {Object<string, boolean>} */
    _disabled = {};
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
        this._applyCustomPrefix(await this._bot.getConfig(`${this._id}_prefix`));
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
            this.log(`No prefix | user=${message.author.id} channel=${message.channel.id}`);
            return;
        }

        // Parse alias and args
        const args = message.content.trim().slice(prefix.length).trim().split(/ +/g);
        const alias = args.shift()?.toLowerCase();
        if (!alias) {
            this.log(`No command | user=${message.author.id} channel=${message.channel.id}`);
            return;
        }

        // Check if a command with such alias exists
        const command = this.commands[alias];
        if (!command) {
            this.log(`Unknown command | user=${message.author.id} channel=${message.channel.id} command=${alias}`);
            return;
        }
        const commandName = command.name;

        // Check if the user is authorized to use the command
        if (!command.auth(message.member)) {
            this.log(`Unauthorized | user=${message.author.id} channel=${message.channel.id} command=${commandName}`);
            return;
        }

        // Check if the command is disabled in the current channel
        const key = `${message.author.id}_${commandName}`;
        const disabledCommands = (await this._bot.mongo.Channel.findById(message.channel.id))?.disabledCommands; // TODO: Cache?
        if (disabledCommands?.includes(commandName)) {
            if (!this._disabled[key]) {
                this._disabled[key] = true;
                const ERROR_MESSAGE = await message.channel.createMessage(`🚫 **| ${getName(message.author)}**, that command has been disabled in this channel!`);
                setTimeout(async () => { 
                    await ERROR_MESSAGE.delete();
                    delete this._disabled[key];
                }, DISABLED_WARNING_TIMEOUT);
            }
            
            this.log(`Disabled | user=${message.author.id} channel=${message.channel.id} command=${commandName}`);
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

                this.log(`Cooldown | user=${message.author.id} channel=${message.channel.id} command=${commandName} cooldown=${cooldownRemaining}`);
                return;
            }

            this._cooldown[key] = { lastUsed: now, warned: false };
            setTimeout(() => { delete this._cooldown[key]; }, command.cooldown);
        }

        this.log(`Execute | user=${message.author.id} channel=${message.channel.id} command=${commandName} args=[${args}]`);
        await this._executeCommand(message, command, alias, args);  
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
            send: async (msg) => { await message.channel.createMessage(msg); },
            error: async (msg, timeout=5000) => {
                const ERROR_MESSAGE = await message.channel.createMessage(`🚫 **| ${getName(message.author)}**, ${msg}`);
                setTimeout(async () => { 
                    await ERROR_MESSAGE.delete();
                }, timeout);
            }
        };

        await command.execute(ctx);
    }

    _applyCustomPrefix(prefix) {
        this._customPrefix = prefix;
        this._prefixes = [prefix, ...this._bot.config.prefixes].filter(Boolean);
    }

    async applyAndSaveCustomPrefix(prefix) {
        this._applyCustomPrefix(prefix);
        await this._bot.setConfig(`${this._id}_prefix`, prefix);
    }

    get prefix() {
        return this._customPrefix;
    }
};
