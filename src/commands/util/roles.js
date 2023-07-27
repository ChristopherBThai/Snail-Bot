const Command = require('../Command.js');
const MAX_SECTION_SIZE = 1900;

module.exports = new Command({
    alias: ['roles'],

    group: "Util",

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: "snail roles",

    description: "View the amount of users assigned to each role!",

    execute: async function () {
        let result = await this.message.channel.guild.fetchAllMembers(120000);
        console.log(`Fetched ${JSON.stringify(result, null, 2)} members!`);
        const roleMap = {};

        for (const [id, { name, position }] of this.message.channel.guild.roles) {
            roleMap[id] = { name, position, members: 0 }
        }

        for (const [, { roles }] of this.message.channel.guild.members) {
            for (const id of roles) roleMap[id].members++;
        }

        const roles = Object.values(roleMap)
            .sort((a, b) => b.position - a.position)
            .map(role => `${role.name.padEnd(25, ' ')} (${role.members})\n`);

        let text = '';
        for (const roleText of roles) {
            if (text.length + roleText.length > MAX_SECTION_SIZE) {
                await this.send('```\n' + text + '```');
                text = roleText;
            } else {
                text += roleText;
            }
        }
        await this.send('```\n' + text + '```');
    },
});
