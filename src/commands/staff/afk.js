const Command = require('../Command.js');
const { isManager, isAdmin, isOwner, isHelper } = require('../../utils/permissions.js');

module.exports = new Command({
    alias: ['afk'],

    group: "Staff",

    auth: require('../../utils/permissions.js').isStaff,

    usage: "snail afk",

    description: "Toggle your presence on the member list!",

    execute: async function () {
        const MEMBER = this.message.member;
        let role;

        if (isOwner(MEMBER)) role = this.config.roles.ownerhoist;
        else if (isAdmin(MEMBER)) role = this.config.roles.adminhoist;
        else if (isManager(MEMBER)) role = this.config.roles.managerhoist;
        else if (isHelper(MEMBER)) role = this.config.roles.helperhoist;    // Not gona make it a default case just in case
        else {
            await this.error("you do not have permission to use this command!");
            return;
        }

        if (MEMBER.roles.includes(role)) {
            await MEMBER.removeRole(role, "Snail afk removed");
            await this.send("You have been removed from the member list!");
        } else {
            await MEMBER.addRole(role, "Snail afk added");
            await this.send("You have been added to the member list!");
        }
    },
});
