import assert from 'node:assert/strict';
import { test } from 'node:test';
import setup from '../src/features/questList/index.js';
import production from '../src/config/production.json' with { type: 'json' };
import wifu from '../src/config/wifu.json' with { type: 'json' };
import { createQuestListUpdates } from '../src/features/questList/updates.js';
import { createQuestSource, toQueuedQuest } from '../src/features/questList/quests.js';

const log = Object.fromEntries(['trace', 'debug', 'info', 'warn', 'error', 'checkpoint'].map((key) => [key, () => {}]));
log.time = () => log;
const flush = async () => {
    for (let i = 0; i < 60; i++) await Promise.resolve();
};

async function fixture(t, owoBotId = 'owo') {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000000 });
    const documents = ['queued', 'joiner', 'other'].map((userId) => ({
        _id: userId,
        userId,
        slotIndex: 0,
        questType: 'prayBy',
        statKey: 'prayBy',
        startValue: 0,
        targetValue: 10,
        targetCount: 10,
        createdAt: new Date(0),
    }));
    const reads = [],
        stats = [],
        sends = [],
        edits = [];
    let hold;
    let enabled = true;
    const UserQuest = {
        find(filter) {
            reads.push({ filter, at: Date.now() });
            const ids = filter._id?.$in ?? filter.userId.$in;
            const result = {
                sort: () => result,
                lean: async () => {
                    if (hold) await hold;
                    return documents.filter((doc) => ids.includes(doc.userId));
                },
            };
            return result;
        },
    };
    const redis = {
        multi() {
            const keys = [];
            return {
                hmGet(key, fields) {
                    keys.push(key);
                    stats.push({ key, fields });
                },
                async execAsPipeline() {
                    return keys.map(() => ['1']);
                },
            };
        },
    };
    const stored = new Map([['queued', { ...toQueuedQuest(documents[0]), count: 1, total: 10 }]]);
    const Quest = {
        find() {
            return {
                sort() {
                    return { lean: async () => [...stored.values()] };
                },
            };
        },
        async bulkWrite(ops) {
            const upsertedIds = {};
            for (const [index, { updateOne }] of ops.entries()) {
                const id = updateOne.filter.questId;
                if (!stored.has(id) && updateOne.upsert) {
                    stored.set(id, { ...updateOne.update.$setOnInsert });
                    upsertedIds[index] = id;
                }
            }
            return { upsertedIds };
        },
        async deleteMany(filter) {
            for (const id of filter.questId.$in) stored.delete(id);
        },
    };
    const Setting = {
        loadValues: async () => ({ channelId: 'channel', repostInterval: 3 }),
        saveValue: async () => {},
    };
    const rest = {
        applicationId: 'snail',
        async sendMessage(channel, message) {
            sends.push({ channel, message });
            return { id: `sent-${sends.length}` };
        },
        async editMessage(...args) {
            edits.push(args);
        },
    };
    const updates = createQuestListUpdates({
        Quest,
        Setting,
        questSource: createQuestSource({ UserQuest, redis }),
        rest,
        log,
        isEnabled: () => enabled,
        owoBotId,
    });
    await updates.initialize();
    const package_ = await setup({
        config: owoBotId ? production : wifu,
        features: new Map([['questList', { enabled: true, missing: [] }]]),
        logging: { createLogger: () => log },
        rest,
        services: { snail: { mongo: { Quest, Setting } }, owo: { mongo: { UserQuest }, redis } },
    });
    return {
        package_,
        documents,
        stored,
        updates,
        reads,
        stats,
        sends,
        edits,
        message(author = 'owo', channelId = 'channel') {
            updates.messageCreated({ id: 'incoming', channelId, author: { id: author, bot: author !== 'human' } });
        },
        async tick(ms) {
            t.mock.timers.tick(ms);
            await flush();
        },
        hold(promise) {
            hold = promise;
        },
        disable() {
            enabled = false;
            updates.deactivate();
        },
    };
}

test('package wiring uses the production-only identity and cancels automatic work on deactivation', async (t) => {
    const f = await fixture(t);
    assert.equal(production.users.owo, '408785106942164992');
    assert.equal(wifu.users.owo, undefined);
    const handle = f.package_.feature.events[0].handle;
    const message = { id: 'owo-message', channelId: 'channel', author: { id: production.users.owo } };
    handle(message);
    await flush();
    assert.equal(f.reads.length, 1);
    handle(message);
    await flush();
    f.package_.feature.deactivate();
    await f.tick(60000);
    assert.equal(f.reads.length, 1);
});

