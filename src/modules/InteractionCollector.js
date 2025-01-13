const EventEmitter = require('eventemitter3');
const { ephemeralInteractionResponse } = require('../utils/sender');

module.exports = class InteractionCollector extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'interactioncollector',
            name: 'Interaction Collector',
            description: `Handles message component interactions.`,
            toggleable: true,
        });

        this.listeners = {};

        this.addEvent('interactionCreate', this.onInteraction);
    }

    async onInteraction(interaction) {
        const user = interaction.user || interaction.member?.user;
        let listener = this.listeners[interaction.message?.id] || this.listeners[interaction.message?.interaction?.id];
        // Handle modal interactions manually. It does not contain message or interaction id
        if (!listener && interaction.type === 5) {
            listener = this.listeners[interaction.data.custom_id];
            interaction.data.isModal = true;
        }
        listener?.interact(interaction, user);
    }

    create(msg, filter, opt = {}) {
        const id = msg.id || msg;
        delete this.listeners[id];
        const emitter = new InteractionEventEmitter(filter, opt);
        emitter.on('end', () => delete this.listeners[id]);
        this.listeners[id] = emitter;
        return emitter;
    }
};

class InteractionEventEmitter extends EventEmitter {
    constructor(filter, { time = null, idle = null }) {
        super();
        this.filter = filter;
        this.ended = false;
        this.idleTimeout = idle;

        if (time) this.time = setTimeout(() => this.stop('time'), time);
        if (idle) this.idle = setTimeout(() => this.stop('idle'), idle);
    }

    checkFilter(user) {
        if (!this.filter) return true;
        return this.filter(user);
    }

    async interact(interaction, user) {
        if (!this.checkFilter(user)) {
            const msg = `🚫 **|** You cannot use this button!`;
            const ephemeralMsg = ephemeralInteractionResponse(msg);
            return await interaction.createMessage(ephemeralMsg);
        }
        if (this.ended) {
            const msg = `🚫 **|** This button is no longer active!`;
            const ephemeralMsg = ephemeralInteractionResponse(msg);
            return await interaction.createMessage(ephemeralMsg);
        }

        this.emit('collect', interaction.data, interaction, user);

        if (this.idleTimeout) {
            clearTimeout(this.idle);
            this.idle = setTimeout(() => this.stop('idle'), this.idleTimeout);
        }
    }

    stop(reason) {
        if (this.ended) return;
        this.ended = true;

        if (this.time) {
            clearTimeout(this.time);
            this.time = null;
        }

        if (this.idle) {
            clearTimeout(this.idle);
            this.idle = null;
        }

        this.emit('end', reason);
        this.removeAllListeners();
    }
}
