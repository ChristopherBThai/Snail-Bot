const Command = require('../Command.js');
const { isManager, isAdmin, isOwner, isHelper } = require('../../utils/permissions.js');

module.exports = new Command({
    alias: ['afk'],

    group: 'Staff',

    auth: require('../../utils/permissions.js').isStaff,

    usage: 'snail afk',

    description: 'Toggle your presence on the member list!',

    execute: async function (ctx) {
        const MEMBER = ctx.member;
        let role;

        if (isOwner(MEMBER)) role = ctx.config.roles.ownerhoist;
        else if (isAdmin(MEMBER)) role = ctx.config.roles.adminhoist;
        else if (isManager(MEMBER)) role = ctx.config.roles.managerhoist;
        else if (isHelper(MEMBER)) role = ctx.config.roles.helperhoist; // Not gona make it a default case just in case
        else {
            await ctx.error('you do not have permission to use this command!');
            return;
        }

        if (MEMBER?.roles.includes(role)) {
            await MEMBER.removeRole(role, 'Snail afk removed');
            await ctx.send('You have been removed from the member list!');
        } else {
            await MEMBER?.addRole(role, 'Snail afk added');
            await ctx.send('You have been added to the member list!');
        }
    },
});