test('wifu package never falls back to the production bot identity', async (t) => {
    const f = await fixture(t, null);
    f.package_.feature.events[0].handle({
        id: 'owo-message',
        channelId: 'channel',
        author: { id: production.users.owo },
    });
    await flush();
    assert.equal(f.reads.length, 0);
});

test('ordinary chat and other bots repost cached state without OwO reads', async (t) => {
    const f = await fixture(t);
    for (const author of ['human', 'other-bot', 'human']) {
        f.message(author);
        await flush();
    }
    assert.equal(f.reads.length, 0);
    assert.equal(f.stats.length, 0);
    assert.equal(f.sends.length, 1);
});

test('automatic bursts have fixed 30s deadlines, refresh the queued user, and do not poll idle', async (t) => {
    const f = await fixture(t);
    f.message('owo', 'elsewhere');
    await flush();
    assert.equal(f.reads.length, 0);
    f.message();
    await flush();
    assert.deepEqual(f.reads[0].filter, { _id: { $in: ['queued'] } });
    for (let i = 0; i < 5; i++) {
        await f.tick(5000);
        f.message();
        await flush();
    }
    assert.equal(f.reads.length, 1);
    await f.tick(4999);
    assert.equal(f.reads.length, 1);
    await f.tick(1);
    assert.equal(f.reads.length, 2);
    assert.equal(f.reads[1].at - f.reads[0].at, 30000);
    await f.tick(90000);
    assert.equal(f.reads.length, 2);
});

test('messages during a slow refresh preserve trailing work without overlapping refreshes', async (t) => {
    const f = await fixture(t);
    let release;
    f.hold(
        new Promise((resolve) => {
            release = resolve;
        }),
    );
    f.message();
    await flush();
    await f.tick(1000);
    f.message();
    await flush();
    await f.tick(40000);
    assert.equal(f.reads.length, 1);
    f.hold(undefined);
    release();
    await flush();
    assert.equal(f.reads.length, 2);
    await f.tick(90000);
    assert.equal(f.reads.length, 2);
});

test('disable and channel changes cancel pending automatic work', async (t) => {
    const f = await fixture(t);
    f.message();
    await flush();
    f.message();
    await flush();
    await f.updates.setChannel('new-channel');
    const count = f.reads.length;
    await f.tick(60000);
    assert.equal(f.reads.length, count);
    f.message();
    await flush();
    assert.equal(f.reads.length, count);
    f.message('owo', 'new-channel');
    await flush();
    f.message('owo', 'new-channel');
    await flush();
    f.disable();
    const disabledCount = f.reads.length;
    await f.tick(90000);
    f.message('owo', 'new-channel');
    await flush();
    assert.equal(f.reads.length, disabledCount);
});

test('unconfigured identity does not refresh for arbitrary bots or missing authors', async (t) => {
    const f = await fixture(t, null);
    f.message();
    f.updates.messageCreated({ id: 'no-author', channelId: 'channel' });
    await flush();
    assert.equal(f.reads.length, 0);
});

test('add-only reads requester quests and stats, preserving the existing queue', async (t) => {
    const f = await fixture(t);
    const added = await f.updates.addQuests('joiner');
    assert.equal(added.length, 1);
    assert.deepEqual(
        f.reads.map(({ filter }) => filter.userId?.$in),
        [['joiner']],
    );
    assert.deepEqual(
        f.stats.map(({ key }) => key),
        ['user_stats:joiner'],
    );
    assert.deepEqual(
        f.updates.state.quests.map(({ userId }) => userId),
        ['queued', 'joiner'],
    );
});

test('add-only replaces a rerolled requester generation in memory and persistence', async (t) => {
    const f = await fixture(t);
    await f.updates.addQuests('joiner');
    const unrelated = f.updates.state.quests.find((quest) => quest.userId === 'joiner');
    f.documents[0].createdAt = new Date(1000);
    f.reads.length = 0;
    f.stats.length = 0;
    const added = await f.updates.addQuests('queued');
    assert.equal(added.length, 1);
    assert.equal(added[0].questCreatedAt.getTime(), 1000);
    assert.equal(f.stored.get('queued').questCreatedAt.getTime(), 1000);
    assert.equal(f.updates.state.quests.find((quest) => quest.userId === 'queued').questCreatedAt.getTime(), 1000);
    assert.equal(
        f.updates.state.quests.find((quest) => quest.userId === 'joiner'),
        unrelated,
    );
    assert.deepEqual(
        f.reads.map(({ filter }) => filter.userId?.$in),
        [['queued']],
    );
    assert.deepEqual(
        f.stats.map(({ key }) => key),
        ['user_stats:queued'],
    );
    assert.equal((await f.updates.addQuests('queued')).length, 0);
    assert.equal(f.stored.size, 2);
});

