import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPrayCurseReminders } from '../src/features/questList/reminders.js';

const flush = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
};

test('HGET lasttime preserves immediate enable checks, missing values, and 4.5-minute cadence', async (t) => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now });
    const reads = [],
        sends = [],
        writes = [],
        warnings = [];
    const values = new Map([['cd_pray_existing', new Date(now).toISOString()]]);
    const log = {
        debug() {},
        info() {},
        trace() {},
        error(error) {
            assert.fail(String(error));
        },
        warn(...args) {
            warnings.push(args);
        },
    };
    log.time = () => log;
    const reminders = createPrayCurseReminders({
        User: {
            find: () => ({ lean: async () => [{ _id: 'existing' }, { _id: 'missing' }] }),
            async updateOne(...args) {
                writes.push(args);
            },
        },
        redis: {
            multi() {
                const keys = [];
                return {
                    hGet(key, field) {
                        assert.equal(field, 'lasttime');
                        keys.push(key);
                        reads.push({ key, at: Date.now() });
                    },
                    async execAsPipeline() {
                        return keys.map((key) => values.get(key) ?? null);
                    },
                };
            },
        },
        rest: {
            async sendMessage(...args) {
                sends.push(args);
            },
        },
        log,
        getChannelId: () => 'channel',
    });
    await reminders.activate();
    assert.deepEqual(
        reads.map(({ key }) => key),
        ['cd_pray_existing', 'cd_pray_missing'],
    );
    assert.equal(sends.length, 0);
    assert.equal(await reminders.toggle('joiner'), true);
    assert.equal(reads.at(-1).key, 'cd_pray_joiner');
    assert.equal(writes.length, 1);
    t.mock.timers.tick(269999);
    await flush();
    assert.equal(reads.length, 3);
    values.set('cd_pray_joiner', 'invalid');
    t.mock.timers.tick(1);
    await flush();
    assert.equal(reads.length, 6);
    assert.equal(reads.at(-1).at - now, 270000);
    assert.equal(warnings.length, 1);
    t.mock.timers.tick(30000);
    await flush();
    assert.equal(sends.length, 1);
    assert.equal(sends[0][0], 'channel');
    reminders.deactivate();
    t.mock.timers.tick(600000);
    await flush();
    assert.equal(reads.length, 6);
});

test('missing lasttime clears a scheduled cooldown', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000000 });
    let value = new Date(Date.now()).toISOString();
    let sends = 0;
    const log = { debug() {}, info() {}, trace() {}, warn() {}, error() {} };
    log.time = () => log;
    const reminders = createPrayCurseReminders({
        User: { find: () => ({ lean: async () => [{ _id: 'user' }] }) },
        redis: { multi: () => ({ hGet() {}, execAsPipeline: async () => [value] }) },
        rest: {
            async sendMessage() {
                sends++;
            },
        },
        log,
        getChannelId: () => 'channel',
    });
    await reminders.activate();
    value = null;
    t.mock.timers.tick(270000);
    await flush();
    t.mock.timers.tick(30000);
    await flush();
    assert.equal(sends, 0);
    reminders.deactivate();
});
