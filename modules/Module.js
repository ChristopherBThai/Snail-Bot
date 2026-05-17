const DEFAULT_LOGS_LIMIT = 50_000;

module.exports = class Module {
    static LogLevels = Object.freeze({
        TRACE: 'trace',
        DEBUG: 'debug',
        INFO: 'info',
        WARN: 'warn',
        ERROR: 'error'
    });

    static LogTypes = Object.freeze({
        MESSAGE: 'module.message'
    });

    /**
     * @param {import("../index")} bot
     * @param {object} args
     * @param {string} args.id Must only contain lowercase letters
     * @param {string} args.name
     * @param {string} args.description
     * @param {boolean} args.toggleable
     * @param {number} [args.logsLimit]
     */
    constructor(bot, args) {
        const { id, name, description, toggleable, logsLimit } = args;

        if (!/^[a-z_]+$/.test(id)) {
            throw new Error(`${name} Module has an invalid id "${id}". Module ids may only contain underscores or lowercase letters.`);
        }

        this._id = id;
        this._name = name;
        this._description = description;
        this._toggleable = toggleable;
        this._enabled = !this._toggleable;
        this._bot = bot;
        
        // Logs ring buffer
        this._logsLimit = logsLimit ?? DEFAULT_LOGS_LIMIT;
        this._logs = new Array(this._logsLimit);
        this._logsIndex = 0;
        this._logsSize = 0;

        this._bot.modules[this._id] = this;
        this._bot.once('ready', this._onceReady.bind(this));
    }

    /**
     * @param {string} event
     * @param {Function} handler
     */
    _addEvent(event, handler) {
        this._bot.on(event, async (...args) => {
            if (this._enabled) await handler.bind(this)(...args);
        });
    }

    /** One time initialization when bot is ready */
    async _onceReady() {
        if (this._toggleable) this._enabled = (await this._bot.getConfig(`${this._id}_enabled`)) ?? false;
    }

    /** Create a structured log under this module */
    log(entry) {
        if (typeof entry == 'string') {
            entry = {
                type: 'module.message',
                data: { message: entry }
            };
        }

        const { level, type, data } = entry;
        const log = {
            time: new Date().toISOString(),
            module: this._id,
            level: level ?? this.LogLevels.INFO,
            type: type ?? 'module.message',
            data: data ?? {}
        };

        this._logs[this._logsIndex] = log;
        this._logsIndex = (this._logsIndex + 1) % this._logsLimit;
        if (this._logsSize < this._logsLimit) this._logsSize++;
    }

    /** Get a snapshot of the current logs */
    getLogs() {
        const start = this._logsSize == this._logsLimit ? this._logsIndex : 0;
        const logs = [];

        for (let i = 0; i < this._logsSize; i++) {
            logs.push(this._logs[(start + i) % this._logsLimit]);
        }

        return logs;
    }

    /** Override if module needs to gracefully enable something */
    async enable() {
        if (!this._toggleable) return;
        await this._bot.setConfig(`${this._id}_enabled`, true);
        this._enabled = true;
    }

    /** Override if module needs to gracefully disable something */
    async disable() {
        if (!this._toggleable) return;
        await this._bot.setConfig(`${this._id}_enabled`, false);
        this._enabled = false;
    }

    get id() {
        return this._id;
    }

    get name() {
        return this._name;
    }

    get description() {
        return this._description;
    }

    get enabled() {
        return this._enabled;
    }

    get toggleable() {
        return this._toggleable;
    }

    get logsSize() {
        return this._logsSize;
    }

    get logsLimit() {
        return this._logsLimit;
    }

    get LogLevels() {
        return this.constructor.LogLevels;
    }

    get LogTypes() {
        return this.constructor.LogTypes;
    }
};
