module.exports = class UserInteraction {
    constructor(args) {
        this.name = args.name;
        this.transactionId = args.transactionId;
        this.ownerOnly = !!args.ownerOnly;
        this.execute = args.execute;
    }
};
