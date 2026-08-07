import { ButtonStyle, ComponentType, MessageFlags, SeparatorSpacingSize } from 'discord-api-types/v10';
import { suppressMentions } from '../../discord/messages.js';
import { QUEST_TYPES } from './quests.js';

export const ADD_QUESTS_ID = 'questList:addQuests';
export const MY_POSITION_ID = 'questList:myPosition';
export const VISIBLE_MENTIONS_ID = 'questList:visibleMentions';
export const TOGGLE_REMINDERS_ID = 'questList:toggleReminders';
export const MAX_EMPTY_MESSAGE_LENGTH = 3_500;
export const MAX_VISIBLE_QUESTS = 50;

export function buildQuestListMessage(state) {
    const displays = [];

    for (const [type, details] of Object.entries(QUEST_TYPES)) {
        const quests = state.questsByType.get(type) ?? [];
        if (!quests.length) continue;

        const visible = quests.slice(0, state.capacity[type]);
        displays.push({
            type: ComponentType.TextDisplay,
            content:
                `### ${details.name} (${visible.length}/${quests.length})\n` +
                visible.map((quest) => `${formatProgress(quest)} <@${quest.userId}>`).join('\n'),
        });
    }

    return suppressMentions({
        flags: MessageFlags.IsComponentsV2,
        components: [
            {
                type: ComponentType.Container,
                components: [
                    {
                        type: ComponentType.TextDisplay,
                        content:
                            '## Quest List\n' +
                            'Add your current Cookie, Pray, Curse, and Action quests below.\n' +
                            '-# Battle quests are not supported. Lock or reroll a quest in OwO to remove it from this list.',
                    },
                    ...(displays.length
                        ? displays
                        : [{ type: ComponentType.TextDisplay, content: state.emptyMessage }]),
                    {
                        type: ComponentType.Separator,
                        divider: true,
                        spacing: SeparatorSpacingSize.Small,
                    },
                    {
                        type: ComponentType.ActionRow,
                        components: [
                            button('Add My Quests', ADD_QUESTS_ID, ButtonStyle.Primary),
                            button('My Position', MY_POSITION_ID),
                            button('Visible Mentions', VISIBLE_MENTIONS_ID),
                            button('Toggle Reminders', TOGGLE_REMINDERS_ID),
                        ],
                    },
                ],
            },
        ],
    });
}

export function buildAddQuestsResponse(state, userId, added) {
    if (added.length) {
        return (
            `Added ${added.length.toLocaleString()} quest${added.length === 1 ? '' : 's'} to the Quest List:\n` +
            added.map((quest) => `- ${formatPosition(state, quest)}`).join('\n')
        );
    }

    const queued = state.questsByUser.get(userId) ?? [];
    if (queued.length) {
        return (
            'All of your eligible quests are already on the Quest List:\n' +
            queued.map((quest) => `- ${formatPosition(state, quest)}`).join('\n')
        );
    }

    return 'I could not find any unlocked, incomplete Cookie, Pray, Curse, or Action quests to add.';
}

export function buildPositionResponse(state, userId) {
    const quests = state.questsByUser.get(userId) ?? [];
    if (!quests.length) return 'You do not have any quests on the Quest List.';

    return quests.map((quest) => formatPosition(state, quest)).join('\n');
}

export function buildVisibleMentionsResponse(state) {
    const userIds = new Set();
    for (const [type, quests] of state.questsByType) {
        for (const quest of quests.slice(0, state.capacity[type])) userIds.add(quest.userId);
    }

    return [...userIds].map((userId) => `<@${userId}>`).join(' ') || 'There are no visible users.';
}

export function notification(content, userIds) {
    return {
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { users: userIds },
        components: [{ type: ComponentType.TextDisplay, content }],
    };
}

function formatPosition(state, quest) {
    const quests = state.questsByType.get(quest.questType) ?? [];
    const index = quests.findIndex((candidate) => candidate.questId === quest.questId);
    const position = index < state.capacity[quest.questType] ? 'visible now' : `position #${index + 1}`;
    return `**${QUEST_TYPES[quest.questType].name}:** ${formatProgress(quest)} ${position}`;
}

function formatProgress(quest) {
    return `\`${String(quest.count).padStart(String(quest.total).length, '0')}/${quest.total}\``;
}

function button(label, customId, style = ButtonStyle.Secondary) {
    return { type: ComponentType.Button, customId, label, style };
}
