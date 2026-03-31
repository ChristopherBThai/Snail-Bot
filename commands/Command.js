/**
 * @typedef Context
 * @prop {import('eris').Message<import('eris').GuildTextableChannel>} message
 * @prop {string} name
 * @prop {[string]} args
 * @prop {import('../index')} bot
 * @prop {Object<string, import('mongoose').Model>} mongo
 * @prop {(msg: import('eris').MessageContent) => Promise<void>} send
 * @prop {(msg: import('eris').MessageContent, timeout?: number) => Promise<void>} error
 */

module.exports = class Command {
    /**
     * @param {object} args
     * @param {string[]} args.aliases
     * @param {string} args.group
     * @param {number} [args.cooldown]
     * @param {(member: import('eris').Member) => boolean} [args.auth]
     * @param {string} [args.usage]
     * @param {string} args.description
     * @param {string[]} [args.examples]
     * @param {(ctx: Context) => Promise<void>} args.execute
     */
    constructor(args) {
        this.aliases = args.aliases;
        this.group = args.group;
        this.cooldown = args.cooldown;
        this.auth = args.auth ?? (() => true);
        this.usage = args.usage;
        this.description = args.description;
        this.examples = args.examples;
        this.execute = args.execute;
    }

    get name() {
        return this.aliases[0];
    }
};