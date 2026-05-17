const Module = require('./Module');

module.exports = class Logger extends Module {
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
