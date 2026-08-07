import {
    ApplicationCommandType,
    ApplicationIntegrationType,
    ButtonStyle,
    ComponentType,
    InteractionContextType,
    MessageFlags,
    SeparatorSpacingSize,
    TextInputStyle,
} from 'discord-api-types/v10';
import { hasOwnerAccess } from '../discord/auth.js';
import { disableComponents, getModalValue, getSelectValue, getTargetUser } from '../discord/interactions.js';
import { suppressMentions } from '../discord/messages.js';

const PANEL_IDLE_TIME = 120_000;

const IDS = Object.freeze({
    itemSelect: 'giveItem:item',
    editRecipient: 'giveItem:userId',
    recipientModal: 'giveItem:userModal',
    recipientInput: 'giveItem:userInput',
    give: 'giveItem:give',
    editCount: 'giveItem:changeCount',
    countModal: 'giveItem:countModal',
    countInput: 'giveItem:count',
});

const ITEMS = Object.freeze([
    {
        name: 'Wrapped Common Ticket',
        value: 'common_tickets',
        emoji: { id: '930641266159517726', name: 'wcticket' },
    },
    {
        name: 'Common Ticket',
        value: 'unwrapped_common_tickets',
        emoji: { id: '1311515524852875304', name: 'cticket' },
    },
    {
        name: 'Giveaway Ticket',
        value: 'giveaway_tickets',
        emoji: { id: '1065956261541195898', name: 'gticket' },
    },
    {
        name: 'Custom Pet Ticket',
        value: 'custom_pet_tickets',
        emoji: { id: '1311507704665346088', name: 'pticket' },
    },
    {
        name: 'Customized Command Ticket',
        value: 'customized_command_tickets',
        emoji: { id: '1326103077404672030', name: 'ccticket' },
    },
]);

const GIVE_ITEM_COMMAND_DEFINITION = {
    type: ApplicationCommandType.User,
    name: 'Give Item',
    integrationTypes: [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall],
    contexts: [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel],
};

