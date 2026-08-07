import {
    ButtonStyle,
    ChannelType,
    ComponentType,
    SelectMenuDefaultValueType,
    SeparatorSpacingSize,
    TextInputStyle,
} from 'discord-api-types/v10';
import { getModalValue, getModalValues } from '../../discord/interactions.js';
import { QUEST_TYPES } from './quests.js';
import { MAX_EMPTY_MESSAGE_LENGTH, MAX_VISIBLE_QUESTS } from './render.js';

export const SETTINGS_IDS = Object.freeze({
    channel: 'questList:channel',
    editCapacity: 'questList:editCapacity',
    capacityModal: 'questList:capacityModal',
    editRepostInterval: 'questList:editRepostInterval',
    repostIntervalModal: 'questList:repostIntervalModal',
    editEmptyMessage: 'questList:editEmptyMessage',
    emptyMessageModal: 'questList:emptyMessageModal',
    cookieCapacityInput: 'questList:cookieCapacity',
    prayCapacityInput: 'questList:prayCapacity',
    curseCapacityInput: 'questList:curseCapacity',
    actionCapacityInput: 'questList:actionCapacity',
    repostIntervalInput: 'questList:repostInterval',
    emptyMessageInput: 'questList:emptyMessage',
    manageQueue: 'questList:manageQueue',
    manageQueueModal: 'questList:manageQueueModal',
    queueTypeInput: 'questList:queueType',
    queueUsersInput: 'questList:queueUsers',
    forceRepost: 'questList:forceRepost',
});

export function buildOverview(state, running) {
    return [
        text(
            `### Quest List\n` +
                `**Channel:** ${state.channelId ? `<#${state.channelId}>` : 'Not configured'}\n` +
                `**Visible Limits:** Cookie ${state.capacity.cookieBy}, Pray ${state.capacity.prayBy}, ` +
                `Curse ${state.capacity.curseBy}, Action ${state.capacity.emoteBy}\n` +
                `**Repost Interval:** ${state.repostInterval.toLocaleString()} messages` +
                `\n**Queued Quests:** ${state.quests.length.toLocaleString()}`,
        ),
        spacer(),
        section('### Queue\nRemove users or clear a quest type.', SETTINGS_IDS.manageQueue, 'Manage'),
        section(
            '### Quest List Message\nRefresh and post a new Quest List message.',
            SETTINGS_IDS.forceRepost,
            'Repost',
            !running,
        ),
    ];
}

export function buildConfiguration(state) {
    return [
        text('### Channel'),
        {
            type: ComponentType.ActionRow,
            components: [
                {
                    type: ComponentType.ChannelSelect,
                    customId: SETTINGS_IDS.channel,
                    placeholder: 'Choose Quest List channel',
                    channelTypes: [ChannelType.GuildText],
                    ...(state.channelId
                        ? {
                              defaultValues: [
                                  {
                                      id: state.channelId,
                                      type: SelectMenuDefaultValueType.Channel,
                                  },
                              ],
                          }
                        : {}),
                },
            ],
        },
        spacer(),
        section(
            `### Visible Limits\nCookie ${state.capacity.cookieBy}, Pray ${state.capacity.prayBy}, ` +
                `Curse ${state.capacity.curseBy}, Action ${state.capacity.emoteBy}`,
            SETTINGS_IDS.editCapacity,
            'Edit',
        ),
        spacer(),
        section(
            `### Repost Interval\n${state.repostInterval.toLocaleString()} messages`,
            SETTINGS_IDS.editRepostInterval,
            'Edit',
        ),
        spacer(),
        section(`### Empty Message\n${state.emptyMessage}`, SETTINGS_IDS.editEmptyMessage),
    ];
}

export function buildCapacityModal(state) {
    return {
        title: 'Visible Limits',
        customId: SETTINGS_IDS.capacityModal,
        components: [
            {
                type: ComponentType.TextDisplay,
                content: `The four limits may total up to ${MAX_VISIBLE_QUESTS.toLocaleString()} visible quests.`,
            },
            numberInput('Cookie', SETTINGS_IDS.cookieCapacityInput, state.capacity.cookieBy),
            numberInput('Pray', SETTINGS_IDS.prayCapacityInput, state.capacity.prayBy),
            numberInput('Curse', SETTINGS_IDS.curseCapacityInput, state.capacity.curseBy),
            numberInput('Action', SETTINGS_IDS.actionCapacityInput, state.capacity.emoteBy),
        ],
    };
}

export function readCapacity(interaction) {
    const capacity = {
        cookieBy: readPositiveInteger(interaction, SETTINGS_IDS.cookieCapacityInput),
        prayBy: readPositiveInteger(interaction, SETTINGS_IDS.prayCapacityInput),
        curseBy: readPositiveInteger(interaction, SETTINGS_IDS.curseCapacityInput),
        emoteBy: readPositiveInteger(interaction, SETTINGS_IDS.actionCapacityInput),
    };
    const values = Object.values(capacity);
    return values.every(Boolean) && values.reduce((total, value) => total + value, 0) <= MAX_VISIBLE_QUESTS
        ? capacity
        : undefined;
}

