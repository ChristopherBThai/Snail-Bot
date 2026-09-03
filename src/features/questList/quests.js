export const QUEST_TYPES = Object.freeze({
    cookieBy: { name: 'Cookie', capacity: 5 },
    prayBy: { name: 'Pray', capacity: 10 },
    curseBy: { name: 'Curse', capacity: 10 },
    emoteBy: { name: 'Action', capacity: 5 },
});

const QUEST_PROJECTION = {
    _id: 1,
    userId: 1,
    slotIndex: 1,
    questType: 1,
    statKey: 1,
    startValue: 1,
    targetValue: 1,
    targetCount: 1,
    createdAt: 1,
    locked: 1,
};

export function createQuestSource({ UserQuest, redis }) {
    return {
        loadUserQuests,
        hydrate,
    };

    async function loadUserQuests(userIds) {
        return UserQuest.find(
            { userId: { $in: userIds }, questType: { $in: Object.keys(QUEST_TYPES) } },
            QUEST_PROJECTION,
        )
            .sort({ userId: 1, slotIndex: 1 })
            .lean();
    }

    async function hydrate(queued, knownDocuments) {
        if (!queued.length) {
            return {
                quests: [],
                removed: [],
                timing: { owoMongoMs: 0, owoRedisMs: 0 },
            };
        }

        const mongoStartedAt = performance.now();
        const documents = knownDocuments ?? (await loadQuests(queued.map((quest) => quest.questId)));
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
        const stats = await loadStats(valid.map(({ document }) => document));
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

    async function loadQuests(questIds) {
        return UserQuest.find({ _id: { $in: questIds } }, QUEST_PROJECTION).lean();
    }

    async function loadStats(quests) {
        if (!quests.length) return new Map();

        const keysByUser = new Map();
        for (const quest of quests) {
            if (!keysByUser.has(quest.userId)) keysByUser.set(quest.userId, new Set());
            keysByUser.get(quest.userId).add(quest.statKey);
        }

        const entries = [...keysByUser].map(([userId, statKeys]) => [userId, [...statKeys]]);
        const pipeline = redis.multi();
        for (const [userId, keys] of entries) pipeline.hmGet(`user_stats:${userId}`, keys);
        const results = await pipeline.execAsPipeline();

        const stats = new Map();
        for (const [index, [userId, keys]] of entries.entries()) {
            const values = results[index];
            stats.set(userId, new Map(keys.map((key, keyIndex) => [key, Number.parseInt(values[keyIndex], 10) || 0])));
        }

        return stats;
    }
}

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

function getRemovalReason(quest, document) {
    if (!document) return 'owoMissing';
    if (!QUEST_TYPES[document.questType]) return 'unsupportedType';
    if (document.locked === true) return 'locked';
    if (quest.userId !== document.userId) return 'userMismatch';
    if (quest.questCreatedAt.getTime() !== document.createdAt.getTime()) return 'rerolled';
}
