import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { GatewayIntentBits } from 'discord-api-types/v10';
import { createGateway } from '../src/discord/gateway.js';
import setup from '../src/features/questList/index.js';
import { createPrayCurseReminders } from '../src/features/questList/reminders.js';
import { notification, TOGGLE_REMINDERS_ID } from '../src/features/questList/render.js';

const flush = async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
};

function fixture(t, owoprefix = 'owo') {
    t.mock.timers.enable({ apis: ['Date', 'setTimeout', 'setInterval'], now: 1000000 });
    const preferences = new Map([['user', true]]);
    const reads = [],
        sends = [],
        writes = [],
        errors = [];
    const User = {
        find: () => ({ lean: async () => [...preferences].filter(([, enabled]) => enabled).map(([_id]) => ({ _id })) }),
        async findById(id) {
            reads.push(id);
            return preferences.has(id) ? { reminders: { luck: preferences.get(id) } } : null;
        },
        async updateOne(filter, update, options) {
            writes.push([filter, update, options]);
            preferences.set(filter._id, update.$set['reminders.luck']);
        },
    };
    const redis = {
        multi() {
            assert.fail('Reminder must not read Redis');
        },
    };
    const rest = {
        applicationId: 'snail',
        async sendMessage(...args) {
            sends.push(args);
        },
    };
    const log = {
        debug() {},
        info() {},
        trace() {},
        warn() {},
        error(...args) {
            errors.push(args);
        },
    };
    log.time = () => log;
    const reminders = createPrayCurseReminders({
        User,
        redis,
        rest,
        log,
        owoprefix,
        getChannelId: () => 'quest-channel',
    });
    t.after(() => reminders.deactivate());
    const message = (content, extra = {}) => ({
        content,
        author: { id: 'user', bot: false },
        channelId: 'original',
        ...extra,
    });
    return { reminders, preferences, reads, sends, writes, errors, User, redis, rest, log, message };
}

test('legacy parsing ignores bots, other commands and non-prefix text; no startup/enable polling', async (t) => {
    const f = fixture(t);
    await f.reminders.activate();
    assert.equal(await f.reminders.toggle('new'), true);
    assert.deepEqual(f.writes, [[{ _id: 'new' }, { $set: { 'reminders.luck': true } }, { upsert: true }]]);
    for (const content of ['', 'pray', ' owo pray', 'hello owo pray', 'owo hunt', 'owo prayers', 'owo pray\tuser']) {
        await f.reminders.messageCreated(f.message(content));
    }
    await f.reminders.messageCreated(f.message('owo pray', { author: { id: 'owo', bot: true } }));
    assert.deepEqual(f.reads, []);
    t.mock.timers.tick(900000);
    await flush();
    assert.deepEqual(f.sends, []);
    assert.deepEqual(f.errors, []);
});

test('one non-extending five-minute timer sends legacy text in original channel and can be reused', async (t) => {
    const f = fixture(t);
    await f.reminders.activate();
    await Promise.all([
        f.reminders.messageCreated(f.message('OwO   PrAy <@target>')),
        f.reminders.messageCreated(f.message('owocurse')),
    ]);
    t.mock.timers.tick(240000);
    await f.reminders.messageCreated(f.message('owo curse', { channelId: 'other' }));
    t.mock.timers.tick(59999);
    await flush();
    assert.equal(f.sends.length, 0);
    t.mock.timers.tick(1);
    await flush();
    assert.deepEqual(f.sends, [['original', notification('<@user> your pray/curse cooldown is over!', ['user'])]]);
    await f.reminders.messageCreated(f.message('owocurse', { channelId: 'next' }));
    t.mock.timers.tick(300000);
    await flush();
    assert.equal(f.sends.length, 2);
    assert.equal(f.sends[1][0], 'next');
});

test('current boolean preferences gate commands and expiry, clearing suppressed timers', async (t) => {
    const f = fixture(t);
    await f.reminders.activate();
    f.preferences.set('user', false);
    await f.reminders.messageCreated(f.message('owo pray'));
    await f.reminders.messageCreated(f.message('owo pray', { author: { id: 'missing' } }));
    t.mock.timers.tick(300000);
    await flush();
    assert.equal(f.sends.length, 0);
    f.preferences.set('user', true);
    await f.reminders.messageCreated(f.message('owo pray'));
    f.preferences.set('user', false);
    t.mock.timers.tick(300000);
    await flush();
    assert.equal(f.sends.length, 0);
    f.preferences.set('user', true);
    await f.reminders.messageCreated(f.message('owo pray'));
    t.mock.timers.tick(300000);
    await flush();
    assert.equal(f.sends.length, 1);
});

