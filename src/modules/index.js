import { LogLevels, LogLevelWeights } from '../systems/logger/index.js';

const ModuleIDPattern = /^[a-z_]+$/;

export { LogLevels, LogLevelWeights };

export class Module {
    static DefaultLogLevel = LogLevels.Info;

    #commands;
    #components;
    #description;
    #enabled;
    #events;
    #id;
    #logLevel;
    #logsLimit;
    #logger;
    #modals;
    #name;
    #sequenceNumber;
    #databases;
    #toggleable;

    constructor({ databases, id, name, description = '', enabled = true, logsLimit, logging, toggleable = true }) {
        if (!ModuleIDPattern.test(id)) {
            throw new Error(`Invalid module id: ${id}`);
        }

        if (!Number.isInteger(logsLimit) || logsLimit <= 0) {
            throw new Error('Module logsLimit must be a positive integer.');
        }

        this.#databases = databases;
        this.#id = id;
        this.#name = name;
        this.#description = description;
        this.#enabled = enabled;
        this.#toggleable = toggleable;
        this.#sequenceNumber = 0;
        this.#logLevel = this.constructor.DefaultLogLevel;
        this.#logsLimit = logsLimit;
        this.#logger = logging.createLogger({
            level: this.#logLevel,
            sourceID: id
        });
        this.#commands = [];
        this.#components = new Map();
        this.#events = new Map();
        this.#modals = new Map();
    }

    get id() {
        return this.#id;
    }

    get name() {
        return this.#name;
    }

    get description() {
        return this.#description;
    }

    get enabled() {
        return this.#enabled;
    }

    get logLevel() {
        return this.#logLevel;
    }

    get toggleable() {
        return this.#toggleable;
    }

    get logsLimit() {
        return this.#logsLimit;
    }

    get logsSize() {
        return this.getLogs().length;
    }

    get logger() {
        return this.#logger;
    }

    get active() {
        return this.#enabled;
    }

    get interactionRoutes() {
        return {
            commands: this.#commands,
            components: this.#components,
            modals: this.#modals
        };
    }

    get events() {
        return this.#events;
    }

    async getConfig(key) {
        const doc = await this.#databases.snail.mongo.Config.findById(`${this.#id}_${key}`).lean();

        return doc?.value;
    }

    async setConfig(key, value) {
        const configKey = `${this.#id}_${key}`;
        const deleting = value === null || value === undefined;
        const timer = this.#logger.time(deleting ? 'module.config.deleted' : 'module.config.updated', { key });

        try {
            if (deleting) {
                await this.#databases.snail.mongo.Config.deleteOne({ _id: configKey });
                timer.end();
                return;
            }

            await this.#databases.snail.mongo.Config.updateOne(
                { _id: configKey },
                { $set: { value } },
                { upsert: true }
            );
            timer.end();
        } catch (error) {
            timer.fail(error);
            throw error;
        }
    }

    async init(context) {
        if (this.#toggleable) {
            const enabled = await this.getConfig('enabled');
            if (typeof enabled === 'boolean') {
                this.#enabled = enabled;
            }
        }

        const logLevel = await this.getConfig('log_level');
        if (typeof logLevel === 'string') {
            this.#setLogLevel(logLevel);
        }

        if (this.#enabled) {
            await this.onEnable(context);
        }

        this.#logger.info('module.initialized', {
            enabled: this.#enabled,
            logLevel: this.#logLevel
        });
    }

    inactiveMessage() {
        return `${this.#name} module is disabled.`;
    }

    async enable(context) {
        if (!this.#toggleable) {
            return;
        }

        this.#enabled = true;
        await this.setConfig('enabled', true);
        await this.onEnable(context);
        this.#logger.info('module.enabled');
    }

    async disable() {
        if (!this.#toggleable) {
            return;
        }

        this.#enabled = false;
        await this.setConfig('enabled', false);
        await this.onDisable();
        this.#logger.info('module.disabled');
    }

    async setLogLevel(level) {
        const previousLogLevel = this.#logLevel;

        this.#setLogLevel(level);
        await this.setConfig('log_level', this.#logLevel);
        this.#logger.info('module.log_level_updated', {
            previousLogLevel,
            logLevel: this.#logLevel
        });
    }

    async onEnable() {}

    async onDisable() {}

    addCommand({ auth, autocomplete, cooldown, definition, handle, staff }) {
        this.#commands.push({
            auth,
            autocomplete,
            cooldown,
            definition,
            handle,
            module: this,
            staff
        });
    }

    addComponent(customID, handle, { allowDisabled, auth } = {}) {
        this.#components.set(customID, {
            allowDisabled,
            auth,
            handle,
            module: this
        });
    }

    addModal(customID, handle, { allowDisabled, auth } = {}) {
        this.#modals.set(customID, {
            allowDisabled,
            auth,
            handle,
            module: this
        });
    }

    addEvent(event, handle) {
        const handlers = this.#events.get(event) ?? [];

        handlers.push(handle);
        this.#events.set(event, handlers);
    }

    getLogs() {
        return this.#logger.getEntries();
    }

    createLogID(action) {
        this.#sequenceNumber++;
        return `${this.#id}.${action}.${this.#sequenceNumber}`;
    }

    state() {
        return {
            id: this.#id,
            name: this.#name,
            description: this.#description,
            toggleable: this.#toggleable,
            enabled: this.#enabled,
            logLevel: this.#logLevel,
            logsLimit: this.#logsLimit,
            logsSize: this.logsSize
        };
    }

    panelComponents() {
        return [];
    }

    #setLogLevel(level) {
        this.#validateLogLevel(level);
        this.#logLevel = level;
        this.#logger.setLevel(level);
    }

    #validateLogLevel(level) {
        if (LogLevelWeights[level] === undefined) {
            throw new Error(`${this.#name} module tried to use invalid log level "${level}".`);
        }
    }
}

export class ModuleRegistry {
    #modules;

    constructor(modules) {
        this.#modules = new Map();

        for (const module of modules) {
            if (this.#modules.has(module.id)) {
                throw new Error(`Duplicate module id: ${module.id}`);
            }

            this.#modules.set(module.id, module);
        }
    }

    get values() {
        return this.#modules.values();
    }

    get sorted() {
        return [...this.#modules.values()].sort((left, right) => left.id.localeCompare(right.id));
    }

    get commands() {
        return this.sorted.flatMap((module) => module.interactionRoutes.commands);
    }

    get components() {
        return collectRoutes(this.#modules.values(), 'components');
    }

    get modals() {
        return collectRoutes(this.#modules.values(), 'modals');
    }

    get(id) {
        return this.#modules.get(id);
    }

    async init() {
        for (const module of this.#modules.values()) {
            await module.init();
        }
    }

    async enable(module, context) {
        await module.enable(context);
    }

    async disable(module) {
        await module.disable();
    }

    async dispatch(event, ...args) {
        for (const module of this.#modules.values()) {
            if (!module.active) {
                continue;
            }

            const handlers = module.events.get(event) ?? [];

            for (const handler of handlers) {
                await handler(...args);
            }
        }
    }
}

function collectRoutes(modules, routeType) {
    const routes = new Map();

    for (const module of modules) {
        for (const [key, route] of module.interactionRoutes[routeType]) {
            if (routes.has(key)) {
                throw new Error(`Duplicate interaction route: ${key}`);
            }

            routes.set(key, route);
        }
    }

    return routes;
}
