const EventEmitter = require('node:events');
const { ApplicationCommandTypes, InteractionTypes } = require('eris/lib/Constants');
const Command = require('../interactions/InteractionCommand');
const Module = require('./Module');
const { flattenRequireDir, getName, toEphemeral } = require('../util');
const requireDir = require('require-dir');

module.exports = class InteractionHandler extends Module {
    static LogTypes = Object.freeze({
        ...Module.LogTypes,
        COMMANDS_LOADED: 'interaction.commands_loaded',
        INTERACTION_ROUTED: 'interaction.routed',
        INTERACTION_UNKNOWN: 'interaction.unknown',
        INTERACTION_ERROR: 'interaction.error',
        COLLECTOR_CREATED: 'interaction.collector_created',
        COLLECTOR_ENDED: 'interaction.collector_ended',
        COMMAND_SYNC_COMPLETED: 'interaction.command_sync_completed'
    });

    /** @type {Object<string, { auth: (ctx: object) => boolean, execute: (ctx: object) => Promise<void> }>} */
    routes = {};
    /** @type {Object<string, InteractionCollector>} */
    collectors = {};
    /** @type {Object<string, object>} */
    commandDefinitions = {};

    constructor(bot) {
        super(bot, {
            id: 'interaction_handler',
            name: 'Interaction Handler',
            description: 'Registers interaction commands and routes Discord interactions.',
            toggleable: false
        });

        this._loadCommands();
        //  Eris 0.18.0 can throw before `interactionCreate` for user-install commands
        //  used in uncached foreign guilds, because it assumes guild member data maps
        //  to a cached guild. Won't fix for now since Snail only lives in OBS and 
        //  only Scoot has the user integration scope enabled anyway.
        this._addEvent('interactionCreate', this._routeInteraction);
    }

    async _onceReady() {
        await super._onceReady();

        try {
            await this.syncCommands();
        } catch (error) {
            this.log({
                level: this.LogLevels.ERROR,
                type: this.LogTypes.INTERACTION_ERROR,
                data: {
                    action: 'syncCommands',
                    error: error.message,
                    stack: error.stack
                }
            }, true);
        }
    }

    _loadCommands() {
        /** @type {import('../interactions/InteractionCommand')[]} */
        const commands = flattenRequireDir(requireDir('../interactions', { recurse: true }), Command);

        for (const command of commands) {
            this.registerCommand(command);
        }

        this.log({
            level: this.LogLevels.INFO,
            type: this.LogTypes.COMMANDS_LOADED,
            data: {
                routes: Object.keys(this.routes),
                commands: Object.keys(this.commandDefinitions)
            }
        }, true);
    }

    /** @param {import('eris').Interaction} interaction */
    async _routeInteraction(interaction) {
        let route;

        try {
            switch (interaction?.type) {
                case InteractionTypes.APPLICATION_COMMAND: {
                    route = this._getCommandKey(interaction.data.type, interaction.data.name);
                    break;
                }
                case InteractionTypes.MESSAGE_COMPONENT:
                case InteractionTypes.MODAL_SUBMIT: {
                    route = interaction.data.custom_id;
                    break;
                }
                default: return await this._handleUnknownInteraction(interaction);
            }

            const handler = this.routes[route];
            if (handler) {
                /** @type {import('../interactions/InteractionCommand').InteractionContext} */
                const ctx = {
                    interaction,
                    bot: this._bot,
                    data: interaction.data,
                    user: this._getInteractionUser(interaction),
                    target: this._getInteractionTarget(interaction),
                    member: interaction.member,
                    channel: interaction.channel,
                    guild: interaction.channel?.guild,
                    send: async (msg, file) => { await interaction.createMessage(msg, file); },
                    sendEphemeral: async (msg, file) => { await interaction.createMessage(toEphemeral(msg), file); },
                    error: async (msg) => {
                        const user = this._getInteractionUser(interaction);
                        await interaction.createMessage(toEphemeral(`🚫 **| ${getName(user)}**, ${msg}`));
                    },
                    acknowledge: async (...args) => { await interaction.acknowledge(...args); },
                    createModal: async (modal) => { await interaction.createModal(modal); },
                    editParent: async (msg, file) => { await interaction.editParent(msg, file); },
                    editOriginal: async (msg, file) => { await interaction.editOriginalMessage(msg, file); },
                    createCollector: (source, options) => this.createCollector(source, options)
                };

                if (!handler.auth(ctx)) return await ctx.error('you don\'t have permission to use that interaction!');

                this.log({
                    level: this.LogLevels.INFO,
                    type: this.LogTypes.INTERACTION_ROUTED,
                    data: {
                        ...this._getInteractionLogData(interaction),
                        route
                    }
                });

                return await handler.execute(ctx);
            }

            const collector = interaction.type == InteractionTypes.MODAL_SUBMIT
                ? this._getCollector(interaction.data.custom_id)
                : this._getCollector(interaction.message?.id) ?? this._getCollector(interaction.message?.interaction?.id);
            if (collector) return await collector.interact(interaction, this._getInteractionUser(interaction));

            return await this._handleUnknownInteraction(interaction);
        } catch (error) {
            this.log({
                level: this.LogLevels.ERROR,
                type: this.LogTypes.INTERACTION_ERROR,
                data: {
                    ...this._getInteractionLogData(interaction),
                    error: error.message,
                    stack: error.stack
                }
            }, true);
            try {
                await interaction.createMessage(toEphemeral('🚫 **|** there was an unexpected error running that interaction!'));
            } catch {}
        }
    }

    /**
     * @param {string} route
     * @param {(ctx: object) => Promise<void>} execute
     * @param {(ctx: object) => boolean} [auth]
     */
    registerRoute(route, execute, auth = () => true) {
        if (this.routes[route]) throw new Error(`Duplicate interaction route "${route}".`);
        this.routes[route] = { auth, execute };
    }

    /** @param {import('../interactions/InteractionCommand')} command */
    registerCommand(command) {
        const key = this._getCommandKey(command.type, command.name);
        this.registerRoute(key, command.execute, command.auth);
        this.commandDefinitions[key] = command.definition;
    }

    /**
     * Create a temporary interaction collector for a message/component/modal flow.
     * @param {string | { id: string }} source Message, interaction, or ID to route component interactions by.
     * @param {object} [options]
     * @param {(interaction: import('eris').Interaction, user: import('eris').User) => boolean} [options.filter]
     * @param {number} [options.time]
     * @param {number} [options.idle]
     * @param {string[]} [options.modalIDs]
     */
    createCollector(source, options = {}) {
        const id = typeof source == 'string' ? source : source.id;
        const collector = new InteractionCollector(options);

        this._setCollector(id, collector);
        for (const modalID of options.modalIDs ?? []) this._setCollector(modalID, collector);

        collector.once('end', (reason) => {
            this._deleteCollector(id, collector);
            for (const modalID of options.modalIDs ?? []) this._deleteCollector(modalID, collector);

            this.log({
                level: this.LogLevels.DEBUG,
                type: this.LogTypes.COLLECTOR_ENDED,
                data: { id, reason }
            });
        });

        this.log({
            level: this.LogLevels.DEBUG,
            type: this.LogTypes.COLLECTOR_CREATED,
            data: { id, modalIDs: options.modalIDs ?? [] }
        });

        return collector;
    }

    /**
     * Overwrite Discord's command lists with the local interaction command definitions.
     * This runs on startup and can also be called from the staff/debug command.
     */
    async syncCommands() {
        const applicationID = process.env.CLIENT_ID ?? process.env.APPLICATION_ID ?? process.env.APP_ID ?? this._bot.user?.id;
        if (!applicationID) throw new Error('Cannot sync interaction commands without an application ID or bot user ID.');
        const commands = Object.values(this.commandDefinitions);

        const syncedCommands = await discordRequest('PUT', `/api/v10/applications/${applicationID}/commands`, commands);
        const result = {
            commands: syncedCommands.map(command => this._getCommandKey(command.type, command.name))
        };

        this.log({
            level: this.LogLevels.INFO,
            type: this.LogTypes.COMMAND_SYNC_COMPLETED,
            data: result
        }, true);

        return result;
    }

    _getCommandKey(type, name) {
        return `${type ?? ApplicationCommandTypes.CHAT_INPUT}:${name}`;
    }

    async _handleUnknownInteraction(interaction) {
        this.log({
            level: this.LogLevels.DEBUG,
            type: this.LogTypes.INTERACTION_UNKNOWN,
            data: this._getInteractionLogData(interaction)
        });
    }

    _getInteractionLogData(interaction) {
        return {
            interactionID: interaction?.id,
            interactionType: interaction?.type,
            commandType: interaction?.data?.type,
            componentType: interaction?.data?.component_type,
            name: interaction?.data?.name,
            customID: interaction?.data?.custom_id,
            targetID: interaction?.data?.target_id,
            guildID: interaction?.guildID,
            channelID: interaction?.channel?.id,
            messageID: interaction?.message?.id,
            userID: this._getInteractionUser(interaction)?.id
        };
    }

    _getInteractionUser(interaction) {
        return interaction.user || interaction.member?.user;
    }

    _getInteractionTarget(interaction) {
        const targetID = interaction?.data?.target_id;
        const resolved = interaction?.data?.resolved;

        if (!targetID || !resolved) return undefined;

        return resolved.users?.get?.(targetID) ?? resolved.users?.[targetID]
            ?? resolved.members?.get?.(targetID) ?? resolved.members?.[targetID]
            ?? resolved.messages?.get?.(targetID) ?? resolved.messages?.[targetID];
    }

    _setCollector(id, collector) {
        this.collectors[id] = collector;
    }

    _getCollector(id) {
        return id ? this.collectors[id] : undefined;
    }

    _deleteCollector(id, collector) {
        if (this.collectors[id] == collector) delete this.collectors[id];
    }

    state() {
        return {
            ...super.state(),
            routes: Object.keys(this.routes),
            commandDefinitions: Object.keys(this.commandDefinitions),
            collectors: Object.keys(this.collectors)
        };
    }
};

