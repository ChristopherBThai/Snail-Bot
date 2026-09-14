import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';
import { createAsk } from '../src/features/knowledgeBase/ask.js';
import { buildAnswer } from '../src/features/knowledgeBase/render.js';
import { loadLegacy, plain } from './helpers/legacy.js';
import { camelize } from '@discordeno/utils';

function legacyAnswer(id, content, reference) {
    return {
        id,
        channel_id: '100',
        author: { id: '42', bot: true },
        content: oldConversation.buildAskAnswerContent(content, [{ tagId: 'daily' }]),
        components: oldConversation.buildAskFeedbackComponents('kb_ask_feedback_helpful'),
        ...(reference ? { message_reference: { message_id: reference } } : {}),
    };
}

test('actual legacy wire answers and shipped-prefix questions survive thread history', async (t) => {
    const prefixes = ['snail', '🐌', ':snail:', 's!'];
    const messages = [legacyAnswer('101', 'Unpaired answer.')];
    prefixes.forEach((prefix, index) => {
        messages.push(user(String(102 + index * 2), `${prefix} ask How  daily?`));
        messages.push(legacyAnswer(String(103 + index * 2), 'Use owo daily.'));
    });
    const f = harness(t, { messages: messages.map(camelize) });
    await f.ask.handleMessage(user('200', '<@42> Follow up?'));
    assert.deepEqual(
        f.calls.find(([type]) => type === 'ask')[2],
        plain(oldConversation.buildAskConversationHistory(messages, bot, prefixes)),
    );
    const inactive = harness(t);
    await inactive.ask.handleMessage(user('200', 's!ask Do not execute prefix commands'));
    assert.equal(
        inactive.calls.some(([type]) => type === 'ask'),
        false,
    );
});

test('reply provenance validates embedded IDs and fetches null or mismatched references', async (t) => {
    const referenced = camelize(legacyAnswer('101', 'Use owo daily.'));
    for (const embedded of [null, undefined, { ...referenced, id: 'wrong' }, referenced]) {
        const f = harness(t, { referenced, messages: [referenced] });
        await f.ask.handleMessage({ ...user('200', 'Follow up?', '101'), referencedMessage: embedded });
        assert.deepEqual(f.calls.find(([type]) => type === 'ask')?.[2], [
            { role: 'assistant', content: 'Use owo daily.' },
        ]);
        assert.equal(
            f.calls.filter(([type, , id]) => type === 'message' && id === '101').length,
            embedded === referenced ? 0 : 1,
        );
    }
    const forged = harness(t);
    await forged.ask.handleMessage({ ...user('200', 'Follow up?', 'missing'), referencedMessage: referenced });
    assert.equal(
        forged.calls.some(([type]) => type === 'ask'),
        false,
    );
    const unrelated = harness(t, { referenced, channel: { ...thread, ownerId: 'other' } });
    await unrelated.ask.handleMessage({ ...user('200', 'Follow up?', '101'), referencedMessage: referenced });
    assert.equal(
        unrelated.calls.some(([type]) => type === 'ask'),
        false,
    );
});

const oldConversation = loadLegacy('src/modules/knowledge-base/AskConversation.js').exports;
beforeEach((t) => t.mock.timers.enable({ apis: ['setTimeout'] }));
const bot = '42';
const thread = { id: '100', parentId: 'parent', type: 11, ownerId: bot };
const user = (id, content, reference) => ({
    id,
    content,
    channelId: thread.id,
    author: { id: 'user', bot: false },
    type: reference ? 19 : 0,
    ...(reference ? { messageReference: { messageId: reference } } : {}),
});
const answer = (id, content, reference, question) => ({
    id,
    channelId: thread.id,
    author: { id: bot, bot: true },
    content: '',
    ...buildAnswer(content, [], 'fixture', question),
    ...(reference ? { messageReference: { messageId: reference } } : {}),
});
function oldMessage(message) {
    const isAnswer = message.author.id === bot;
    const parts = message.components?.[0]?.components ?? [];
    const text = parts
        .filter((part) => part.type === 10)
        .map((part) => part.content)
        .filter((content) => !content.startsWith('> -#'))
        .join('\n');
    return {
        ...message,
        content: isAnswer ? oldConversation.buildAskAnswerContent(text, []) : message.content,
        components: isAnswer ? oldConversation.buildAskFeedbackComponents() : [],
        messageReference: message.messageReference && { messageID: message.messageReference.messageId },
    };
}
function harness(t, { messages = [], starter, channel = thread, referenced, failHistory = false } = {}) {
    const calls = [];
    const rest = {
        applicationId: bot,
        getChannel: async () => channel,
        getMessages: async (...args) => {
            calls.push(['history', ...args]);
            if (failHistory) throw new Error('offline failure');
            return messages;
        },
        getMessage: async (channelId, id) => {
            calls.push(['message', channelId, id]);
            if (channelId === 'parent' && id === thread.id && starter) return starter;
            if (referenced?.id === id) return referenced;
            throw new Error('Not found');
        },
        triggerTypingIndicator: async () => {},
        sendMessage: async (channelId, payload) => {
            calls.push(['send', channelId, payload]);
            return { id: '900', channelId };
        },
        startThreadWithMessage: async (...args) => {
            calls.push(['thread', ...args]);
            return thread;
        },
    };
    const ask = createAsk({
        rest,
        knowledge: {
            ask: async (...args) => {
                calls.push(['ask', ...args]);
                return { answer: 'Answer', sources: [] };
            },
        },
        Setting: { loadValues: async () => ({}) },
        log: { info() {}, warn() {}, debug() {}, time: () => ({ info() {}, checkpoint() {} }) },
    });
    return { ask, rest, calls };
}

