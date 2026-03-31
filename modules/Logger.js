module.exports = class Logger extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'logger',
            name: 'Logger',
            description: `Custom discord event logger.`,
            toggleable: true
        });
    }

    // TODO!!!
};