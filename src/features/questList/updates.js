import { hydrateQueuedQuests, QUEST_TYPES, toQueuedQuest } from './quests.js';
import { ADD_QUESTS_ID, buildQuestListMessage, MAX_EMPTY_MESSAGE_LENGTH, MAX_VISIBLE_QUESTS } from './render.js';

const DEFAULT_CAPACITY = Object.freeze(
    Object.fromEntries(Object.entries(QUEST_TYPES).map(([type, quest]) => [type, quest.capacity])),
);
const DEFAULT_REPOST_INTERVAL = 15;
const DEFAULT_EMPTY_MESSAGE = 'There are no quests!';

function createEmptyPendingState() {
    return {
        publish: false,
        repost: false,
        messageCount: 0,
        adds: new Map(),
        changes: [],
        refreshReasons: new Set(),
        timer: undefined,
    };
}

export function createQuestListUpdates({ repository, rest, log, isEnabled }) {
    const botId = String(rest.applicationId);
    const state = {
        channelId: undefined,
        capacity: { ...DEFAULT_CAPACITY },
        repostInterval: DEFAULT_REPOST_INTERVAL,
        emptyMessage: DEFAULT_EMPTY_MESSAGE,
        quests: [],
        questsByType: new Map(),
        questsByUser: new Map(),
    };
    let messageId;
    let messagesSinceRepost = 0;
    let updateRunning = false;
    let pending = createEmptyPendingState();
    let settingsLoaded = false;
    let queueLoaded = false;
    let queueLoading;

    return {
        state,
        activate,
        loadSettings,
        messageCreated,
        addQuests,
        setChannel,
        setCapacity,
        setRepostInterval,
        setEmptyMessage,
        removeQuests,
        forceRepost,
    };

    async function activate() {
        await loadPersistedSettings();
        await queueChange({ type: 'reloadQueue' }, { refreshReason: 'activate', repost: Boolean(state.channelId) });

        log.debug('Loaded Quest List settings', {
            channelId: state.channelId,
            capacity: state.capacity,
            repostInterval: state.repostInterval,
            customEmptyMessage: state.emptyMessage !== DEFAULT_EMPTY_MESSAGE,
            quests: state.quests.length,
        });

        if (!state.channelId) log.warn('Quest List channel is not configured');
    }

    async function loadSettings() {
        if (!repository) return;

        await loadPersistedSettings();
        if (!isEnabled() || !state.channelId) await loadQueue();
    }

    async function loadPersistedSettings() {
        if (!settingsLoaded) {
            const stored = await repository.loadSettings();
            if (typeof stored.channelId === 'string') state.channelId = stored.channelId;
            if (isCapacity(stored.capacity)) state.capacity = stored.capacity;
            if (isPositiveInteger(stored.repostInterval)) state.repostInterval = stored.repostInterval;
            if (
                typeof stored.emptyMessage === 'string' &&
                stored.emptyMessage.trim() &&
                stored.emptyMessage.length <= MAX_EMPTY_MESSAGE_LENGTH
            ) {
                state.emptyMessage = stored.emptyMessage;
            }
            settingsLoaded = true;
        }
    }

    async function loadQueue() {
        if (queueLoaded || !repository) return;

        queueLoading ??= repository.loadQueuedQuests().then((quests) => {
            setQuests(quests);
            queueLoaded = true;
        });

        try {
            await queueLoading;
        } finally {
            queueLoading = undefined;
        }
    }

    function messageCreated(message) {
        if (message.channelId !== state.channelId) return;

        if (isQuestListMessage(message)) {
            log.trace('Ignored current Quest List message', { messageId: message.id });
            return;
        }

        pending.messageCount++;
        log.trace('Received Quest List channel message', {
            messageId: message.id,
            userId: message.author?.id,
            bot: message.author?.bot === true,
            messagesSinceRepost: messagesSinceRepost + pending.messageCount,
            repostInterval: state.repostInterval,
        });

        requestUpdate({ refreshReason: 'channelMessages' });
    }

    function isQuestListMessage(message) {
        return (
            message.id === messageId || (message.author?.id === botId && hasCustomId(message.components, ADD_QUESTS_ID))
        );
    }

    function addQuests(userId) {
        const result = new Promise((resolve, reject) => {
            const request = pending.adds.get(userId) ?? { waiters: [] };
            request.waiters.push({ resolve, reject, timer: log.time() });
            pending.adds.set(userId, request);
        });
        requestUpdate({ refreshReason: 'addQuests' });
        return result;
    }

    function setChannel(channelId) {
        return queueChange(
            { type: 'channel', channelId },
            isEnabled() ? { refreshReason: 'channelChanged', repost: true } : undefined,
        );
    }

    function setCapacity(capacity) {
        return queueChange({ type: 'capacity', capacity }, { publish: isRunning() });
    }

    function setRepostInterval(repostInterval) {
        return queueChange({ type: 'repostInterval', repostInterval });
    }

    function setEmptyMessage(emptyMessage) {
        return queueChange({ type: 'emptyMessage', emptyMessage }, { publish: isRunning() });
    }

    async function removeQuests(questType, userIds) {
        await loadQueue();
        return queueChange({ type: 'remove', questType, userIds }, { refreshReason: 'manageQueue' });
    }

    function forceRepost() {
        return queueChange({ type: 'forceRepost' }, { refreshReason: 'forceRepost', repost: true });
    }

    function requestUpdate({ refreshReason, publish = false, repost = false } = {}) {
        pending.timer ??= log.time();
        if (refreshReason) {
            pending.refreshReasons.add(refreshReason);
        }
        pending.publish ||= publish;
        pending.repost ||= repost;

        if (updateRunning) {
            log.trace('Queued Quest List update', { publish, refreshReason, repost });
            return;
        }

        updateRunning = true;
        void runUpdates();
    }

    function queueChange(change, options) {
        const result = new Promise((resolve, reject) => {
            pending.changes.push({ ...change, resolve, reject });
        });
        requestUpdate(options);
        return result;
    }

    async function runUpdates() {
        try {
            while (hasPendingUpdate()) {
                const batch = takePendingUpdate();
                try {
                    const result = await processUpdate(batch);
                    batch.timer.checkpoint('processing');
                    batch.timer.trace('Processed Quest List update', {
                        reasons: batch.reasons,
                        additions: result.added,
                        removals: result.removed,
                        messages: batch.messageCount,
                        refreshed: batch.refresh,
                        published: result.published,
                    });
                } catch (error) {
                    rejectUpdate(batch, error);
                    batch.timer.checkpoint('processing');
                    batch.timer.error('Quest List update failed', {
                        error,
                        reasons: batch.reasons,
                    });
                }
            }
        } finally {
            updateRunning = false;
            if (hasPendingUpdate()) requestUpdate();
        }
    }

    function hasPendingUpdate() {
        return Boolean(
            pending.refreshReasons.size ||
                pending.publish ||
                pending.repost ||
                pending.messageCount ||
                pending.adds.size ||
                pending.changes.length,
        );
    }

    function takePendingUpdate() {
        pending.timer.checkpoint('queue');
        for (const request of pending.adds.values()) {
            for (const waiter of request.waiters) waiter.timer.checkpoint('queue');
        }
        const batch = {
            refresh: Boolean(pending.refreshReasons.size),
            publish: pending.publish,
            repost: pending.repost,
            messageCount: pending.messageCount,
            adds: pending.adds,
            changes: pending.changes,
            reasons: [...pending.refreshReasons],
            timer: pending.timer,
        };

        pending = createEmptyPendingState();
        return batch;
    }

    async function processUpdate(batch) {
        await applyConfigurationChanges(batch.changes);

        if (!batch.changes.some((change) => change.type === 'channel')) messagesSinceRepost += batch.messageCount;
        if (isRunning() && messagesSinceRepost >= state.repostInterval) {
            batch.repost = true;
            batch.refresh = true;
            batch.reasons.push('repostInterval');
        }

        let quests = state.quests;
        if (
            batch.changes.some((change) => change.type === 'reloadQueue') ||
            (!queueLoaded && batch.changes.some((change) => change.type === 'channel'))
        ) {
            quests = await repository.loadQueuedQuests();
            queueLoaded = true;
        }
        const [refreshResult, pendingAdditions] = await Promise.all([
            batch.refresh ? refresh(quests, batch.reasons) : { quests, changed: false },
            preparePendingAdditions(batch.adds),
        ]);

        quests = refreshResult.quests;
        let changed = refreshResult.changed;
        const additions = await addPendingQuests(quests, pendingAdditions);
        quests = additions.quests;
        changed ||= additions.added > 0;

        const removals = await applyRemovalChanges(quests, batch.changes);
        quests = removals.quests;
        changed ||= removals.removed > 0;

        setQuests(quests);
        let published = false;
        if (isRunning() && (changed || batch.publish || batch.repost)) {
            await publish(batch.repost);
            published = true;
        } else if (batch.refresh && !changed && !batch.publish && !batch.repost) {
            log.trace('Skipped unchanged Quest List publish', { reasons: batch.reasons });
        }

        const questIds = new Set(state.quests.map((quest) => quest.questId));
        for (const [userId, request] of batch.adds) {
            const added = (additions.addedByUser.get(userId) ?? []).filter((quest) => questIds.has(quest.questId));
            for (const [index, waiter] of request.waiters.entries()) {
                waiter.timer.checkpoint('processing');
                waiter.timer.trace('Processed Add My Quests request', {
                    userId,
                    added: index === 0 ? added.length : 0,
                });
                waiter.resolve(index === 0 ? added : []);
            }
        }

        for (const change of batch.changes) change.resolve(change.result);
        return {
            added: additions.added,
            removed: removals.removed,
            published,
        };
    }

    async function applyConfigurationChanges(changes) {
        for (const change of changes) {
            if (change.type === 'channel') {
                await repository.saveSetting('channelId', change.channelId);
                state.channelId = change.channelId;
                messageId = undefined;
                messagesSinceRepost = 0;
                log.info('Changed Quest List channel', { channelId: change.channelId });
            } else if (change.type === 'capacity') {
                await repository.saveSetting('capacity', change.capacity);
                state.capacity = change.capacity;
                log.info('Changed Quest List visible limits', { capacity: change.capacity });
            } else if (change.type === 'repostInterval') {
                await repository.saveSetting('repostInterval', change.repostInterval);
                state.repostInterval = change.repostInterval;
                log.info('Changed Quest List repost interval', { repostInterval: change.repostInterval });
            } else if (change.type === 'emptyMessage') {
                await repository.saveSetting('emptyMessage', change.emptyMessage);
                state.emptyMessage = change.emptyMessage;
                log.info('Changed Quest List empty message');
            }
        }
    }

    async function preparePendingAdditions(requests) {
        const userIds = [...requests.keys()];
        if (!userIds.length) return { userIds, candidates: [], hydrated: { quests: [], removed: [] } };

        const documents = await repository.getUserQuests(userIds);
        const candidates = documents.map((quest) => toQueuedQuest(quest));
        const hydrated = await hydrateQueuedQuests(repository, candidates, documents);
        return { userIds, candidates, hydrated };
    }

    async function addPendingQuests(quests, { userIds, candidates, hydrated }) {
        if (!userIds.length) return { quests, addedByUser: new Map(), added: 0 };

        const generations = new Set(quests.map(generationKey));
        const newQuests = hydrated.quests.filter((quest) => !generations.has(generationKey(quest)));
        const added = await repository.insertQueuedQuests(newQuests);
        const candidatesByUser = groupQuestsByUser(candidates);
        const rejectedByUser = new Map();
        for (const { quest, reason } of hydrated.removed) {
            if (!rejectedByUser.has(quest.userId)) rejectedByUser.set(quest.userId, []);
            rejectedByUser.get(quest.userId).push({ ...questLogData(quest), reason });
        }
        const alreadyQueuedByUser = groupQuestsByUser(
            hydrated.quests.filter((quest) => generations.has(generationKey(quest))),
        );
        const addedByUser = groupQuestsByUser(added);

        for (const userId of userIds) {
            const userAdded = addedByUser.get(userId) ?? [];
            log.trace('Evaluated Add My Quests candidates', {
                userId,
                candidates: (candidatesByUser.get(userId) ?? []).map(questLogData),
                rejected: rejectedByUser.get(userId) ?? [],
                alreadyQueued: (alreadyQueuedByUser.get(userId) ?? []).map(questLogData),
                added: userAdded.map(questLogData),
            });

            if (userAdded.length) log.info('Added quests to Quest List', { userId, count: userAdded.length });
        }

        return { quests: [...quests, ...added], addedByUser, added: added.length };
    }

    async function applyRemovalChanges(quests, changes) {
        let removedCount = 0;
        for (const change of changes) {
            if (change.type !== 'remove') continue;

            const removed = quests.filter(
                (quest) =>
                    (change.questType === 'all' || quest.questType === change.questType) &&
                    (!change.userIds.size || change.userIds.has(quest.userId)),
            );
            await repository.deleteQueuedQuests(removed.map((quest) => quest.questId));
            const removedIds = new Set(removed.map((quest) => quest.questId));
            quests = quests.filter((quest) => !removedIds.has(quest.questId));
            change.result = { quests: removed };
            removedCount += removed.length;

            if (removed.length) {
                log.info('Removed quests from Quest List', {
                    reason: 'manager',
                    count: removed.length,
                    users: [...new Set(removed.map((quest) => quest.userId))],
                    type: change.questType,
                });
            }
        }
        return { quests, removed: removedCount };
    }

    function rejectUpdate(batch, error) {
        for (const request of batch.adds.values()) {
            for (const waiter of request.waiters) {
                waiter.timer.checkpoint('processing');
                waiter.timer.trace('Failed Add My Quests request', { error });
                waiter.reject(error);
            }
        }
        for (const change of batch.changes) change.reject(error);
    }

    async function refresh(queued, reasons) {
        const timer = log.time();
        const refreshReasons = [...new Set(reasons)];
        const previous = new Map(queued.map((quest) => [quest.questId, { count: quest.count, total: quest.total }]));
        const { quests, removed, timing } = await hydrateQueuedQuests(repository, queued);
        timer.checkpoint('hydration');
        await repository.deleteQueuedQuests(removed.map(({ quest }) => quest.questId));
        timer.checkpoint('snailMongo');
        const updated = quests
            .filter((quest) => {
                const before = previous.get(quest.questId);
                return (
                    before?.count !== undefined &&
                    before?.total !== undefined &&
                    (before.count !== quest.count || before.total !== quest.total)
                );
            })
            .map((quest) => ({
                ...questLogData(quest),
                before: previous.get(quest.questId),
                after: { count: quest.count, total: quest.total },
            }));
        const changed = Boolean(removed.length || updated.length);

        if (removed.length) {
            log.info('Removed quests from Quest List', {
                reasons: refreshReasons,
                quests: removed.map(({ quest, reason: removalReason }) => ({
                    questId: quest.questId,
                    userId: quest.userId,
                    removalReason,
                })),
            });
        }

        timer.debug('Refreshed Quest List', {
            reasons: refreshReasons,
            quests: quests.length,
            users: new Set(quests.map((quest) => quest.userId)).size,
            updated: updated.length,
            removed: removed.length,
            owoMongoMs: timing.owoMongoMs,
            owoRedisMs: timing.owoRedisMs,
        });
        if (changed) {
            log.trace('Quest List refresh changes', {
                reasons: refreshReasons,
                updated,
                removed: removed.map(({ quest, reason: removalReason }) => ({
                    ...questLogData(quest),
                    removalReason,
                })),
            });
        }
        return { quests, changed };
    }

    async function publish(repost = false) {
        const message = buildQuestListMessage(state);
        if (!repost && messageId) {
            const timer = log.time();
            try {
                await rest.editMessage(state.channelId, messageId, message);
                timer.debug('Edited Quest List message', {
                    channelId: state.channelId,
                    messageId,
                });
                return;
            } catch (error) {
                timer.warn('Could not edit Quest List message; sending a replacement', {
                    channelId: state.channelId,
                    messageId,
                    error,
                });
            }
        }

        const timer = log.time();
        const sent = await rest.sendMessage(state.channelId, message);
        messageId = String(sent.id);
        messagesSinceRepost = 0;
        timer.info('Published Quest List', {
            channelId: state.channelId,
            messageId,
            quests: state.quests.length,
        });
    }

    function setQuests(quests) {
        state.quests = [...quests].sort((left, right) => left.addedAt.getTime() - right.addedAt.getTime());
        state.questsByType = new Map(Object.keys(QUEST_TYPES).map((type) => [type, []]));
        state.questsByUser = new Map();

        for (const quest of state.quests) {
            state.questsByType.get(quest.questType)?.push(quest);
            if (!state.questsByUser.has(quest.userId)) state.questsByUser.set(quest.userId, []);
            state.questsByUser.get(quest.userId).push(quest);
        }
    }

    function isRunning() {
        return Boolean(isEnabled() && state.channelId);
    }
}

