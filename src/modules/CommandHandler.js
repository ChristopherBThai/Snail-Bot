const { ComponentInteraction, Message } = require('eris');
const requireDir = require('require-dir');
const Command = require('../commands/Command');
const { isStaff } = require('../utils/permissions');
const { ephemeralResponse } = require('../utils/sender');
const { getUniqueUsername } = require('../utils/global');
const DISABLED_WARNING_TIMEOUT = 30000;

/** @typedef {Object<string, Command>} Commands */

/**
 * @typedef {Object} Context
 * @property {import('../../config.json')} config Bot config
 * @property {import('../databases/mongodb/mongo')} snail_db Mongo db
 * @property {import('../../index')} bot Bot client
 * @property {Commands} commands Bot commands
 * @property {Message["member"]} member Member who invoked the event
 * @property {Message["channel"]} channel Channel where the event was invoked
 * @property {import("eris").Guild} guild Guild where the event was invoked
 * @property {string} command Command name
 * @property {string[]} args Command arguments
 * @property {Function} send Function for sending a response to a command
 * @property {Function} error Function for sending an error response to a command
 */

module.exports = class CommandHandler extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'commandhandler',
            name: 'Command Handler',
            description: 'Checks if messages are commands and executes a command if they are.',
            toggleable: false,
        });

        // Default
        this.prefix = undefined;
        /** @type Commands */
        this.commands = {};
        this.cooldowns = {};
        this.disabledCooldowns = {};

        const dir = requireDir('../commands', { recurse: true });

        // Repeat #map(file => file instanceof CommandInterface ? file : Object.values(file)).flat() once for each level of folders in "./commands"
        Object.values(dir)
            .flat()
            .map((file) => (file instanceof Command ? file : Object.values(file)))
            .flat()
            .filter((command) => command instanceof Command)
            .forEach((command) => {
                // register command aliases
                command.alias.forEach((alias) => {
                    if (this.commands[alias]) {
                        const firstInstance = this.commands[alias].alias[0];
                        const secondInstance = command.alias[0];
                        throw new Error(
                            `Duplicate command alias, ${alias}, found in ${firstInstance} and ${secondInstance} commands!`
                        );
                    }
                    this.commands[alias] = command;
                });
            });

        this.addEvent('UserMessage', this.processMessage);
        this.addEvent('interactionCreate', this.processMessage);
    }

    async onceReady() {
        await super.onceReady();

        this.prefix = (await this.bot.getConfiguration(`prefix`)) ?? this.prefix;
    }

    async processMessage(event) {
        const ctx = this.createContext(event);
        if (!ctx) return;

        // Check if a command with that name/alias exists
        const command = this.commands[ctx.command];
        if (!command) return;
        if (!command.auth(ctx.member)) {
            await ctx.error(
                `you do not have permission to use this ${event instanceof Message ? 'command' : 'component'}!`
            );
            return;
        }

        if (event instanceof Message) {
            if (command.componentOnly) return;

            const channel = await this.bot.snail_db.Channel.findById(ctx.channel.id);
            const alias = command.alias[0];

            // Check if that command has been disabled in this channel
            if (channel?.disabledCommands.includes(alias)) {
                if (this.disabledCooldowns[ctx.member?.id + alias]) return;

                this.disabledCooldowns[ctx.member?.id + alias] = true;
                setTimeout(() => {
                    delete this.disabledCooldowns[ctx.member?.id + alias];
                }, DISABLED_WARNING_TIMEOUT);
                await ephemeralResponse(
                    ctx.channel,
                    `🚫 **| ${getUniqueUsername(ctx.member)}**, that command has been disabled in this channel!`,
                    DISABLED_WARNING_TIMEOUT
                );
                return;
            }

            await event.channel.sendTyping();

            // Staff are not bound by the chains of cooldowns >:)
            if (!isStaff(ctx.member) && command.cooldown) {
                const key = `${event.author.id}_${alias}`;

                const cooldown = this.cooldowns[key] ?? { lastused: new Date(0), warned: false };
                const now = Date.now();

                // Difference in milliseconds
                const diff = now - cooldown.lastused;

                // If still on cooldown
                if (diff < command.cooldown) {
                    // If not already warned, warn, otherwise ignore
                    if (cooldown.warned) return;

                    this.cooldowns[key].warned = true;
                    await ctx.error(
                        `slow down and try the command again **<t:${((command.cooldown - diff + now) / 1000).toFixed(
                            0
                        )}:R>**`
                    );
                    return;
                } else {
                    this.cooldowns[key] = { lastused: now, warned: false };
                }
            }
        }

        await command.execute(ctx);
    }

    /**
     * Creates a context variable from an event
     * @param {ComponentInteraction | Message} event
     * @returns {Context | undefined}
     */
    createContext(event) {
        if (event instanceof ComponentInteraction) {
            const [command, ...args] = event.data.custom_id.split(/ +/g);

            return {
                config: this.bot.config,
                snail_db: this.bot.snail_db,
                bot: this.bot,
                commands: this.commands,
                // @ts-ignore We do not plan on send components in dms so this will always exist
                member: event.member,
                channel: event.channel,
                // @ts-ignore
                guild: event.message.channel.guild,
                command,
                args,
                send: async (message, file) => {
                    await event.createMessage(message, file);
                },
                error: async (message) => {
                    await event.createMessage({
                        flags: 64,
                        content: `🚫 **| ${getUniqueUsername(event.member)}**, ${message}`,
                    });
                },
            };
        } else {
            // Check if message starts with prefix
            const prefix = [this.prefix, ...this.bot.config.prefixes].find((prefix) =>
                event.content.toLowerCase().trim().startsWith(prefix)
            );
            if (!prefix) return;

            const [command, ...args] = event.content.trim().slice(prefix.length).trim().split(/ +/g);

            return {
                config: this.bot.config,
                snail_db: this.bot.snail_db,
                bot: this.bot,
                commands: this.commands,
                member: event.member,
                channel: event.channel,
                // @ts-ignore
                guild: event.channel.guild,
                command: command.toLowerCase(),
                args,
                send: async (message, file) => {
                    await event.channel.createMessage(message, file);
                },
                error: async (message) => {
                    await ephemeralResponse(event.channel, `🚫 **| ${getUniqueUsername(event.member)}**, ${message}`);
                },
            };
        }
    }
};
