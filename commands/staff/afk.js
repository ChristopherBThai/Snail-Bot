const Command = require('../Command');
const { isStaff, isHelper, isManager, isAdmin } = require('../../util');

module.exports = new Command({
    aliases: ['afk'],
    group: 'Staff',
    auth: isStaff,
    description: 'Toggle your presence on the member list.',
    execute: async function (ctx) {
        const MEMBER = ctx.message.member;
        let role;

        if (isAdmin(MEMBER)) role = ctx.bot.config.roles.admin.hoist;
        else if (isManager(MEMBER)) role = ctx.bot.config.roles.manager.hoist;
        else if (isHelper(MEMBER)) role = ctx.bot.config.roles.helper.hoist;
        else {
            await ctx.error('you do not have permission to use this command!');
            return;
        }

        // Note: If a staff member is shown as online and is promoted, then
        // `snail afk` won't work properly. I haven't recieved reports of this
        // happening, but I could fix it by adding an event listner for role
        // changes to remove hoist roles if permission roles are ever removed. 
        if (MEMBER.roles.includes(role)) {
            await MEMBER.removeRole(role, 'Snail afk removed');
            await ctx.send('You have been removed from the member list!');
        } else {
            await MEMBER.addRole(role, 'Snail afk added');
            await ctx.send('You have been added to the member list!');
        }
    },
});