test('toggle off/on does not extend a pending legacy timer; deactivate cancels it', async (t) => {
    const f = fixture(t);
    await f.reminders.activate();
    await f.reminders.messageCreated(f.message('owo pray'));
    t.mock.timers.tick(100000);
    assert.equal(await f.reminders.toggle('user'), false);
    assert.equal(await f.reminders.toggle('user'), true);
    await f.reminders.messageCreated(f.message('owo curse'));
    t.mock.timers.tick(200000);
    await flush();
    assert.equal(f.sends.length, 1);
    await f.reminders.messageCreated(f.message('owo pray'));
    f.reminders.deactivate();
    t.mock.timers.tick(300000);
    await flush();
    assert.equal(f.sends.length, 1);
});

test('production alone configures the legacy prefix; all configs request message content', async () => {
    const log = { debug() {}, info() {}, warn() {}, error() {} };
    for (const name of ['production', 'wifu']) {
        const config = JSON.parse(await readFile(new URL(`../src/config/${name}.json`, import.meta.url), 'utf8'));
        assert.equal(config.owoprefix, name === 'production' ? 'owo' : undefined);
        const gateway = createGateway({
            config,
            token: 'test',
            logging: { createLogger: () => log },
            log,
            packages: {},
            rest: {},
        });
        const baseline = GatewayIntentBits.Guilds | GatewayIntentBits.GuildMembers | GatewayIntentBits.GuildMessages;
        assert.equal(gateway.intents, baseline | GatewayIntentBits.MessageContent);
    }
});

test('unconfigured prefix has no fallback', async (t) => {
    const f = fixture(t, null);
    await f.reminders.activate();
    await f.reminders.messageCreated(f.message('owo pray'));
    t.mock.timers.tick(300000);
    await flush();
    assert.deepEqual(f.reads, []);
    assert.deepEqual(f.sends, []);
});

for (const redisAvailable of [false, true]) {
    test(`setup gates reminders on OwO Redis (${redisAvailable}) without requiring a quest channel`, async (t) => {
        const f = fixture(t);
        const pack = await setup({
            config: { owoprefix: 'owo' },
            features: new Map([['questList', { enabled: true, missing: [] }]]),
            logging: { createLogger: () => f.log },
            rest: f.rest,
            services: {
                snail: {
                    mongo: {
                        User: f.User,
                        Setting: { loadValues: async () => ({}) },
                        Quest: { find: () => ({ sort: () => ({ lean: async () => [] }) }) },
                    },
                },
                owo: redisAvailable ? { redis: f.redis } : {},
            },
        });
        t.after(() => pack.feature.deactivate());
        await pack.feature.activate();
        const toggle = pack.components.find(({ id }) => id === TOGGLE_REMINDERS_ID);
        assert.deepEqual(toggle.missing, redisAvailable ? [] : ['OwO Redis']);
        if (!redisAvailable) {
            assert.deepEqual(pack.feature.events, []);
            t.mock.timers.tick(900000);
            await flush();
            assert.deepEqual(f.reads, []);
            assert.deepEqual(f.writes, []);
            assert.deepEqual(f.sends, []);
            return;
        }
        const responses = [];
        await toggle.handle({ interaction: { user: { id: 'new' } }, respond: async (...args) => responses.push(args) });
        assert.match(responses[0][0], /command channel/);
        assert.equal(pack.feature.events.length, 1);
        assert.equal(pack.feature.events[0].event, 'MESSAGE_CREATE');
        const gateway = createGateway({
            config: { owoprefix: 'owo' },
            token: 'test',
            logging: { createLogger: () => f.log },
            log: f.log,
            packages: {
                features: new Map([['questList', { enabled: true }]]),
                events: new Map([
                    ['MESSAGE_CREATE', pack.feature.events.map((event) => ({ ...event, featureId: 'questList' }))],
                ]),
            },
            rest: f.rest,
        });
        await gateway.events.message(undefined, {
            t: 'MESSAGE_CREATE',
            d: f.message('owo pray', { author: { id: 'new' } }),
        });
        t.mock.timers.tick(300000);
        await flush();
        assert.equal(f.sends.length, 1);
        assert.equal(f.sends[0][0], 'original');
        assert.deepEqual(f.errors, []);
    });
}
