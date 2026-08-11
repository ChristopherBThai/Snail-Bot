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
        if (!listener) return;

        const transactionId = listener.getTransactionId(interaction.data);
        if (!transactionId) return await listener.interact(interaction, user);

        const elasticApm = this.bot.modules.elasticapm;
        const transaction = elasticApm?.startTransaction(`interaction:${transactionId}`, 'bot');
        let outcome = 'success';
        try {
            return await listener.interact(interaction, user);
        } catch (err) {
            outcome = 'failure';
            throw err;
        } finally {
            transaction?.setOutcome(outcome);
            transaction?.end();
        }
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
    constructor(filter, { time = null, idle = null, getTransactionId = () => undefined }) {
        super();
        this.filter = filter;
        this.ended = false;
        this.idleTimeout = idle;
        this.getTransactionId = getTransactionId;

        if (time) this.time = setTimeout(() => this.stop('time').catch(console.error), time);
        if (idle) this.idle = setTimeout(() => this.stop('idle').catch(console.error), idle);
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

        const completion = this.emitAndWait('collect', interaction.data, interaction, user);

        if (this.idleTimeout) {
            clearTimeout(this.idle);
            this.idle = setTimeout(() => this.stop('idle').catch(console.error), this.idleTimeout);
        }

        await completion;
    }

    // Mirror eventemitter3's dispatch semantics while retaining listener promises.
    emitAndWait(event, ...args) {
        const eventName = EventEmitter.prefixed ? `${EventEmitter.prefixed}${event}` : event;
        const handlers = this._events[eventName];
        if (!handlers) return Promise.resolve([]);

        const listeners = handlers.fn ? [handlers] : handlers.slice();
        const completions = [];
        for (const listener of listeners) {
            if (listener.once) this.removeListener(event, listener.fn, undefined, true);
            completions.push(listener.fn.call(listener.context, ...args));
        }
        return Promise.allSettled(completions).then((results) => {
            const failure = results.find((result) => result.status === 'rejected');
            if (failure) throw failure.reason;
            return results.map((result) => result.value);
        });
    }

    stop(reason) {
        if (this.ended) return this.endPromise;
        this.ended = true;

        if (this.time) {
            clearTimeout(this.time);
            this.time = null;
        }

        if (this.idle) {
            clearTimeout(this.idle);
            this.idle = null;
        }

        const endPromise = this.emitAndWait('end', reason);
        this.removeAllListeners();
        this.endPromise = endPromise;
        return this.endPromise;
    }
}
