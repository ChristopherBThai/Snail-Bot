module.exports = class Module {
    static DefaultLogsLimit = 50_000;

    static LogLevels = Object.freeze({
        TRACE: 'trace',
        DEBUG: 'debug',
        INFO: 'info',
        WARN: 'warn',
        ERROR: 'error'
    });

    static DefaultLogLevel = this.LogLevels.INFO;

    static LogLevelWeights = Object.freeze({
        [Module.LogLevels.TRACE]: 0,
        [Module.LogLevels.DEBUG]: 1,
        [Module.LogLevels.INFO]: 2,
        [Module.LogLevels.WARN]: 3,
        [Module.LogLevels.ERROR]: 4
    });

    static LogTypes = Object.freeze({
        MESSAGE: 'module.message',
        INITIALIZED: 'module.initialized',
        TOGGLED: 'module.toggled',
        LOG_LEVEL_UPDATED: 'module.log_level_updated'
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
        this._logLevel = this.constructor.DefaultLogLevel;
        this._bot = bot;
        
        // Logs ring buffer
        this._logsLimit = logsLimit ?? this.constructor.DefaultLogsLimit;
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
        const enabled = this._toggleable
            ? (await this._bot.getConfig(`${this._id}_enabled`)) ?? false
            : true;
        const logLevel = (await this._bot.getConfig(`${this._id}_log_level`)) ?? this.constructor.DefaultLogLevel;

        this._enabled = enabled;
        this._setLogLevel(logLevel);

        this.log({
            level: this.LogLevels.INFO,
            type: this.LogTypes.INITIALIZED,
            data: {
                enabled: this._enabled,
                logLevel: this._logLevel
            }
        }, true);
    }

    /** Create a structured log under this module */
    log(entry, force = false) {
        if (typeof entry == 'string') {
            entry = {
                type: this.LogTypes.MESSAGE,
                data: { message: entry }
            };
        }

        const { type, data } = entry;
        const level = entry.level ?? this.LogLevels.INFO;

        if (!type) {
            throw new Error(`${this._name} Module tried to log without a type.`);
        }

        if (this.LogLevelWeights[level] === undefined) {
            throw new Error(`${this._name} Module tried to log with invalid level "${level}".`);
        }

        if (!force && this.LogLevelWeights[level] < this.LogLevelWeights[this._logLevel]) return;

        const log = {
            time: new Date().toISOString(),
            module: this._id,
            level,
            type,
            data: data ?? {}
        };

        this._logs[this._logsIndex] = log;
        this._logsIndex = (this._logsIndex + 1) % this._logsLimit;
        if (this._logsSize < this._logsLimit) this._logsSize++;
    }

    _setLogLevel(level) {
        if (this.LogLevelWeights[level] === undefined) {
            throw new Error(`${this._name} Module tried to set invalid log level "${level}".`);
        }

        this._logLevel = level;
    }

    async setAndSaveLogLevel(level) {
        const previousLogLevel = this._logLevel;
        this._setLogLevel(level);

        this.log({
            level: this.LogLevels.INFO,
            type: this.LogTypes.LOG_LEVEL_UPDATED,
            data: {
                previousLogLevel,
                logLevel: this._logLevel
            }
        }, true);

        await this._bot.setConfig(`${this._id}_log_level`, this._logLevel);
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

    /** Get a JSON-serializable snapshot of the module's current state */
    state() {
        return {
            id: this._id,
            name: this._name,
            description: this._description,
            toggleable: this._toggleable,
            enabled: this._enabled,
            logLevel: this._logLevel,
            logsLimit: this._logsLimit,
            logsSize: this._logsSize
        };
    }

    /** Override if module needs to gracefully enable something */
    async enable() {
        if (!this._toggleable) return;
        await this._bot.setConfig(`${this._id}_enabled`, true);
        this._enabled = true;
        this.log({
            level: this.LogLevels.INFO,
            type: this.LogTypes.TOGGLED,
            data: { enabled: this._enabled }
        }, true);
    }

    /** Override if module needs to gracefully disable something */
    async disable() {
        if (!this._toggleable) return;
        await this._bot.setConfig(`${this._id}_enabled`, false);
        this._enabled = false;
        this.log({
            level: this.LogLevels.INFO,
            type: this.LogTypes.TOGGLED,
            data: { enabled: this._enabled }
        }, true);
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

    get logLevel() {
        return this._logLevel;
    }

    get LogLevels() {
        return this.constructor.LogLevels;
    }

    get LogLevelWeights() {
        return this.constructor.LogLevelWeights;
    }

    get LogTypes() {
        return this.constructor.LogTypes;
    }
};
