/**
 * @typedef {object} InteractionContext
 * @property {import('eris').Interaction} interaction
 * @property {import('../index')} bot
 * @property {object} data
 * @property {import('eris').User | undefined} user
 * @property {import('eris').User | import('eris').Member | import('eris').Message | undefined} target
 * @property {import('eris').Member | undefined} member
 * @property {import('eris').TextChannel | import('eris').NewsChannel | import('eris').DMChannel | undefined} channel
 * @property {import('eris').Guild | undefined} guild
 * @property {(msg: string | object, file?: object) => Promise<void>} send
 * @property {(msg: string | object, file?: object) => Promise<void>} sendEphemeral
 * @property {(msg: string) => Promise<void>} error
 * @property {(...args: unknown[]) => Promise<void>} acknowledge
 * @property {(modal: object) => Promise<void>} createModal
 * @property {(msg: string | object, file?: object) => Promise<void>} editParent
 * @property {(msg: string | object, file?: object) => Promise<void>} editOriginal
 * @property {(source: string | { id: string }, options?: object) => import('../modules/InteractionHandler').InteractionCollector} createCollector
 */
module.exports = class InteractionCommand {
    /**
     * @param {object} args
     * @param {number} args.type
     * @param {string} args.name
     * @param {object} args.definition
     * @param {(ctx: InteractionContext) => boolean} [args.auth]
     * @param {(ctx: InteractionContext) => Promise<void>} args.execute
     */
    constructor(args) {
        this.type = args.type;
        this.name = args.name;
        this.definition = args.definition;
        this.auth = args.auth ?? (() => true);
        this.execute = args.execute;
    }
};