function generationKey(quest) {
    return `${quest.questId}:${quest.questCreatedAt.getTime()}`;
}

function groupQuestsByUser(quests) {
    const questsByUser = new Map();
    for (const quest of quests) {
        if (!questsByUser.has(quest.userId)) questsByUser.set(quest.userId, []);
        questsByUser.get(quest.userId).push(quest);
    }
    return questsByUser;
}

function hasCustomId(components, customId) {
    return Boolean(
        components?.some(
            (component) =>
                component.customId === customId ||
                hasCustomId(component.components, customId) ||
                hasCustomId(component.accessory ? [component.accessory] : undefined, customId),
        ),
    );
}

function questLogData(quest) {
    return {
        questId: quest.questId,
        userId: quest.userId,
        slotIndex: quest.slotIndex,
        questType: quest.questType,
        statKey: quest.statKey,
        count: quest.count,
        total: quest.total,
        startValue: quest.startValue,
        targetValue: quest.targetValue,
        targetCount: quest.targetCount,
        questCreatedAt: quest.questCreatedAt,
        addedAt: quest.addedAt,
    };
}

function isPositiveInteger(value) {
    return Number.isSafeInteger(value) && value > 0;
}

function isCapacity(value) {
    if (!value) return false;

    const capacities = [value.cookieBy, value.prayBy, value.curseBy, value.emoteBy];
    return (
        capacities.every(isPositiveInteger) &&
        capacities.reduce((total, capacity) => total + capacity, 0) <= MAX_VISIBLE_QUESTS
    );
}
