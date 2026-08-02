const assert = require('node:assert/strict');
const Eris = require('eris');
const Guild = require('eris/lib/structures/Guild');
const enableCommand = require('../../../src/commands/util/enable.js');

const GUILD_ID = '10000000000000000';
const CURRENT_CHANNEL_ID = '20000000000000000';
const SECOND_CHANNEL_ID = '20000000000000001';
const VOICE_CHANNEL_ID = '20000000000000002';
const CATEGORY_CHANNEL_ID = '20000000000000003';
const FORUM_CHANNEL_ID = '20000000000000004';
const THREAD_CHANNEL_ID = '20000000000000005';

function createBot() {
    const bot = new Eris.Client('Bot test');
    bot.guildShardMap[GUILD_ID] = 0;

    const guild = new Guild(
        {
            id: GUILD_ID,
            joined_at: new Date(0).toISOString(),
            member_count: 0,
            roles: [],
            channels: [
                { id: CURRENT_CHANNEL_ID, type: 0, name: 'current', permission_overwrites: [] },
                { id: SECOND_CHANNEL_ID, type: 0, name: 'second', permission_overwrites: [] },
                { id: VOICE_CHANNEL_ID, type: 2, name: 'voice', permission_overwrites: [] },
                { id: CATEGORY_CHANNEL_ID, type: 4, name: 'category', permission_overwrites: [] },
                { id: FORUM_CHANNEL_ID, type: 15, name: 'forum', permission_overwrites: [], available_tags: [] },
            ],
            threads: [
                {
                    id: THREAD_CHANNEL_ID,
                    type: 11,
                    name: 'thread',
                    parent_id: CURRENT_CHANNEL_ID,
                    owner_id: '30000000000000000',
                    thread_metadata: {
                        archived: false,
                        archive_timestamp: new Date(0).toISOString(),
                        auto_archive_duration: 1440,
                        locked: false,
                    },
                },
            ],
        },
        bot
    );

    bot.guilds.add(guild);
    return bot;
}

async function execute(args, command = 'disable', disabledCommandsByChannel = {}) {
    const writes = [];
    const sends = [];
    const askCommand = { alias: ['ask'] };
    const pingCommand = { alias: ['ping'] };
    const bot = createBot();
    const commands = {
        enable: enableCommand,
        disable: enableCommand,
        enabled: enableCommand,
        ask: askCommand,
        ping: pingCommand,
    };
    const context = {
        message: {
            args,
            command,
            channel: { id: CURRENT_CHANNEL_ID },
            guildID: GUILD_ID,
        },
        command: enableCommand,
        commands,
        bot,
        config: { embedcolor: 123 },
        snail_db: {
            Channel: {
                updateOne: async (...write) => writes.push(write),
                findById: async (channelID) => ({ disabledCommands: disabledCommandsByChannel[channelID] ?? [] }),
            },
        },
        send: async (message) => sends.push(message),
        error: async (message) => sends.push(message),
    };

    await enableCommand.execute.call(context);
    return { writes, sends };
}

async function selectedCommandsCanBeDisabledAcrossGuildParentChannels() {
    const { writes, sends } = await execute(['ask', 'ALL']);

    assert.deepEqual(
        writes.map(([filter, operation]) => [filter._id, operation]),
        [CURRENT_CHANNEL_ID, SECOND_CHANNEL_ID, VOICE_CHANNEL_ID, FORUM_CHANNEL_ID].map((channelID) => [
            channelID,
            { $addToSet: { disabledCommands: ['ask'] } },
        ])
    );
    assert.equal(sends[0], 'I disabled `ask` in 4 eligible channels!');
    assert.equal(sends[0].includes('<#'), false);
    assert.ok(sends[0].length < 2000);
}

async function multipleSelectedCommandsCanBeDisabledAcrossGuildParentChannels() {
    const { writes } = await execute(['ask', 'ping', 'all']);

    assert.deepEqual(
        writes.map(([filter, operation]) => [filter._id, operation]),
        [CURRENT_CHANNEL_ID, SECOND_CHANNEL_ID, VOICE_CHANNEL_ID, FORUM_CHANNEL_ID].map((channelID) => [
            channelID,
            { $addToSet: { disabledCommands: ['ask', 'ping'] } },
        ])
    );
}

