const UserInteraction = require('./UserInteraction.js');
const { parseEmoji, getUniqueUsername, getUid, validSnowflake, fetchUser } = require('../utils/global.js');
const { ephemeralInteractionResponse, owoCreateMessage } = require('../utils/sender');
const query = require('../databases/mysql/mysql.js');

const selectId = 'select_item';
const sendId = 'item_send';
const cancelId = 'item_cancel';
const changeCountId = 'change_count';
const changeUserId = 'change_user';
const countModalId = 'modal_count';
const userModalId = 'modal_user';
const giftEmoji = '🎁';

const items = [
    {
        name: 'Wrapped Common Ticket',
        value: 'common_tickets',
        emoji: '<:wcticket:930641266159517726>',
    },
    {
        name: 'Common Ticket',
        value: 'unwrapped_common_tickets',
        emoji: '<:cticket:1311515524852875304>',
    },
    {
        name: 'Giveaway Ticket',
        value: 'giveaway_tickets',
        emoji: '<:gticket:1065956261541195898>',
    },
    {
        name: 'Custom Pet Ticket',
        value: 'custom_pet_tickets',
        emoji: '<:pticket:1311507704665346088>',
    },
    {
        name: 'Customized Command Ticket',
        value: 'customized_command_tickets',
        emoji: '<:ccticket:1326103077404672030>',
    },
];

let previousCount = 1;
let previousSelection;

module.exports = new UserInteraction({
    name: 'Give Item',

    ownerOnly: true,

    execute: async function () {
        let count = previousCount;
        let user = this.target;
        const content = getContent(user, count);

        await this.sendEphemeral(content);

        const filter = (user) => this.interaction.user.id === user.id;
        const collector = this.createInteractionCollector(this.interaction, filter, { idle: 120000 });

        let selected = content.components[0].components[0].options.find((option) => option.default)?.value;
        collector.on('collect', async (data, interaction, _user) => {
            let modal, item;
            switch (data.custom_id) {
                case selectId:
                    selected = updateDefaultOption(content, data.values[0]);
                    await interaction.editParent(content);
                    return;
                case sendId:
                    item = items.find((item) => item.value === selected);
                    if (!item) {
                        await interaction.createMessage(
                            ephemeralInteractionResponse('🚫 **|** Please select an item first!')
                        );
                    } else {
                        await giveItem(interaction, user, item, count);
                    }
                    return;
                case cancelId:
                    await interaction.acknowledge();
                    collector.stop('stop');
                    return;
                case changeCountId:
                    modal = getCountModal(count, this.interaction.id);
                    await interaction.createModal(modal);
                    return;
                case changeUserId:
                    modal = getUserModal(user, this.interaction.id);
                    await interaction.createModal(modal);
                    return;
            }
            if (!data.isModal) {
                return;
            }
            data = data.components[0].components[0];
            let tempUser;
            switch (data.custom_id) {
                case userModalId:
                    if (!validSnowflake(data.value)) {
                        await interaction.createMessage(ephemeralInteractionResponse('🚫 **|** Invalid user!'));
                        return;
                    }
                    tempUser = await fetchUser(this.bot, data.value);
                    if (!tempUser) {
                        await interaction.createMessage(ephemeralInteractionResponse('🚫 **|** Invalid user!'));
                        return;
                    }
                    user = tempUser;
                    updateContent(content, user, count);
                    await interaction.editParent(content);
                    return;
                case countModalId:
                    if (!/^\d{1,3}$/.test(data.value)) {
                        await interaction.createMessage(ephemeralInteractionResponse('🚫 **|** Invalid number!'));
                        return;
                    }
                    count = data.value;
                    updateContent(content, user, count);
                    await interaction.editParent(content);
                    return;
            }
        });

        collector.on('end', async (reason) => {
            disableComponents(content);
            await this.interaction.editOriginalMessage(content);
        });
    },
});

function getContent(user, count) {
    const options = [];
    let selected;
    items.forEach((item) => {
        let previous = false;
        if (previousSelection === item.value) {
            selected = item.value;
            previous = true;
        }
        const emoji = parseEmoji(item.emoji);
        options.push({
            label: item.name,
            value: item.value,
            emoji: {
                id: emoji.id,
                name: emoji.name,
            },
            default: previous,
        });
    });
    const content = {
        components: [
            {
                type: 1,
                components: [
                    {
                        type: 3,
                        custom_id: selectId,
                        placeholder: 'Which item do you want to give?',
                        disabled: false,
                        options,
                    },
                ],
            },
            {
                type: 1,
                components: [
                    {
                        type: 2,
                        custom_id: sendId,
                        style: 1,
                        label: 'Give',
                    },
                    {
                        type: 2,
                        custom_id: cancelId,
                        style: 4,
                        label: 'Cancel',
                    },
                    {
                        type: 2,
                        custom_id: changeUserId,
                        style: 2,
                        label: 'Change User',
                    },
                    {
                        type: 2,
                        custom_id: changeCountId,
                        style: 2,
                        label: 'Change Count',
                    },
                ],
            },
        ],
    };
    updateContent(content, user, count);
    return content;
}

function updateDefaultOption(content, value) {
    previousSelection = value;
    content.components[0].components[0].options.forEach((option) => {
        option.default = option.value === value;
    });
    return value;
}

function updateContent(content, user, count) {
    previousCount = count;
    content.content = `${giftEmoji} **|** Which item do you want to give ${count} of to ${getUniqueUsername(user)}?`;
}

function disableComponents(content) {
    content.components[0].components[0].disabled = true;
    content.components[1].components[0].disabled = true;
    content.components[1].components[1].disabled = true;
    content.components[1].components[2].disabled = true;
    content.components[1].components[3].disabled = true;
}

async function giveItem(interaction, user, item, count = 1) {
    const uid = await getUid(user);
    const sql = `INSERT INTO user_item (uid, name, count) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE count = count + ?;`;
    await query(sql, [uid, item.value, count, count]);

    const msg = `${giftEmoji} **|** Sent ${count} ${item.emoji} **${item.name}** to **${getUniqueUsername(user)}**`;
    await interaction.createMessage(msg);

    const giftMsg = `${giftEmoji} **|** OwO, What's this? You have been gifted ${count} ${item.emoji} **${item.name}**`;
    await owoCreateMessage(user.id, giftMsg);
}

function getCountModal(count, modalId) {
    return {
        title: 'How many items?',
        custom_id: modalId,
        components: [
            {
                type: 1,
                components: [
                    {
                        type: 4,
                        custom_id: countModalId,
                        label: 'Enter a number',
                        style: 1,
                        placeholder: count,
                        required: true,
                    },
                ],
            },
        ],
    };
}

function getUserModal(user, modalId) {
    return {
        title: 'Who to send to?',
        custom_id: modalId,
        components: [
            {
                type: 1,
                components: [
                    {
                        type: 4,
                        custom_id: userModalId,
                        label: 'Enter a user id',
                        style: 1,
                        placeholder: user.id,
                        required: true,
                    },
                ],
            },
        ],
    };
}
