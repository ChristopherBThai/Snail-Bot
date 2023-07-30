module.exports = class Command {
    /**
     * A command
     * @param {Object} args
     * @param {String[]} args.alias
     * @param {String} [args.group]
     * @param {Number} [args.cooldown]
     * @param {(member) => boolean} [args.auth]
     * @param {String} args.usage
     * @param {String} args.description
     * @param {String[]} [args.examples]
     * @param {(ctx: import("../modules/CommandHandler").Context) => Promise<void>} args.execute
     * @param {boolean} [args.componentOnly]
     */
    constructor(args) {
        this.alias = args.alias;
        this.group = args.group;
        this.cooldown = args.cooldown;
        this.auth = args.auth ?? (() => true);
        this.usage = args.usage;
        this.description = args.description;
        this.examples = args.examples;
        this.execute = args.execute;
        this.componentOnly = args.componentOnly;
    }
};