test('actual mention caller preserves raw question and gathers parent starter before current message', async (t) => {
    const starter = user('100', '<@42> How  daily?');
    const messages = [answer('101', 'Use daily.')];
    const f = harness(t, { starter, messages });
    await f.ask.handleMessage(user('200', '<@42> What  about\ncp?'));
    assert.deepEqual(
        f.calls.find(([type]) => type === 'history'),
        ['history', '100', { limit: 100, before: '200' }],
    );
    assert.ok(f.calls.some(([type, channel, id]) => type === 'message' && channel === 'parent' && id === '100'));
    assert.deepEqual(f.calls.find(([type]) => type === 'ask').slice(0, 3), [
        'ask',
        'What  about\ncp?',
        plain(oldConversation.buildAskConversationHistory([starter, ...messages].map(oldMessage), bot)),
    ]);
});

test('actual history keeps unpaired assistant turns and falls back to oldest pending question on missing reference', async (t) => {
    const messages = [answer('101', 'Unpaired'), user('102', '<@42> Next?'), answer('103', 'Paired', 'absent')];
    const f = harness(t, { messages });
    await f.ask.handleMessage(user('200', '<@42> Follow up?'));
    assert.deepEqual(
        f.calls.find(([type]) => type === 'ask')[2],
        plain(oldConversation.buildAskConversationHistory(messages.map(oldMessage), bot)),
    );
});

test('reply-only caller requires a Snail-owned thread and retrieves referenced answer outside history window', async (t) => {
    const referenced = answer('101', 'Old answer');
    const current = user('200', 'Follow up?', '101');
    const f = harness(t, { referenced });
    await f.ask.handleMessage(current);
    assert.deepEqual(f.calls.find(([type]) => type === 'ask')[2], [{ role: 'assistant', content: 'Old answer' }]);
    const g = harness(t, { channel: { ...thread, ownerId: 'someone-else' }, referenced });
    await g.ask.handleMessage(current);
    assert.equal(
        g.calls.some(([type]) => type === 'ask'),
        false,
    );
});

test('failed history fetch answers with empty history; unrelated thread never fetches history', async (t) => {
    const f = harness(t, { failHistory: true });
    await f.ask.handleMessage(user('200', '<@42> Help?'));
    assert.deepEqual(f.calls.find(([type]) => type === 'ask')[2], []);
    const g = harness(t, { channel: { ...thread, ownerId: 'other' } });
    await g.ask.handleMessage(user('200', '<@42> Help?'));
    assert.equal(
        g.calls.some(([type]) => type === 'history'),
        false,
    );
});

test('slash follow-up forwards component history and preserves upstream thread creation outside threads', async (t) => {
    const f = harness(t, { messages: [answer('101', 'Prior answer.', undefined, 'Prior question?')] });
    const context = {
        interaction: {
            channel: thread,
            user: { id: 'slash-user' },
            data: { options: [{ name: 'question', value: 'Follow up?' }] },
        },
        defer: async () => {},
        editResponse: async () => ({ id: '300', channelId: thread.id }),
    };
    await f.ask.handleCommand(context);
    assert.deepEqual(f.calls.find(([type]) => type === 'ask').slice(0, 3), [
        'ask',
        'Follow up?',
        [
            { role: 'user', content: 'Prior question?' },
            { role: 'assistant', content: 'Prior answer.' },
        ],
    ]);
    const g = harness(t, { channel: { id: 'parent', type: 0 } });
    await g.ask.handleCommand({
        ...context,
        interaction: { ...context.interaction, channel: { id: 'parent', type: 0 } },
    });
    assert.equal(g.calls.filter(([type]) => type === 'thread').length, 1);
    assert.equal(g.calls.filter(([type]) => type === 'send').length, 1);
    assert.deepEqual(g.calls.find(([type]) => type === 'ask')[2], []);
});

test('actual caller applies old five-turn and 6000-character history caps', async (t) => {
    for (const length of [20, 4000]) {
        const messages = Array.from({ length: 8 }, (_, index) => [
            user(String(101 + index * 2), `<@42> ${'q'.repeat(length)}`),
            answer(String(102 + index * 2), 'a'.repeat(length)),
        ]).flat();
        const f = harness(t, { messages });
        await f.ask.handleMessage(user('200', '<@42> Follow up?'));
        assert.deepEqual(
            f.calls.find(([type]) => type === 'ask')[2],
            plain(oldConversation.buildAskConversationHistory(messages.map(oldMessage), bot)),
        );
    }
});
