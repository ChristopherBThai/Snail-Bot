import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChannelType, MessageType } from 'discord-api-types/v10';
import { createAsk } from '../src/features/knowledgeBase/ask.js';
import { buildAnswer } from '../src/features/knowledgeBase/render.js';

const bot = '99';
const channel = { id: '100', parentId: '10', ownerId: bot, type: ChannelType.GuildPublicThread };
const question = (id, content, reference) => ({
    id,
    channelId: channel.id,
    content,
    author: { id: '5' },
    type: reference ? MessageType.Reply : MessageType.Default,
    ...(reference ? { messageReference: { messageId: reference } } : {}),
});
const answer = (id, reference, embeddedQuestion) => ({
    id,
    channelId: channel.id,
    author: { id: bot, bot: true },
    ...buildAnswer('Use owo hunt.', [], id, embeddedQuestion),
    messageReference: { messageId: reference },
});
const starter = { ...question('100', '<@99> How do I hunt?'), channelId: '10' };
const firstAnswer = answer('101', '100');
const expected = [
    { role: 'user', content: 'How do I hunt?' },
    { role: 'assistant', content: 'Use owo hunt.' },
];

async function askWithHistory(
    t,
    { page, stored = [starter], current = question('200', '<@99> And how often?'), command = false },
) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const fetches = [];
    const ask = createAsk({
        Setting: {},
        log: { debug() {}, info() {}, time: () => ({ checkpoint() {}, info() {} }) },
        knowledge: {
            async ask(text, history) {
                calls.push({ text, history });
                return { answer: 'Follow-up.', sources: [] };
            },
        },
        rest: {
            applicationId: bot,
            async getChannel() {
                return channel;
            },
            async getMessages() {
                return page;
            },
            async getMessage(channelId, id) {
                fetches.push([channelId, id]);
                const found = stored.find((message) => message.channelId === channelId && message.id === id);
                if (!found) throw new Error('Unknown message');
                return found;
            },
            async triggerTypingIndicator() {},
            async sendMessage(channelId, payload) {
                return { ...payload, id: '201', channelId };
            },
        },
    });
    if (command) {
        await ask.handleCommand({
            interaction: {
                channel,
                user: { id: '5' },
                data: { options: [{ name: 'question', value: 'And how often?' }] },
            },
            async defer() {},
            async editResponse(payload) {
                return { ...payload, id: '201', channelId: channel.id };
            },
        });
    } else {
        await ask.handleMessage(current);
    }
    assert.equal(calls.length, 1);
    return { ...calls[0], fetches };
}

test('mention-started thread follow-up retains the parent question and first answer', async (t) => {
    const result = await askWithHistory(t, { page: [firstAnswer] });
    assert.deepEqual(result.history, expected);
    assert.equal(result.text, 'And how often?');
});

test('current reply recovers its answer outside the fetched page', async (t) => {
    const result = await askWithHistory(t, {
        page: [],
        stored: [starter, firstAnswer],
        current: question('200', 'And how often?', '101'),
    });
    assert.deepEqual(result.history, expected);
});

test('an off-page referenced follow-up question retains answer provenance', async (t) => {
    const followUp = question('110', 'How often?', '101');
    const result = await askWithHistory(t, {
        page: [answer('111', '110')],
        stored: [starter, firstAnswer, followUp],
    });
    assert.deepEqual(result.history, [
        { role: 'user', content: 'How often?' },
        { role: 'assistant', content: 'Use owo hunt.' },
    ]);
});

test('embedded reference objects are included without duplicate turns', async (t) => {
    const result = await askWithHistory(t, {
        page: [firstAnswer, starter],
        current: { ...question('200', 'And how often?', '101'), referencedMessage: firstAnswer },
    });
    assert.deepEqual(result.history, expected);
    assert.deepEqual(result.fetches, [['10', '100']]);
});

test('a fetched answer with an embedded parent reference retains its question', async (t) => {
    const result = await askWithHistory(t, {
        page: [{ ...firstAnswer, referencedMessage: starter }],
        stored: [],
    });
    assert.deepEqual(result.history, expected);
});

test('slash follow-up in a mention-started thread retains original context', async (t) => {
    const result = await askWithHistory(t, { page: [firstAnswer], command: true });
    assert.deepEqual(result.history, expected);
});

test('slash-started answers continue to use their embedded question', async (t) => {
    const result = await askWithHistory(t, { page: [answer('101', '100', 'How do I hunt?')] });
    assert.deepEqual(result.history, expected);
});

test('missing references do not pair an answer to an unrelated question', async (t) => {
    const result = await askWithHistory(t, {
        page: [question('102', '<@99> Unrelated?'), answer('104', '103')],
        stored: [],
    });
    assert.deepEqual(result.history, []);
});

test('unmentioned non-reply references remain ineligible questions', async (t) => {
    const result = await askWithHistory(t, {
        page: [answer('104', '103')],
        stored: [question('103', 'Unrelated chatter')],
    });
    assert.deepEqual(result.history, []);
});

test('history still caps to the five newest completed turns', async (t) => {
    const page = Array.from({ length: 6 }, (_, i) => answer(String(110 + i), '100', `Question ${i}`));
    const result = await askWithHistory(t, { page });
    assert.equal(result.history.length, 10);
    assert.equal(result.history[0].content, 'Question 1');
    assert.equal(result.history[8].content, 'Question 5');
});
