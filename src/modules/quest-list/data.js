export function createQuestListData(databases) {
    const snailMongo = databases.snail.mongo;
    const owoMongo = databases.owo.mongo;
    const owoRedis = databases.owo.redis;

    return {
        async loadQueuedQuests() {
            return await snailMongo.Quest.find({}).sort({ addedAt: 1 }).lean();
        },

        async insertQueuedQuests(quests) {
            if (!quests.length) {
                return [];
            }

            const result = await snailMongo.Quest.bulkWrite(
                quests.map((quest) => ({
                    updateOne: {
                        filter: { questID: quest.questID },
                        update: { $setOnInsert: quest },
                        upsert: true
                    }
                })),
                { ordered: false }
            );
            const insertedIndexes = new Set(Object.keys(result.upsertedIds ?? {}).map((index) => Number(index)));

            return quests.filter((_quest, index) => insertedIndexes.has(index));
        },

        async deleteQueuedQuestsByIDs(questIDs) {
            if (questIDs.length) {
                await snailMongo.Quest.deleteMany({ questID: { $in: questIDs } });
            }
        },

        async getActiveUserQuests(userID, questTypes) {
            return await owoMongo.UserQuest.find({
                userId: String(userID),
                questType: { $in: questTypes }
            })
                .sort({ createdAt: 1, slotIndex: 1 })
                .lean();
        },

        async getQueuedOwOQuests(questIDs) {
            return await owoMongo.UserQuest.find({ _id: { $in: questIDs } }).lean();
        },

        async getStatsByUser(docs) {
            const statKeysByUser = {};

            for (const doc of docs) {
                statKeysByUser[doc.userId] ??= new Set();
                statKeysByUser[doc.userId].add(doc.statKey);
            }

            const statsByUser = {};
            for (const [userID, statKeys] of Object.entries(statKeysByUser)) {
                const keys = [...statKeys];
                const values = await owoRedis.client.hmGet(`user_stats:${userID}`, keys);

                statsByUser[userID] = Object.fromEntries(
                    keys.map((key, index) => [key, Number.parseInt(values?.[index], 10) || 0])
                );
            }

            return statsByUser;
        }
    };
}
