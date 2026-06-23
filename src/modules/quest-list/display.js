import {
    accentContainer,
    actionButton,
    actionRow,
    ButtonStyle,
    componentsMessage,
    ephemeralText,
    separator,
    textDisplay
} from '../../systems/discord/components.js';
import { lines } from '../../utils.js';
import { QuestListIDs, QuestTypes } from './constants.js';

export function buildQuestListMessage({ accentColor, capacity, emptyMessage, quests, questsByType }) {
    return {
        ...componentsMessage(
            accentContainer(
                accentColor,
                textDisplay(
                    lines(
                        '## Quest List',
                        'Use the buttons below to add your current Cookie, Pray, Curse, and Action quests.',
                        'Battle quests are not supported. Lock a quest in OwO to remove it from this list.'
                    )
                ),
                ...buildQuestTypeDisplays({ capacity, emptyMessage, quests, questsByType }),
                separator(),
                actionRow(
                    actionButton('Add My Quests', QuestListIDs.AddQuests, { style: ButtonStyle.Primary }),
                    actionButton('My Position', QuestListIDs.MyPosition),
                    actionButton('Visible Mentions', QuestListIDs.VisibleMentions),
                    actionButton('Toggle Reminders', QuestListIDs.ToggleReminders)
                )
            )
        ),
        allowed_mentions: { parse: [] }
    };
}

export function formatQuestPosition(questsByType, quest, capacity) {
    const quests = questsByType[quest.questType] ?? [];
    const position = quests.findIndex((queuedQuest) => queuedQuest.questID === quest.questID);
    const status =
        position < 0
            ? 'not currently queued'
            : position < capacity[quest.questType]
              ? 'visible now'
              : `position #${position + 1}`;

    return `**${QuestTypes[quest.questType].name}:** ${formatProgress(quest.count, quest.total)} ${status}`;
}

export function buildAddQuestsResponse({ capacity, newQuests, queuedQuests, questsByType }) {
    if (newQuests.length) {
        return ephemeralText(
            lines(
                `Added ${newQuests.length.toLocaleString()} quest${newQuests.length === 1 ? '' : 's'} to the Quest List:`,
                ...newQuests.map((quest) => `- ${formatQuestPosition(questsByType, quest, capacity)}`)
            )
        );
    }

    if (queuedQuests.length) {
        return ephemeralText(
            lines(
                'All of your eligible quests are already on the Quest List:',
                ...queuedQuests.map((quest) => `- ${formatQuestPosition(questsByType, quest, capacity)}`)
            )
        );
    }

    return ephemeralText('I could not find any unlocked, incomplete Cookie, Pray, Curse, or Action quests to add.');
}

export function buildUserPositionResponse({ capacity, questsByType, userQuests }) {
    return ephemeralText(lines(...userQuests.map((quest) => formatQuestPosition(questsByType, quest, capacity))));
}

export function buildVisibleMentionsResponse({ capacity, questsByType }) {
    const userIDs = new Set();

    for (const [type, quests] of Object.entries(questsByType)) {
        for (const quest of quests.slice(0, capacity[type])) {
            userIDs.add(quest.userID);
        }
    }

    return ephemeralText(
        [...userIDs].map((userID) => `<@${userID}>`).join(' ') || 'There are no visible users on the Quest List.'
    );
}

export function buildRemovedUsersNotice({ typeName, userIDs }) {
    return lines(
        `The ${typeName} list was updated and your queued quest(s) were removed. If you want your quest added back, please use the **Add My Quests** button.`,
        '',
        userIDs.map((id) => `<@${id}>`).join(' ')
    );
}

function buildQuestTypeDisplays({ capacity, emptyMessage, quests, questsByType }) {
    if (!quests.length) {
        return [textDisplay(emptyMessage)];
    }

    return Object.entries(QuestTypes)
        .map(([type, data]) => {
            const entries = questsByType[type] ?? [];
            if (!entries.length) {
                return undefined;
            }

            const visibleEntries = entries.slice(0, capacity[type]);
            const questLines = visibleEntries.map(
                (quest) => `${formatProgress(quest.count, quest.total)} <@${quest.userID}>`
            );

            return textDisplay(
                lines(`### ${data.emoji} ${data.name} List (${visibleEntries.length}/${entries.length})`, ...questLines)
            );
        })
        .filter(Boolean);
}

function formatProgress(count, total) {
    return `\`${String(count).padStart(String(total).length, '0')}/${total}\``;
}
