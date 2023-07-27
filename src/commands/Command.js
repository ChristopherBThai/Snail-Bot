module.exports = class Command {
    constructor(args) {
        this.alias = args.alias;
        this.group = args.group;
        this.cooldown = args.cooldown;
        this.auth = args.auth ?? function () { return true; };
        this.usage = args.usage;
        this.description = args.description;
        this.examples = args.examples;
        this.execute = args.execute;
    }
};
