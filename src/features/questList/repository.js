import { QUEST_TYPES } from './quests.js';

const SETTING_PREFIX = 'questList:';
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

export function createQuestListRepository({ Quest, UserQuest, User, Setting, redis }) {
    return {
        loadQueuedQuests,
        insertQueuedQuests,
        deleteQueuedQuests,
        getUserQuests,
        getQuests,
        getStats,
        loadSettings,
        saveSetting,
        loadPrayCurseReminderUsers,
        savePrayCurseReminderEnabled,
        getPrayCurseCooldowns,
    };

    async function loadQueuedQuests() {
        return Quest.find({}).sort({ addedAt: 1 }).lean();
    }

    async function insertQueuedQuests(quests) {
        if (!quests.length) return [];

        const result = await Quest.bulkWrite(
            quests.map((quest) => ({
                updateOne: {
                    filter: { questId: quest.questId },
                    update: {
                        $setOnInsert: {
                            userId: quest.userId,
                            questId: quest.questId,
                            questCreatedAt: quest.questCreatedAt,
                            addedAt: quest.addedAt,
                        },
                    },
                    upsert: true,
                },
            })),
            { ordered: false },
        );
        const inserted = new Set(Object.keys(result.upsertedIds ?? {}).map(Number));
        return quests.filter((_quest, index) => inserted.has(index));
    }

    async function deleteQueuedQuests(questIds) {
        if (questIds.length) await Quest.deleteMany({ questId: { $in: questIds } });
    }

    async function getUserQuests(userIds) {
        return UserQuest.find(
            { userId: { $in: userIds }, questType: { $in: Object.keys(QUEST_TYPES) } },
            QUEST_PROJECTION,
        )
            .sort({ userId: 1, slotIndex: 1 })
            .lean();
    }

    async function getQuests(questIds) {
        return UserQuest.find({ _id: { $in: questIds } }, QUEST_PROJECTION).lean();
    }

    async function getStats(quests) {
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
            stats.set(userId, new Map(keys.map((key, index) => [key, Number.parseInt(values[index], 10) || 0])));
        }

        return stats;
    }

    async function loadSettings() {
        const settings = await Setting.find({ _id: { $regex: `^${SETTING_PREFIX}` } }).lean();
        return Object.fromEntries(settings.map((setting) => [setting._id.slice(SETTING_PREFIX.length), setting.value]));
    }

    async function saveSetting(name, value) {
        await Setting.updateOne({ _id: `${SETTING_PREFIX}${name}` }, { $set: { value } }, { upsert: true });
    }

    async function loadPrayCurseReminderUsers() {
        const users = await User.find({ 'reminders.luck': true }, { _id: 1 }).lean();
        return users.map((user) => user._id);
    }

    async function savePrayCurseReminderEnabled(userId, enabled) {
        await User.updateOne({ _id: userId }, { $set: { 'reminders.luck': enabled } }, { upsert: true });
    }

    async function getPrayCurseCooldowns(userIds) {
        const pipeline = redis.multi();
        for (const userId of userIds) pipeline.hGetAll(`cd_pray_${userId}`);
        return pipeline.execAsPipeline();
    }
}
