export const QUEST_TYPES = Object.freeze({
    cookieBy: { name: 'Cookie', capacity: 5 },
    prayBy: { name: 'Pray', capacity: 10 },
    curseBy: { name: 'Curse', capacity: 10 },
    emoteBy: { name: 'Action', capacity: 5 },
});

export function toQueuedQuest(quest, addedAt = new Date()) {
    return {
        userId: quest.userId,
        questId: String(quest._id),
        slotIndex: quest.slotIndex,
        questType: quest.questType,
        statKey: quest.statKey,
        startValue: quest.startValue,
        targetValue: quest.targetValue,
        targetCount: quest.targetCount,
        questCreatedAt: quest.createdAt,
        addedAt,
    };
}

export async function hydrateQueuedQuests(repository, queued, knownDocuments) {
    if (!queued.length) {
        return {
            quests: [],
            removed: [],
            timing: { owoMongoMs: 0, owoRedisMs: 0 },
        };
    }

    const mongoStartedAt = performance.now();
    const documents = knownDocuments ?? (await repository.getQuests(queued.map((quest) => quest.questId)));
    const owoMongoMs = knownDocuments ? 0 : Math.round(performance.now() - mongoStartedAt);
    const documentsById = new Map(documents.map((quest) => [String(quest._id), quest]));
    const valid = [];
    const removed = [];

    for (const quest of queued) {
        const document = documentsById.get(quest.questId);
        const reason = getRemovalReason(quest, document);
        if (reason) removed.push({ quest, reason });
        else valid.push({ quest, document });
    }

    const redisStartedAt = performance.now();
    const stats = await repository.getStats(valid.map(({ document }) => document));
    const owoRedisMs = Math.round(performance.now() - redisStartedAt);
    const quests = [];
    for (const { quest, document } of valid) {
        const current = stats.get(document.userId)?.get(document.statKey) ?? 0;
        if (current >= document.targetValue) {
            removed.push({ quest, reason: 'completed' });
            continue;
        }

        quests.push({
            ...toQueuedQuest(document, quest.addedAt),
            count: Math.max(0, Math.min(current - document.startValue, document.targetCount)),
            total: document.targetCount,
        });
    }

    return {
        quests,
        removed,
        timing: {
            owoMongoMs,
            owoRedisMs,
        },
    };
}

function getRemovalReason(quest, document) {
    if (!document) return 'owoMissing';
    if (!QUEST_TYPES[document.questType]) return 'unsupportedType';
    if (document.locked === true) return 'locked';
    if (quest.userId !== document.userId) return 'userMismatch';

    if (quest.questCreatedAt.getTime() !== document.createdAt.getTime()) return 'rerolled';
}
