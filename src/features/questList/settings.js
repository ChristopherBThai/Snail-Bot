import {
    ButtonStyle,
    ChannelType,
    ComponentType,
    SelectMenuDefaultValueType,
    SeparatorSpacingSize,
    TextInputStyle,
} from 'discord-api-types/v10';
import { getModalValue } from '../../discord/interactions.js';
import { parseIdentifiers } from '../../utils/identifiers.js';
import { QUEST_TYPES } from './quests.js';
import { buildPositionResponse, MAX_EMPTY_MESSAGE_LENGTH, MAX_VISIBLE_QUESTS } from './render.js';

const MAX_TEXT_DISPLAY_LENGTH = 4_000;

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
    findUsers: 'questList:findUsers',
    findUsersModal: 'questList:findUsersModal',
    findUsersInput: 'questList:findUsersInput',
    manageQueue: 'questList:manageQueue',
    manageQueueModal: 'questList:manageQueueModal',
    queueTypeInput: 'questList:queueType',
    queueUsersInput: 'questList:queueUsers',
    forceRepost: 'questList:forceRepost',
});

export function buildOverview(state, { running, questUpdatesAvailable }) {
    return [
        text(
            `### Quest List\n` +
                `**Channel:** ${state.channelId ? `<#${state.channelId}>` : 'Not configured'}\n` +
                `**Visible Limits:** Cookie ${state.capacity.cookieBy}, Pray ${state.capacity.prayBy}, ` +
                `Curse ${state.capacity.curseBy}, Action ${state.capacity.emoteBy}\n` +
                `**Repost Interval:** ${state.repostInterval.toLocaleString()} messages` +
                `\n**Queued Quests:** ${state.quests.length.toLocaleString()}` +
                (questUpdatesAvailable ? '' : '\n**Quest Updates:** Unavailable'),
        ),
        spacer(),
        section(
            '### User Positions\nCheck the current Quest List positions for one or more users.',
            SETTINGS_IDS.findUsers,
            'Find',
            !questUpdatesAvailable,
        ),
        section(
            '### Queue\nRemove users or clear a quest type.',
            SETTINGS_IDS.manageQueue,
            'Manage',
            !questUpdatesAvailable,
        ),
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

export function buildFindUsersModal() {
    return {
        title: 'Find Quest List Users',
        customId: SETTINGS_IDS.findUsersModal,
        components: [
            {
                type: ComponentType.Label,
                label: 'Discord user IDs',
                description: 'Separate IDs with spaces or new lines.',
                component: {
                    type: ComponentType.TextInput,
                    customId: SETTINGS_IDS.findUsersInput,
                    style: TextInputStyle.Paragraph,
                    required: true,
                },
            },
        ],
    };
}

export function readFindUsers(interaction) {
    return parseUserIds(getModalValue(interaction, SETTINGS_IDS.findUsersInput));
}

export function buildUserPositionResponses(state, userIds) {
    return chunkSections(
        [...userIds].map((userId) =>
            state.questsByUser.has(userId)
                ? `### <@${userId}>\n${buildPositionResponse(state, userId)}`
                : `### <@${userId}>\nThis user does not have any quests on the Quest List.`,
        ),
    );
}

export function buildInvalidUserIdResponses(invalidValues) {
    return chunkSections(
        buildValueSections('Invalid Discord user IDs', invalidValues, (value) => {
            const text = String(value);
            const display = text.length <= 64 ? text : `${text.slice(0, 63)}…`;
            return `\`${display}\``;
        }),
    );
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
                label: 'Discord user IDs',
                description: 'Separate IDs with whitespace, or leave empty to clear the selected quest type.',
                component: {
                    type: ComponentType.TextInput,
                    customId: SETTINGS_IDS.queueUsersInput,
                    style: TextInputStyle.Paragraph,
                    required: false,
                },
            },
        ],
    };
}

export function readManageQueue(interaction) {
    return {
        questType: String(getModalValue(interaction, SETTINGS_IDS.queueTypeInput) ?? ''),
        ...parseUserIds(getModalValue(interaction, SETTINGS_IDS.queueUsersInput)),
    };
}

export function buildQueueRemovalResponses(questType, requestedUsers, removed) {
    const typeName = questType === 'all' ? undefined : QUEST_TYPES[questType].name;
    const questLabel = `${typeName ? `${typeName} ` : ''}quest${removed.length === 1 ? '' : 's'}`;

    if (!removed.length) {
        return requestedUsers.size
            ? chunkSections([
                  `No queued ${typeName ? `${typeName} ` : ''}quests were found for these users:`,
                  ...buildMentionSections('Requested', requestedUsers),
              ])
            : [`There were no queued ${typeName ? `${typeName} ` : ''}quests to clear.`];
    }

    const affectedUsers = new Set(removed.map((quest) => quest.userId));
    const lines = [
        `${requestedUsers.size ? 'Removed' : 'Cleared'} ${removed.length.toLocaleString()} queued ${questLabel} ` +
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

    const sections = [lines.join('\n')];
    if (requestedUsers.size) {
        sections.push(...buildMentionSections('Affected', affectedUsers));
        const unmatched = [...requestedUsers].filter((userId) => !affectedUsers.has(userId));
        if (unmatched.length) sections.push(...buildMentionSections('No matching quests', unmatched));
    }

    return chunkSections(sections);
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

function parseUserIds(value) {
    const { identifiers, invalid } = parseIdentifiers(value, (userId) =>
        /^\d{17,20}$/.test(userId) ? userId : undefined,
    );
    return { userIds: new Set(identifiers), invalidValues: invalid };
}

function chunkSections(sections) {
    const responses = [];
    let response = '';

    for (const section of sections) {
        const joined = response ? `${response}\n\n${section}` : section;
        if (joined.length <= MAX_TEXT_DISPLAY_LENGTH) {
            response = joined;
        } else {
            if (response) responses.push(response);
            response = section;
        }
    }

    if (response) responses.push(response);
    return responses;
}

function buildMentionSections(label, userIds) {
    return buildValueSections(label, userIds, (userId) => `<@${userId}>`);
}

function buildValueSections(label, values, formatValue) {
    const sections = [];
    let section = `**${label}:**`;

    for (const value of values) {
        const formatted = formatValue(value);
        const joined = `${section}${section.endsWith('**') ? ' ' : ', '}${formatted}`;
        if (joined.length <= MAX_TEXT_DISPLAY_LENGTH) {
            section = joined;
        } else {
            sections.push(section);
            section = `**${label} (continued):** ${formatted}`;
        }
    }

    if (!section.endsWith('**')) sections.push(section);
    return sections;
}