for (const reason of ['missing', 'locked', 'completed']) {
    test(`add-only removes a ${reason} requester entry without touching other users`, async (t) => {
        const f = await fixture(t);
        await f.updates.addQuests('joiner');
        const unrelated = f.updates.state.quests.find((quest) => quest.userId === 'joiner');
        if (reason === 'missing') f.documents.shift();
        if (reason === 'locked') f.documents[0].locked = true;
        if (reason === 'completed') f.documents[0].targetValue = 1;
        f.reads.length = 0;
        const edits = f.edits.length;
        assert.equal((await f.updates.addQuests('queued')).length, 0);
        assert.deepEqual(f.updates.state.quests, [unrelated]);
        assert.equal(f.stored.has('queued'), false);
        assert.deepEqual(
            f.reads.map(({ filter }) => filter.userId?.$in),
            [['queued']],
        );
        assert.equal(f.edits.length, edits + 1);
    });
}

test('add-only updates surviving requester progress while preserving queue age', async (t) => {
    const f = await fixture(t);
    const addedAt = f.updates.state.quests[0].addedAt;
    f.documents[0].targetCount = 20;
    f.documents[0].targetValue = 20;
    await f.tick(1000);
    assert.equal((await f.updates.addQuests('queued')).length, 0);
    assert.equal(f.updates.state.quests[0].total, 20);
    assert.equal(f.updates.state.quests[0].addedAt, addedAt);
    assert.equal(f.sends.length, 1);
});

test('pending additions batch and deduplicate while preserving an independent full refresh', async (t) => {
    const f = await fixture(t);
    let release;
    f.hold(
        new Promise((resolve) => {
            release = resolve;
        }),
    );
    const first = f.updates.refreshPositions();
    await flush();
    const a = f.updates.addQuests('joiner'),
        duplicate = f.updates.addQuests('joiner'),
        b = f.updates.addQuests('other');
    const refresh = f.updates.refreshPositions();
    f.hold(undefined);
    release();
    const results = await Promise.all([first, a, duplicate, b, refresh]);
    assert.equal(results[1].length, 1);
    assert.equal(results[2].length, 0);
    assert.equal(results[3].length, 1);
    assert.deepEqual(
        f.reads.map(({ filter }) => filter._id?.$in ?? filter.userId.$in),
        [['queued'], ['queued'], ['joiner', 'other']],
    );
});

test('automatic refresh in an add batch covers every queued quest, including hidden quests', async (t) => {
    const f = await fixture(t);
    await f.updates.addQuests('joiner');
    await f.updates.setCapacity({ cookieBy: 1, prayBy: 1, curseBy: 1, emoteBy: 1 });
    f.reads.length = 0;
    f.stats.length = 0;
    // The add batch yields for configuration before it reads, allowing the OwO event to coalesce.
    const added = f.updates.addQuests('other');
    f.message();
    await added;
    await flush();
    assert.deepEqual(
        f.reads.map(({ filter }) => filter._id?.$in ?? filter.userId.$in),
        [['queued', 'joiner'], ['other']],
    );
    assert.deepEqual(f.stats.map(({ key }) => key).sort(), [
        'user_stats:joiner',
        'user_stats:other',
        'user_stats:queued',
    ]);
    await f.tick(60000);
    assert.equal(f.reads.length, 2);
});

test('a message during refresh finishing before the deadline runs at 30s, not immediately', async (t) => {
    const f = await fixture(t);
    let release;
    f.hold(
        new Promise((resolve) => {
            release = resolve;
        }),
    );
    f.message();
    await flush();
    await f.tick(1000);
    f.message();
    f.hold(undefined);
    release();
    await flush();
    assert.equal(f.reads.length, 1);
    await f.tick(28999);
    assert.equal(f.reads.length, 1);
    await f.tick(1);
    assert.equal(f.reads.length, 2);
});

test('explicit refresh, settings and adds remain responsive during automatic cooldown', async (t) => {
    const f = await fixture(t);
    f.message();
    await flush();
    f.message();
    await flush();
    await f.updates.refreshPositions();
    assert.equal(f.reads.length, 2);
    await f.updates.setEmptyMessage('Waiting');
    assert.equal(f.sends.length, 1);
    await f.updates.addQuests('joiner');
    assert.equal(f.edits.length, 1);
    await f.updates.forceRepost();
    assert.equal(f.sends.length, 2);
    await f.tick(30000);
    assert.deepEqual(f.reads.at(-1).filter._id.$in, ['queued', 'joiner']);
});