class InteractionCollector extends EventEmitter {
    constructor({ filter, time, idle } = {}) {
        super();
        this.filter = filter;
        this.ended = false;
        this.idleTimeout = idle;

        if (time) this.time = setTimeout(() => this.stop('time'), time);
        if (idle) this.idle = setTimeout(() => this.stop('idle'), idle);
    }

    async interact(interaction, user) {
        if (this.ended) return await interaction.createMessage(toEphemeral('🚫 **|** This interaction is no longer active!'));
        if (this.filter && !this.filter(interaction, user)) {
            return await interaction.createMessage(toEphemeral('🚫 **|** You cannot use this interaction!'));
        }

        for (const listener of this.listeners('collect')) {
            await listener(interaction.data, interaction, user);
        }

        if (this.idleTimeout) {
            clearTimeout(this.idle);
            this.idle = setTimeout(() => this.stop('idle'), this.idleTimeout);
        }
    }

    stop(reason = 'manual') {
        if (this.ended) return;
        this.ended = true;

        clearTimeout(this.time);
        clearTimeout(this.idle);
        this.emit('end', reason);
        this.removeAllListeners();
    }
}

function discordRequest(method, path, data) {
    const body = data ? JSON.stringify(data) : undefined;

    return fetch(`https://discord.com${path}`, {
        method,
        headers: {
            Authorization: `Bot ${process.env.BOT_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body
    }).then(async response => {
        const text = await response.text();
        const result = text ? JSON.parse(text) : undefined;

        if (!response.ok) throw new Error(`Discord command sync failed (${response.status}): ${text}`);
        return result;
    });
}
