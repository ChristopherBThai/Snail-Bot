const Command = require('../Command.js');
const { parseUserID } = require('../../utils/global.js');
const { getName } = require('../../utils/global.js');

module.exports = new Command({
    alias: ['friend', 'fren', 'unfriend', 'unfren', 'friends', 'frens'],

    group: 'Staff',

    auth: require('../../utils/permissions.js').isStaff,

    usage: 'snail [friend|unfriend|friends] {...users}',

    description: 'Manage your friends! Friends are not warned when mentioning the staff they are friends with.',

    examples: ['snail friend <@729569334153969705> 210177401064390658', 'snail frens'],

    execute: async function () {
        switch (this.message.command) {
            case 'friend':
            case 'fren':
            case 'unfriend':
            case 'unfren': {
                const friends = this.message.args.map((user) => parseUserID(user)).filter((user) => user);

                if (friends.length == 0) {
                    this.error('please list at least one valid friend!');
                    return;
                }

                const add = ['friend', 'fren'].includes(this.message.command);
                const operation = add ? { $addToSet: { friends } } : { $pull: { friends: { $in: friends } } };

                await this.snail_db.User.updateOne({ _id: this.message.member.id }, operation, { upsert: true });
                await this.send(
                    `I ${add ? 'added' : 'removed'} ${friends.length} users ${add ? 'to' : 'from'} your friends list!`
                );
                break;
            }
            case 'friends':
            case 'frens': {
                const user = await this.snail_db.User.findById(this.message.author.id);
                const friends = user?.friends?.map((id) => `<@${id}>`).join(` `);

                if (!friends) {
                    this.error('you don’t have any friends yet! Kidnap some with `snail friend @user`!');
                    return;
                }

                let embed = {
                    author: {
                        name: `${getName(this.message.member)}'s Friends`,
                        icon_url: this.message.author.avatarURL,
                    },
                    description: friends,
                    timestamp: new Date(),
                    color: this.config.embedcolor,
                };

                await this.send({ embed });
                break;
            }
        }
    },
});
