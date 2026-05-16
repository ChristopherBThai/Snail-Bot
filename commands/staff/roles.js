const Command = require('../Command');
const { hasManagerPerms } = require('../../util');

const MAX_SECTION_SIZE = 1900;

module.exports = new Command({
    aliases: ['roles'],
    group: 'Staff',
    auth: hasManagerPerms,
    usage: 'roles',
    description: 'View the amount of users assigned to each role!',
    execute: async function (ctx) {
        const guild = ctx.message.channel.guild;
        await guild.fetchAllMembers(120000);

        const roleMap = {};

        for (const [id, { name, position }] of guild.roles) {
            roleMap[id] = { name, position, members: 0 };
        }

        for (const [, { roles }] of guild.members) {
            for (const id of roles) roleMap[id].members++;
        }

        const totalMembers = guild.members.size;
        const totalRoles = Object.keys(roleMap).length;
        const totalRoleAssignments = Object.values(roleMap).reduce((total, role) => total + role.members, 0);

        const roles = Object.values(roleMap)
            .sort((a, b) => b.position - a.position)
            .map(role => `${role.members.toLocaleString().padStart(7, ' ')}  ${role.name}\n`);

        let text =
            `Members: ${totalMembers.toLocaleString()}\n` +
            `Roles: ${totalRoles.toLocaleString()}\n` +
            `Role Assignments: ${totalRoleAssignments.toLocaleString()}\n\n` +
            '  Count  Role\n';
        for (const role of roles) {
            if (text.length + role.length > MAX_SECTION_SIZE) {
                await ctx.send(`\`\`\`\n${text}\`\`\``);
                text = role;
            } else {
                text += role;
            }
        }

        if (text) await ctx.send(`\`\`\`\n${text}\`\`\``);
    },
});
