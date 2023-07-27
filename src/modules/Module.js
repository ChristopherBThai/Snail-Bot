module.exports = class Module {
    /**
     * @param {import("../../index")} bot
     * @param {object} args
     * @param {string} args.id Must only contain lowercase letters
     * @param {string} args.name
     * @param {string} args.description
     * @param {boolean} args.toggleable
     */
    constructor(bot, args) {
        const { id, name, description, toggleable } = args;

        if (!/^[a-z]+$/.test(id)) {
            throw new Error(
                `${name} Module has an id "${id}" that contains non-lowercase a-z letters! The id must be all lowercase a-z letters.`
            );
        }

        this.id = id;
        this.name = name;
        this.description = description;
        this.toggleable = toggleable;
        this.enabled = !this.toggleable;
        this.bot = bot;

        this.bot.once('ready', this.onceReady.bind(this));
    }

    /**
     * @param {string} event
     * @param {Function} handler
     */
    addEvent(event, handler) {
        this.bot.on(event, async (...args) => {
            if (this.enabled) await handler.bind(this)(...args);
        });
    }

    async onceReady() {
        if (this.toggleable) this.enabled = (await this.bot.getConfiguration(`${this.id}_enabled`)) ?? false;
    }

    // Override if there are things that can configured
    getConfigurationOverview() {
        return `- Toggleable: ${this.toggleable}\n` + `- Enabled: ${this.enabled}`;
    }

    // Overrideable in case a module needs to gracefully enable/disable something
    async enable() {
        await this.bot.setConfiguration(`${this.id}_enabled`, true);
        this.enabled = true;
    }

    async disable() {
        await this.bot.setConfiguration(`${this.id}_enabled`, false);
        this.enabled = false;
    }
};
