const Command = require('../Command.js');

module.exports = new Command({
    alias: ['snailroles'],

    group: 'Util',

    usage: 'snail snailroles [enable|disable]',

    description: 'Opt out/in snail given roles',

    execute: async function () {
        let enable;
        if (this.message.args[0]?.toLowerCase() === 'enable') {
            enable = true;
        } else if (this.message.args[0]?.toLowerCase() === 'enable') {
            enable = false;
        } else {
            await this.error('The command is `snail snailroles [enable|disable]`');
            return;
        }
        await this.snail_db.User.updateOne(
            { _id: this.message.member.id },
            { $set: { snailRoles: enable } },
            { upsert: true }
        );

        this.send(`You ${enable ? 'opt-in to' : 'opt-out of'} snail given roles!`);
    },
});