/** @type {import('../packages.js').PackageSetup} */
export default function setup({ config, logging, rest, services, unavailable }) {
    const log = logging.createLogger('giveItem');
    const missing = [
        !config.users?.owner && 'users.owner (config)',
        ...(unavailable.owo.mysql ?? []),
        ...(unavailable.owo.api ?? []),
    ].filter(Boolean);
    const owoAPI = services.owo.api;
    const mysql = services.owo.mysql;
    let activePanel;
    let count = 1;
    let selected;

    return {
        name: 'Give Item Command',
        missing,
        commands: [
            {
                definition: GIVE_ITEM_COMMAND_DEFINITION,
                global: true,
                authorize: hasOwnerAccess,
                async handle({ interaction, respond }) {
                    const user = getTargetUser(interaction);

                    if (!user) {
                        await respond('Could not resolve that user.', { ephemeral: true });
                        return;
                    }

                    const previousPanel = activePanel;

                    const panel = {
                        token: interaction.token,
                        user,
                    };

                    await respond(renderPanel(panel), { ephemeral: true });
                    activePanel = panel;
                    touchPanel(panel);

                    if (previousPanel) {
                        closePanel(previousPanel, 'Replaced by a newer Give Item panel.');
                    }
                },
            },
        ],
        components: [
            interaction(IDS.itemSelect, selectItem),
            interaction(IDS.editRecipient, openUserModal),
            interaction(IDS.give, giveItem),
            interaction(IDS.editCount, openCountModal),
        ],
        modals: [interaction(IDS.recipientModal, changeUser), interaction(IDS.countModal, changeCount)],
    };

    function interaction(id, handle) {
        return { id, authorize: hasOwnerAccess, handle };
    }

    async function selectItem(context) {
        const panel = await getPanel(context);
        if (!panel) return;

        selected = getSelectValue(context.interaction);
        await context.update(renderPanel(panel));
        panel.token = context.interaction.token;
    }

    async function giveItem(context) {
        const panel = await getPanel(context);
        if (!panel) return;

        const user = panel.user;
        const item = ITEMS.find((value) => value.value === selected);
        const grantCount = count;
        if (!item) {
            await context.respond('Please select an item first.', { ephemeral: true });
            return;
        }

        await context.deferUpdate();
        panel.token = context.interaction.token;

        const timer = log.time();
        const uid = await getOwOUID(mysql, user.id);
        if (!uid) {
            await context.respond('This user does not have an OwO account.', { ephemeral: true });
            return;
        }
        timer.checkpoint('account');

        try {
            await addItem(mysql, uid, item.value, grantCount);
        } catch (error) {
            timer.checkpoint('mysql');
            timer.error('OwO item grant failed', {
                error,
                userId: user.id,
                item: item.value,
                count: grantCount,
            });
            throw error;
        }
        timer.checkpoint('mysql');

        const emoji = `<:${item.emoji.name}:${item.emoji.id}>`;
        try {
            await owoAPI.sendMessage(
                user.id,
                `🎁 **|** OwO, What's this? You have been gifted ${grantCount} ${emoji} **${item.name}**`,
            );
        } catch (error) {
            timer.checkpoint('owoApi');
            timer.error('OwO API notification failed after giving item', {
                error,
                userId: user.id,
                item: item.value,
                count: grantCount,
            });
            await context.respond(
                `⚠️ **|** ${grantCount} ${emoji} **${item.name}** was given to **${getUniqueName(user)}**, but the OwO API failed to notify them.`,
                { ephemeral: true },
            );
            return;
        }
        timer.checkpoint('owoApi');

        await context.respond(`🎁 **|** Sent ${grantCount} ${emoji} **${item.name}** to **${getUniqueName(user)}**.`, {
            ephemeral: true,
        });
        timer.checkpoint('discord');
        timer.info('Gave OwO item', {
            userId: user.id,
            item: item.value,
            count: grantCount,
        });
    }

    async function openCountModal(context) {
        const panel = await getPanel(context);
        if (!panel) return;

        await context.openModal({
            title: 'How many items?',
            customId: IDS.countModal,
            components: [
                {
                    type: ComponentType.Label,
                    label: 'Count',
                    component: {
                        type: ComponentType.TextInput,
                        customId: IDS.countInput,
                        style: TextInputStyle.Short,
                        required: true,
                        minLength: 1,
                        maxLength: 3,
                        value: String(count),
                    },
                },
            ],
        });
    }

    async function openUserModal(context) {
        const panel = await getPanel(context);
        if (!panel) return;

        await context.openModal({
            title: 'Change recipient',
            customId: IDS.recipientModal,
            components: [
                {
                    type: ComponentType.Label,
                    label: 'Discord user ID',
                    description: 'Enter the ID of the user who should receive the item.',
                    component: {
                        type: ComponentType.TextInput,
                        customId: IDS.recipientInput,
                        style: TextInputStyle.Short,
                        required: true,
                        minLength: 17,
                        maxLength: 20,
                    },
                },
            ],
        });
    }

    async function changeUser(context) {
        const panel = await getPanel(context);
        if (!panel) return;

        const userId = String(getModalValue(context.interaction, IDS.recipientInput) ?? '').trim();
        if (!/^\d{17,20}$/.test(userId)) {
            await context.respond('Enter a valid Discord user ID.', { ephemeral: true });
            return;
        }

        try {
            panel.user = await rest.get(rest.routes.user(userId));
        } catch (error) {
            if (error?.cause?.status !== 404) throw error;

            await context.respond('Could not find a Discord user with that ID.', { ephemeral: true });
            return;
        }

        await context.update(renderPanel(panel));
        panel.token = context.interaction.token;
    }

    async function changeCount(context) {
        const panel = await getPanel(context);
        if (!panel) return;

        const requestedCount = String(getModalValue(context.interaction, IDS.countInput) ?? '').trim();
        if (!/^\d{1,3}$/.test(requestedCount) || Number(requestedCount) < 1) {
            await context.respond('Enter a number from 1 to 999.', { ephemeral: true });
            return;
        }

        count = Number(requestedCount);
        await context.update(renderPanel(panel));
        panel.token = context.interaction.token;
    }

    async function getPanel(context) {
        if (activePanel) {
            touchPanel(activePanel);
            return activePanel;
        }

        const components = context.interaction.message?.components;
        if (components?.length) {
            await context.update(
                suppressMentions({
                    flags: MessageFlags.IsComponentsV2,
                    components: disableComponents(components),
                }),
            );
        }

        await context.respond('That Give Item panel has expired.', { ephemeral: true });
    }

    function touchPanel(panel) {
        clearTimeout(panel.timeout);
        panel.timeout = setTimeout(() => {
            if (activePanel !== panel) return;

            closePanel(panel, 'Panel expired.');
        }, PANEL_IDLE_TIME);
    }

    function closePanel(panel, notice) {
        clearTimeout(panel.timeout);
        if (activePanel === panel) activePanel = undefined;

        rest.editOriginalInteractionResponse(panel.token, renderPanel(panel, { disabled: true, notice })).catch(
            (error) => {
                log.warn('Could not disable Give Item panel', { error });
            },
        );
    }

    function renderPanel(panel, options) {
        return buildPanel({ user: panel.user, count, selected }, options);
    }
}