async function loneAllStillDisablesEveryCommandInTheCurrentChannel() {
    const { writes } = await execute(['all']);

    assert.deepEqual(writes, [
        [{ _id: CURRENT_CHANNEL_ID }, { $addToSet: { disabledCommands: ['ask', 'ping'] } }, { upsert: true }],
    ]);
}

async function ordinaryPerChannelEnableAndDisableStayUnchanged() {
    const disabled = await execute(['ask', `<#${SECOND_CHANNEL_ID}>`]);
    const enabled = await execute(['ask', SECOND_CHANNEL_ID], 'enable');

    assert.deepEqual(disabled.writes, [
        [{ _id: SECOND_CHANNEL_ID }, { $addToSet: { disabledCommands: ['ask'] } }, { upsert: true }],
    ]);
    assert.deepEqual(enabled.writes, [
        [{ _id: SECOND_CHANNEL_ID }, { $pull: { disabledCommands: { $in: ['ask'] } } }, { upsert: true }],
    ]);
    assert.equal(disabled.sends[0], `I disabled \`ask\` in <#${SECOND_CHANNEL_ID}>!`);
    assert.equal(enabled.sends[0], `I enabled \`ask\` in <#${SECOND_CHANNEL_ID}>!`);
}

async function enableAskAllStillEnablesEveryCommandInTheCurrentChannel() {
    const { writes } = await execute(['ask', 'all'], 'enable');

    assert.deepEqual(writes, [
        [{ _id: CURRENT_CHANNEL_ID }, { $pull: { disabledCommands: { $in: ['ask', 'ping'] } } }, { upsert: true }],
    ]);
}

async function allBeforeAnExplicitChannelStillDisablesEveryCommandOnlyThere() {
    const { writes } = await execute(['ask', 'all', `<#${SECOND_CHANNEL_ID}>`]);

    assert.deepEqual(writes, [
        [{ _id: SECOND_CHANNEL_ID }, { $addToSet: { disabledCommands: ['ask', 'ping'] } }, { upsert: true }],
    ]);
}

async function terminalAllAfterAnExplicitChannelStillDisablesEveryCommandOnlyThere() {
    const { writes } = await execute(['ask', `<#${SECOND_CHANNEL_ID}>`, 'all']);

    assert.deepEqual(writes, [
        [{ _id: SECOND_CHANNEL_ID }, { $addToSet: { disabledCommands: ['ask', 'ping'] } }, { upsert: true }],
    ]);
}

async function allBeforeAnotherCommandStillDisablesEveryCommandInTheCurrentChannel() {
    const { writes } = await execute(['ask', 'all', 'ping']);

    assert.deepEqual(writes, [
        [{ _id: CURRENT_CHANNEL_ID }, { $addToSet: { disabledCommands: ['ask', 'ping'] } }, { upsert: true }],
    ]);
}

async function enabledListingStaysUnchanged() {
    const { sends, writes } = await execute([`<#${SECOND_CHANNEL_ID}>`], 'enabled', { [SECOND_CHANNEL_ID]: ['ask'] });

    assert.deepEqual(writes, []);
    assert.deepEqual(sends[0].embed.fields, [
        {
            name: `<#${SECOND_CHANNEL_ID}>`,
            value: '~~`ask`~~, `enable`, `ping`',
        },
    ]);
    assert.equal(sends[0].embed.color, 123);
}

const tests = [
    selectedCommandsCanBeDisabledAcrossGuildParentChannels,
    multipleSelectedCommandsCanBeDisabledAcrossGuildParentChannels,
    loneAllStillDisablesEveryCommandInTheCurrentChannel,
    ordinaryPerChannelEnableAndDisableStayUnchanged,
    enableAskAllStillEnablesEveryCommandInTheCurrentChannel,
    allBeforeAnExplicitChannelStillDisablesEveryCommandOnlyThere,
    terminalAllAfterAnExplicitChannelStillDisablesEveryCommandOnlyThere,
    allBeforeAnotherCommandStillDisablesEveryCommandInTheCurrentChannel,
    enabledListingStaysUnchanged,
];

(async () => {
    for (const test of tests) await test();
    console.log(`PASS ${tests.length}/${tests.length} enable command public-seam tests`);
})().catch((error) => {
    console.error(`FAIL enable command public-seam tests`);
    console.error(error);
    process.exitCode = 1;
});