export function buildRepostIntervalModal(state) {
    return {
        title: 'Repost Interval',
        customId: SETTINGS_IDS.repostIntervalModal,
        components: [numberInput('Messages between reposts', SETTINGS_IDS.repostIntervalInput, state.repostInterval)],
    };
}

export function readRepostInterval(interaction) {
    return readPositiveInteger(interaction, SETTINGS_IDS.repostIntervalInput);
}

export function buildEmptyMessageModal(state) {
    return {
        title: 'Empty Message',
        customId: SETTINGS_IDS.emptyMessageModal,
        components: [
            {
                type: ComponentType.Label,
                label: 'Message shown when no quests are queued',
                component: {
                    type: ComponentType.TextInput,
                    customId: SETTINGS_IDS.emptyMessageInput,
                    style: TextInputStyle.Paragraph,
                    required: true,
                    maxLength: MAX_EMPTY_MESSAGE_LENGTH,
                    value: state.emptyMessage,
                },
            },
        ],
    };
}

export function readEmptyMessage(interaction) {
    return String(getModalValue(interaction, SETTINGS_IDS.emptyMessageInput) ?? '').trim();
}

export function buildManageQueueModal() {
    return {
        title: 'Manage Quest List Queue',
        customId: SETTINGS_IDS.manageQueueModal,
        components: [
            {
                type: ComponentType.Label,
                label: 'Quest type',
                component: {
                    type: ComponentType.StringSelect,
                    customId: SETTINGS_IDS.queueTypeInput,
                    options: [
                        { label: 'All', value: 'all' },
                        ...Object.entries(QUEST_TYPES).map(([value, quest]) => ({ label: quest.name, value })),
                    ],
                },
            },
            {
                type: ComponentType.Label,
                label: 'Users',
                description: 'Leave empty to clear the selected quest type.',
                component: {
                    type: ComponentType.UserSelect,
                    customId: SETTINGS_IDS.queueUsersInput,
                    required: false,
                    minValues: 0,
                    maxValues: 25,
                },
            },
        ],
    };
}

export function readManageQueue(interaction) {
    return {
        questType: String(getModalValue(interaction, SETTINGS_IDS.queueTypeInput) ?? ''),
        userIds: new Set(getModalValues(interaction, SETTINGS_IDS.queueUsersInput)),
    };
}

export function buildQueueRemovalResponse(questType, requestedUsers, removed) {
    const typeName = questType === 'all' ? undefined : QUEST_TYPES[questType].name;
    const questLabel = `${typeName ? `${typeName} ` : ''}quest${removed.length === 1 ? '' : 's'}`;
    const requestedMentions = [...requestedUsers].map((userId) => `<@${userId}>`);

    if (!removed.length) {
        return requestedMentions.length
            ? `No queued ${typeName ? `${typeName} ` : ''}quests were found for ${requestedMentions.join(', ')}.`
            : `There were no queued ${typeName ? `${typeName} ` : ''}quests to clear.`;
    }

    const affectedUsers = new Set(removed.map((quest) => quest.userId));
    const lines = [
        `${requestedMentions.length ? 'Removed' : 'Cleared'} ${removed.length.toLocaleString()} queued ${questLabel} ` +
            `belonging to ${affectedUsers.size.toLocaleString()} user${affectedUsers.size === 1 ? '' : 's'}.`,
    ];

    if (questType === 'all') {
        const counts = new Map(Object.keys(QUEST_TYPES).map((type) => [type, 0]));
        for (const quest of removed) counts.set(quest.questType, (counts.get(quest.questType) ?? 0) + 1);
        lines.push(
            ...[...counts]
                .filter(([, count]) => count)
                .map(([type, count]) => `- ${QUEST_TYPES[type].name}: ${count.toLocaleString()}`),
        );
    }

    if (requestedMentions.length) {
        lines.push(`**Affected:** ${[...affectedUsers].map((userId) => `<@${userId}>`).join(', ')}`);
        const unmatched = [...requestedUsers].filter((userId) => !affectedUsers.has(userId));
        if (unmatched.length) {
            lines.push(`**No matching quests:** ${unmatched.map((userId) => `<@${userId}>`).join(', ')}`);
        }
    }

    return lines.join('\n');
}

function text(content) {
    return { type: ComponentType.TextDisplay, content };
}

function section(content, customId, label = 'Edit', disabled = false) {
    return {
        type: ComponentType.Section,
        components: [text(content)],
        accessory: {
            type: ComponentType.Button,
            customId,
            label,
            style: ButtonStyle.Secondary,
            disabled,
        },
    };
}

function spacer() {
    return {
        type: ComponentType.Separator,
        divider: false,
        spacing: SeparatorSpacingSize.Small,
    };
}

function numberInput(label, customId, value) {
    return {
        type: ComponentType.Label,
        label,
        component: {
            type: ComponentType.TextInput,
            customId,
            style: TextInputStyle.Short,
            required: true,
            maxLength: 2,
            value: String(value),
        },
    };
}

function readPositiveInteger(interaction, customId) {
    const value = String(getModalValue(interaction, customId) ?? '').trim();
    return /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : undefined;
}