function buildPanel(state, { disabled = false, notice } = {}) {
    return suppressMentions({
        flags: MessageFlags.IsComponentsV2,
        components: [
            {
                type: ComponentType.Container,
                components: [
                    {
                        type: ComponentType.TextDisplay,
                        content: `## 🎁 Give Item${notice ? `\n-# ${notice}` : ''}`,
                    },
                    {
                        type: ComponentType.Section,
                        components: [
                            {
                                type: ComponentType.TextDisplay,
                                content: `-# Recipient\n<@${state.user.id}>`,
                            },
                        ],
                        accessory: {
                            type: ComponentType.Button,
                            customId: IDS.editRecipient,
                            label: 'Edit',
                            style: ButtonStyle.Secondary,
                            disabled,
                        },
                    },
                    {
                        type: ComponentType.Section,
                        components: [
                            {
                                type: ComponentType.TextDisplay,
                                content: `-# Count\n${state.count.toLocaleString()}`,
                            },
                        ],
                        accessory: {
                            type: ComponentType.Button,
                            customId: IDS.editCount,
                            label: 'Edit',
                            style: ButtonStyle.Secondary,
                            disabled,
                        },
                    },
                    {
                        type: ComponentType.TextDisplay,
                        content: '-# Item',
                    },
                    {
                        type: ComponentType.ActionRow,
                        components: [
                            {
                                type: ComponentType.StringSelect,
                                customId: IDS.itemSelect,
                                placeholder: 'Choose an item',
                                disabled,
                                options: ITEMS.map((item) => ({
                                    label: item.name,
                                    value: item.value,
                                    emoji: item.emoji,
                                    default: item.value === state.selected,
                                })),
                            },
                        ],
                    },
                    {
                        type: ComponentType.Separator,
                        divider: true,
                        spacing: SeparatorSpacingSize.Small,
                    },
                    {
                        type: ComponentType.ActionRow,
                        components: [
                            {
                                type: ComponentType.Button,
                                customId: IDS.give,
                                label: 'Give Item',
                                style: ButtonStyle.Primary,
                                disabled,
                            },
                        ],
                    },
                ],
            },
        ],
    });
}

function getUniqueName(user) {
    return user.discriminator && user.discriminator !== '0'
        ? `${user.username}#${user.discriminator}`
        : `@${user.username}`;
}

async function getOwOUID(mysql, userId) {
    const [rows] = await mysql.query('SELECT uid FROM user WHERE id = ?', [userId]);
    return rows[0]?.uid;
}

async function addItem(mysql, uid, item, count) {
    await mysql.query(
        'INSERT INTO user_item (uid, name, count) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE count = count + ?',
        [uid, item, count, count],
    );
}
