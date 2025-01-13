module.exports = class UserInteraction {
    constructor(args) {
        this.name = args.name;
        this.ownerOnly = !!args.ownerOnly;
        this.execute = args.execute;
    }
};
