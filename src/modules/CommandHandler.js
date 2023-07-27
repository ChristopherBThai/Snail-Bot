const requireDir = require("require-dir");
const Command = require("../commands/Command");
const { isStaff } = require("../utils/permissions");
const { ephemeralResponse } = require("../utils/sender");
const { getUniqueUsername } = require("../utils/global");
const DISABLED_WARNING_TIMEOUT = 30000;

module.exports = class CommandHandler extends require("./Module") {
    constructor(bot) {
        super(bot, {
            id: "commandhandler",
            name: "Command Handler",
            description: "Checks if messages are commands and executes a command if they are.",
            toggleable: false
        });

        // Default
        this.prefix = undefined;
        /** @type {Object<string, Command>} */
        this.commands = {};
        this.cooldowns = {};
        this.disabledCooldowns = {};

        const dir = requireDir("../commands", { recurse: true });

        // Repeat #map(file => file instanceof CommandInterface ? file : Object.values(file)).flat() once for each level of folders in "./commands"
        Object.values(dir)
            .flat()
            .map(file => file instanceof Command ? file : Object.values(file))
            .flat()
            .filter(command => command instanceof Command)
            .forEach(command => {
                command.alias.forEach(alias => {
                    if (this.commands[alias]) {
                        const firstInstance = this.commands[alias].alias[0];
                        const secondInstance = command.alias[0];
                        throw new Error(`Duplicate command alias, ${alias}, found in ${firstInstance} and ${secondInstance} commands!`);
                    }
                    this.commands[alias] = command;
                });
            });

        this.addEvent("UserMessage", this.processMessage);
    }

    async onceReady() {
        await super.onceReady();

        this.prefix = await this.bot.getConfiguration(`prefix`) ?? this.prefix;
    }

    async processMessage(message) {
        // Check if message starts with prefix
        const prefix = [this.prefix, ...this.bot.config.prefixes].find(prefix => message.content.toLowerCase().trim().startsWith(prefix));
        if (!prefix) return;

        // Parse command name/args
        let args = message.content.trim().slice(prefix.length).trim().split(/ +/g);
        message.command = args[0]?.toLowerCase();
        message.args = args.splice(1);

        // Check if a command with that name/alias exists
        const command = this.commands[message.command];
        if (!command) return;

        // Check if that command has been disabled in this channel
        const channel = await this.bot.snail_db.Channel.findById(message.channel.id);
        if (channel?.disabledCommands.includes(command.alias[0])) {
            if (this.disabledCooldowns[message.author.id + message.command]) return;
            
            this.disabledCooldowns[message.author.id + message.command] = true;
            setTimeout(() => {
                delete this.disabledCooldowns[message.author.id + message.command];
            }, DISABLED_WARNING_TIMEOUT);
            await ephemeralResponse(message, `🚫 **| ${getUniqueUsername(message.author)}**, that command has been disabled in this channel!`, DISABLED_WARNING_TIMEOUT);
            return;
        }

        const context = {
            message,
            command,
            config: this.bot.config,
            snail_db: this.bot.snail_db,
            bot: this.bot,
            commands: this.commands,
            send: async (msg) => {
                return message.channel.createMessage(msg);
            },
            error: async (errorMessage) => {
                return await ephemeralResponse(message, `🚫 **| ${getUniqueUsername(message.author)}**, ${errorMessage}`);
            },
        };

        await message.channel.sendTyping();

        if (command.auth(message.member)) {
            // Staff are not bound by the chains of cooldowns >:)
            if (!isStaff(message.member)) {
                const commandName = command.alias[0];
                const key = `${message.author.id}_${commandName}`;

                const cooldown = this.cooldowns[key] ?? { lastused: new Date(0), warned: false };
                const now = Date.now();

                // Difference in milliseconds
                const diff = now - cooldown.lastused;

                // If still on cooldown
                if (diff < (command.cooldown ?? 0)) {
                    // If not already warned, warn, otherwise ignore
                    if (cooldown.warned) return;

                    this.cooldowns[key].warned = true;
                    await context.error(`slow down and try the command again **<t:${((command.cooldown - diff + now) / 1000).toFixed(0)}:R>**`);
                    return;
                } else {
                    this.cooldowns[key] = { lastused: now, warned: false };
                }
            }          

            await command.execute.bind(context)();
        } else {
            await context.error('you do not have permission to use this command!');
        }
    }
}