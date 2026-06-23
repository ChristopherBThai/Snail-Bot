import { afterEach, expect, test, vi } from 'vitest';
import moduleCommand, { buildModulePanel, getModuleActionID, ModulePanelIDs } from '../src/commands/module.js';
import { ModuleRegistry } from '../src/modules/index.js';
import { QuestListIDs } from '../src/modules/quest-list/constants.js';
import { buildQuestListMessage, buildVisibleMentionsResponse } from '../src/modules/quest-list/display.js';
import { QuestListModule } from '../src/modules/quest-list/index.js';
import { createInteractionRouter } from '../src/systems/discord/router.js';

test('does nothing beyond module logs when no quest list channel is configured', async () => {
    const databases = createDatabases();
    const module = createModule({ databases });

    await module.onEnable();

    expect(databases.loadCalls).toBe(0);
    expect(module.state().channelID).toBeUndefined();
    expect(JSON.stringify(module.panelComponents())).toContain('Not set. Select a channel to start Quest List.');
    expect(module.getLogs().map((entry) => entry.type)).toContain('quest_list.no_channel_configured');
});

test('Add My Quests does not refresh or publish when nothing new is added', async () => {
    const quest = storedQuest({ questID: 'quest-1' });
    const context = createContext({ userID: 'user-1' });
    const databases = createDatabases({
        config: { quest_list_channel: '123456789012345678' },
        queuedRows: [quest],
        activeDocs: [owoQuest({ _id: 'quest-1' })],
        stats: { 'user-1': { cookies_received: 3 } }
    });
    const module = createModule({
        databases
    });

    await module.onEnable();
    await module.interactionRoutes.components.get(QuestListIDs.AddQuests).handle(context);

    expect(context.deferred).toBe(true);
    expect(context.sentMessages).toHaveLength(0);
    expect(context.editedMessages).toHaveLength(0);
    expect(context.editedReply.components[0].content).toContain('already on the Quest List');
});

test('Add My Quests saves and publishes when new eligible quests are added', async () => {
    const context = createContext({ userID: 'user-1' });
    const databases = createDatabases({
        config: { quest_list_channel: '123456789012345678' },
        activeDocs: [owoQuest({ _id: 'quest-2' })],
        queuedDocs: [owoQuest({ _id: 'quest-2' })],
        stats: { 'user-1': { cookies_received: 4 } }
    });
    const module = createModule({
        databases
    });

    await module.onEnable();
    await module.interactionRoutes.components.get(QuestListIDs.AddQuests).handle(context);

    expect(databases.queuedRows).toEqual([
        {
            userID: 'user-1',
            questID: 'quest-2',
            questType: 'cookieBy',
            startValue: 0,
            targetValue: 10,
            addedAt: expect.any(Number)
        }
    ]);
    expect(module.getLogs().find((entry) => entry.type === 'quest_list.quests_added').data).toMatchObject({
        reason: 'user_add',
        userID: 'user-1',
        addedCount: 1,
        quests: [expect.objectContaining({ questID: 'quest-2', questType: 'cookieBy' })]
    });
    expect(context.sentMessages).toHaveLength(1);
    expect(context.sentMessages[0].channelID).toBe('123456789012345678');
    expect(context.editedReply.components[0].content).toContain('Added 1 quest');
});

test('Add My Quests handles database duplicates as already queued', async () => {
    const context = createContext({ userID: 'user-1' });
    const databases = createDatabases({
        config: { quest_list_channel: '123456789012345678' },
        activeDocs: [owoQuest({ _id: 'quest-1' })],
        stats: { 'user-1': { cookies_received: 4 } }
    });
    const module = createModule({ databases });

    await module.onEnable();
    databases.queuedRows.push(storedQuest({ questID: 'quest-1' }));
    await module.interactionRoutes.components.get(QuestListIDs.AddQuests).handle(context);

    expect(databases.queuedRows.map((quest) => quest.questID)).toEqual(['quest-1']);
    expect(context.sentMessages).toHaveLength(0);
    expect(context.editedMessages).toHaveLength(0);
    expect(context.editedReply.components[0].content).toContain('already on the Quest List');
});

test('Quest List panel uses a channel select for channel setting', async () => {
    const module = createModule({ databases: createDatabases() });

    await module.onEnable();

    const controls = module.panelComponents();
    const channelRow = controls.find(
        (component) => component.components?.[0]?.custom_id === QuestListIDs.ChannelSelect
    );

    expect(channelRow.components[0]).toMatchObject({
        custom_id: QuestListIDs.ChannelSelect,
        type: 8
    });
});

test('Quest List module panel stays within Discord component limit', async () => {
    const databases = createDatabases({
        config: { quest_list_channel: '123456789012345678' },
        queuedRows: [storedQuest({ questID: 'quest-1' })]
    });
    const module = createModule({ databases });
    const modules = new ModuleRegistry([module]);

    await module.onEnable();

    const panel = buildModulePanel(createContext({ modules }), module);

    expect(countComponents(panel.components)).toBeLessThanOrEqual(40);
});

test('Quest List message shows same-type quests for one user as separate entries', () => {
    const state = sameTypeQuestDisplayState();
    const message = buildQuestListMessage({
        ...state,
        accentColor: testConfig().colors.yellow,
        emptyMessage: 'There are no quests!'
    });
    const rendered = JSON.stringify(message);

    expect(rendered).toContain('01/10');
    expect(rendered).not.toContain('01/10` + `02/10');
    expect(rendered).toContain('02/10');
});

test('visible mentions return unique mentions only', () => {
    const first = displayQuest({ questID: 'quest-1', userID: 'user-1', count: 1, addedAt: 1 });
    const second = displayQuest({ questID: 'quest-2', userID: 'user-1', count: 2, addedAt: 2 });
    const third = displayQuest({ questID: 'quest-3', userID: 'user-2', questType: 'prayBy', count: 3, addedAt: 3 });
    const state = {
        capacity: {
            cookieBy: 3,
            prayBy: 3,
            curseBy: 3,
            emoteBy: 3
        },
        questsByType: {
            cookieBy: [first, second],
            prayBy: [third],
            curseBy: [],
            emoteBy: []
        }
    };
    const response = buildVisibleMentionsResponse(state);
    const rendered = JSON.stringify(response);

    expect(response.components[0].content).toBe('<@user-1> <@user-2>');
    expect(rendered).not.toContain('Cookie');
    expect(rendered).not.toContain('Pray');
    expect(rendered).not.toContain('1/10');
    expect(rendered).not.toContain('2/10');
});

function countComponents(components = []) {
    return components.reduce(
        (total, component) =>
            total +
            1 +
            countComponents(component.components) +
            countComponents(component.accessory ? [component.accessory] : []),
        0
    );
}

test('Manage Queue modal uses a user select for targeted removals', async () => {
    const context = createContext({ userID: 'manager-1' });
    const databases = createDatabases({
        config: { quest_list_channel: '123456789012345678' }
    });
    const module = createModule({
        databases
    });

    await module.onEnable();
    await module.interactionRoutes.components.get(QuestListIDs.ManageQueue).handle(context);

    const userLabel = context.openedModal.components.find((component) => component.label === 'Users');
    expect(userLabel.component).toMatchObject({
        custom_id: QuestListIDs.QueueUsersInput,
        min_values: 0,
        required: false,
        type: 5
    });
});

test('messages in the quest list channel queue one trailing refresh during cooldown', async () => {
    vi.useFakeTimers();

    const context = createContext({ userID: 'user-1' });
    const databases = createDatabases({
        config: { quest_list_channel: '123456789012345678' },
        queuedRows: [storedQuest({ questID: 'quest-1' })],
        queuedDocs: [owoQuest({ _id: 'quest-1' })],
        stats: { 'user-1': { cookies_received: 3 } }
    });
    const module = createModule({ databases });

    await module.onEnable();
    await module.events.get('ready')[0](context);
    context.sentMessages = [];
    const onMessage = module.events.get('message')[0];

    await onMessage({ channel_id: '123456789012345678', author: { bot: false } }, context);
    expect(context.editedMessages).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(400);
    await onMessage({ channel_id: '123456789012345678', author: { bot: false } }, context);
    expect(context.editedMessages).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(100);
    expect(context.editedMessages).toHaveLength(2);

    await onMessage({ channel_id: '123456789012345678', author: { bot: false } }, context);

    expect(context.sentMessages).toHaveLength(0);
    expect(context.editedMessages).toHaveLength(2);
    expect(context.editedMessages[0]).toMatchObject({
        channelID: '123456789012345678',
        messageID: 'posted-message'
    });
});

test('messages in the quest list channel update displayed progress', async () => {
    const context = createContext({ userID: 'user-1' });
    const stats = { 'user-1': { cookies_received: 1 } };
    const databases = createDatabases({
        config: { quest_list_channel: '123456789012345678' },
        queuedRows: [storedQuest({ questID: 'quest-1' })],
        queuedDocs: [owoQuest({ _id: 'quest-1' })],
        stats
    });
    const module = createModule({ databases });

    await module.onEnable();
    await module.events.get('ready')[0](context);
    context.sentMessages = [];
    stats['user-1'].cookies_received = 4;

    await module.events.get('message')[0]({ channelId: '123456789012345678', author: { bot: false } }, context);

    const rendered = JSON.stringify(context.editedMessages[0].message);
    expect(rendered).toContain('04/10');
});

test('startup posts a fresh quest list instead of loading a persisted message id', async () => {
    const context = createContext({ userID: 'user-1' });
    const databases = createDatabases({
        config: {
            quest_list_channel: '123456789012345678',
            quest_list_message: 'old-message'
        },
        queuedRows: [storedQuest({ questID: 'quest-1' })],
        queuedDocs: [owoQuest({ _id: 'quest-1' })],
        stats: { 'user-1': { cookies_received: 3 } }
    });
    const module = createModule({ databases });

    await module.onEnable();
    await module.events.get('ready')[0](context);

    expect(context.editedMessages).toHaveLength(0);
    expect(context.sentMessages).toHaveLength(1);
    expect(module.state().messageID).toBe('posted-message');
});

test('refresh deletes removed quests incrementally and logs removal reasons', async () => {
    const context = createContext({ userID: 'user-1' });
    const databases = createDatabases({
        config: { quest_list_channel: '123456789012345678' },
        queuedRows: [
            storedQuest({ questID: 'missing-quest' }),
            storedQuest({ questID: 'locked-quest' }),
            storedQuest({ questID: 'mismatch-quest' }),
            storedQuest({ questID: 'completed-quest' }),
            storedQuest({ questID: 'unsupported-quest' }),
            storedQuest({ questID: 'kept-quest', targetValue: 20 })
        ],
        queuedDocs: [
            owoQuest({ _id: 'locked-quest', locked: true }),
            owoQuest({ _id: 'mismatch-quest', targetValue: 20, targetCount: 20 }),
            owoQuest({ _id: 'completed-quest' }),
            owoQuest({ _id: 'unsupported-quest', questType: 'unknownBy' }),
            owoQuest({ _id: 'kept-quest', targetValue: 20, targetCount: 20 })
        ],
        stats: {
            'user-1': {
                cookies_received: 10
            }
        }
    });
    const module = createModule({ databases });

    await module.onEnable();
    await module.events.get('ready')[0](context);

    expect(databases.queuedRows.map((quest) => quest.questID)).toEqual(['kept-quest']);

    const removalLog = module.getLogs().find((entry) => entry.type === 'quest_list.quests_removed');
    expect(removalLog.data).toMatchObject({
        reason: 'ready',
        removedCount: 5,
        questCount: 1
    });
    expect(removalLog.data.removed.map((quest) => [quest.questID, quest.removalReason])).toEqual([
        ['missing-quest', 'owo_missing'],
        ['locked-quest', 'locked'],
        ['mismatch-quest', 'fingerprint_mismatch'],
        ['completed-quest', 'completed'],
        ['unsupported-quest', 'unsupported_type']
    ]);
});

test('messages in the quest list channel repost when the repost interval is reached', async () => {
    vi.useFakeTimers();

    const context = createContext({ userID: 'user-1' });
    const databases = createDatabases({
        config: {
            quest_list_channel: '123456789012345678',
            quest_list_repost_interval: 2
        },
        queuedRows: [storedQuest({ questID: 'quest-1' })],
        queuedDocs: [owoQuest({ _id: 'quest-1' })],
        stats: { 'user-1': { cookies_received: 3 } }
    });
    const module = createModule({ databases });

    await module.onEnable();
    await module.events.get('ready')[0](context);
    context.sentMessages = [];
    const onMessage = module.events.get('message')[0];

    await onMessage({ channel_id: '123456789012345678', author: { bot: false } }, context);
    await vi.advanceTimersByTimeAsync(400);
    await onMessage({ channel_id: '123456789012345678', author: { bot: false } }, context);
    await vi.advanceTimersByTimeAsync(500);

    expect(context.editedMessages).toHaveLength(1);
    expect(context.sentMessages).toHaveLength(1);
    expect(module.state()).toMatchObject({
        messageID: 'posted-message',
        messagesSinceRepost: 0
    });
});

test('bot messages in the quest list channel refresh and count toward repost interval', async () => {
    vi.useFakeTimers();

    const context = createContext({ userID: 'user-1' });
    const databases = createDatabases({
        config: {
            quest_list_channel: '123456789012345678',
            quest_list_repost_interval: 2
        },
        queuedRows: [storedQuest({ questID: 'quest-1' })],
        queuedDocs: [owoQuest({ _id: 'quest-1' })],
        stats: { 'user-1': { cookies_received: 3 } }
    });
    const module = createModule({ databases });

    await module.onEnable();
    await module.events.get('ready')[0](context);
    context.sentMessages = [];
    const onMessage = module.events.get('message')[0];

    await onMessage({ channel_id: '123456789012345678', author: { bot: true }, id: 'owo-message-1' }, context);
    await onMessage({ channel_id: '123456789012345678', author: { bot: true }, id: 'owo-message-2' }, context);

    expect(context.editedMessages).toHaveLength(1);
    expect(context.sentMessages).toHaveLength(1);
    expect(module.state()).toMatchObject({
        messagesSinceRepost: 0
    });
});

test('fast bot messages only trigger one repost per interval window', async () => {
    vi.useFakeTimers();

    const context = createContext({ userID: 'user-1' });
    const databases = createDatabases({
        config: {
            quest_list_channel: '123456789012345678',
            quest_list_repost_interval: 2
        },
        queuedRows: [storedQuest({ questID: 'quest-1' })],
        queuedDocs: [owoQuest({ _id: 'quest-1' })],
        stats: { 'user-1': { cookies_received: 3 } }
    });
    const module = createModule({ databases });

    await module.onEnable();
    await module.events.get('ready')[0](context);
    context.sentMessages = [];
    await Promise.all([
        module.events.get('message')[0](
            { channel_id: '123456789012345678', author: { bot: true }, id: 'owo-1' },
            context
        ),
        module.events.get('message')[0](
            { channel_id: '123456789012345678', author: { bot: true }, id: 'owo-2' },
            context
        ),
        module.events.get('message')[0](
            { channel_id: '123456789012345678', author: { bot: true }, id: 'owo-3' },
            context
        )
    ]);

    expect(context.sentMessages).toHaveLength(1);
    expect(context.editedMessages).toHaveLength(2);
    expect(module.state()).toMatchObject({
        messagesSinceRepost: 1
    });
});

test('the current quest list message does not count toward repost interval', async () => {
    const context = createContext({ userID: 'user-1' });
    const databases = createDatabases({
        config: {
            quest_list_channel: '123456789012345678',
            quest_list_repost_interval: 1
        },
        queuedRows: [storedQuest({ questID: 'quest-1' })],
        queuedDocs: [owoQuest({ _id: 'quest-1' })],
        stats: { 'user-1': { cookies_received: 3 } }
    });
    const module = createModule({ databases });

    await module.onEnable();
    await module.events.get('ready')[0](context);
    context.sentMessages = [];

    await module.events.get('message')[0](
        { channel_id: '123456789012345678', author: { bot: true }, id: 'posted-message' },
        context
    );

    expect(context.sentMessages).toHaveLength(0);
    expect(module.state()).toMatchObject({
        messagesSinceRepost: 0
    });
});

test('snail-authored messages do not refresh or count toward repost interval', async () => {
    const context = createContext({ botUserID: 'snail-bot', userID: 'user-1' });
    const databases = createDatabases({
        config: {
            quest_list_channel: '123456789012345678',
            quest_list_repost_interval: 1
        },
        queuedRows: [storedQuest({ questID: 'quest-1' })],
        queuedDocs: [owoQuest({ _id: 'quest-1' })],
        stats: { 'user-1': { cookies_received: 3 } }
    });
    const module = createModule({ databases });

    await module.onEnable();
    await module.events.get('ready')[0](context);
    context.sentMessages = [];

    await module.events.get('message')[0](
        { channel_id: '123456789012345678', author: { bot: true, id: 'snail-bot' }, id: 'different-message-id' },
        context
    );

    expect(context.sentMessages).toHaveLength(0);
    expect(context.editedMessages).toHaveLength(0);
    expect(module.state()).toMatchObject({
        messagesSinceRepost: 0
    });
});

test('module panel can disable a module and stale components report disabled state', async () => {
    const databases = createDatabases({ config: { quest_list_channel: '123456789012345678' } });
    const module = createModule({
        databases
    });
    const modules = new ModuleRegistry([module]);
    const rest = createRestMock();
    const router = createInteractionRouter({ commands: [moduleCommand], config: testConfig(), modules, rest });

    await modules.init();
    await router.route(componentInteraction(getModuleActionID(ModulePanelIDs.TogglePrefix, module.id)));
    await router.route(componentInteraction(QuestListIDs.AddQuests));

    expect(module.state().enabled).toBe(false);
    expect(rest.edits).toHaveLength(1);
    expect(rest.responses[0].message.components[0].content).toBe('Quest List module is disabled.');
});

test('module settings can be changed while the module is disabled', async () => {
    const databases = createDatabases({ config: { quest_list_channel: '123456789012345678' } });
    const module = createModule({
        databases
    });
    const modules = new ModuleRegistry([module]);
    const rest = createRestMock();
    const router = createInteractionRouter({ commands: [moduleCommand], config: testConfig(), modules, rest });

    await modules.init();
    await router.route(componentInteraction(getModuleActionID(ModulePanelIDs.TogglePrefix, module.id)));
    await router.route(componentInteraction(QuestListIDs.ChannelSelect, { values: ['234567890123456789'] }));

    expect(module.state()).toMatchObject({
        enabled: false,
        channelID: '234567890123456789',
        messageID: undefined
    });
    expect(databases.loadCalls).toBe(1);
    expect(rest.edits).toHaveLength(2);
    expect(rest.responses).toHaveLength(0);
});

test('module panel can show module logs', async () => {
    const module = createModule({ databases: createDatabases() });
    const modules = new ModuleRegistry([module]);
    const rest = createRestMock();
    const router = createInteractionRouter({ commands: [moduleCommand], config: testConfig(), modules, rest });

    await modules.init();
    await router.route(componentInteraction(getModuleActionID(ModulePanelIDs.LogsPrefix, module.id)));

    expect(rest.edits).toHaveLength(0);
    expect(rest.responses[0].message.components).toBeUndefined();
    expect(rest.responses[0].message.files[0]).toMatchObject({
        name: expect.stringMatching(/^quest_list-logs-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/),
        blob: expect.any(Blob)
    });
});

test('module panel can export module state', async () => {
    const module = createModule({ databases: createDatabases() });
    const modules = new ModuleRegistry([module]);
    const rest = createRestMock();
    const router = createInteractionRouter({ commands: [moduleCommand], config: testConfig(), modules, rest });

    await modules.init();
    await router.route(componentInteraction(getModuleActionID(ModulePanelIDs.StatePrefix, module.id)));

    expect(rest.responses[0].message.files[0]).toMatchObject({
        name: expect.stringMatching(/^quest_list-state-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/),
        blob: expect.any(Blob)
    });
    expect(rest.edits).toHaveLength(0);
});

test('module panel can update log level', async () => {
    const module = createModule({ databases: createDatabases() });
    const modules = new ModuleRegistry([module]);
    const rest = createRestMock();
    const router = createInteractionRouter({ commands: [moduleCommand], config: testConfig(), modules, rest });

    await modules.init();
    await router.route(
        componentInteraction(getModuleActionID(ModulePanelIDs.LogLevelPrefix, module.id), {
            values: [module.LogLevels.Debug]
        })
    );

    expect(rest.responses).toHaveLength(0);
    expect(module.logLevel).toBe(module.LogLevels.Debug);
    expect(rest.edits).toHaveLength(1);
});

test('full flow adds a user quest, refreshes it away when completed, and reposts at the interval', async () => {
    vi.useFakeTimers();

    const stats = { 'user-1': { cookies_received: 2 } };
    const context = createContext({ userID: 'user-1' });
    const databases = createDatabases({
        config: {
            quest_list_channel: '123456789012345678',
            quest_list_repost_interval: 2
        },
        activeDocs: [owoQuest({ _id: 'quest-1' })],
        queuedDocs: [owoQuest({ _id: 'quest-1' })],
        stats
    });
    const module = createModule({ databases });

    await module.onEnable();
    await module.events.get('ready')[0](context);
    await module.interactionRoutes.components.get(QuestListIDs.AddQuests).handle(context);

    expect(databases.queuedRows.map((quest) => quest.questID)).toEqual(['quest-1']);
    expect(context.sentMessages).toHaveLength(1);
    expect(context.editedMessages).toHaveLength(1);
    expect(context.editedReply.components[0].content).toContain('Added 1 quest');

    stats['user-1'].cookies_received = 10;
    context.sentMessages = [];
    context.editedMessages = [];
    const onMessage = module.events.get('message')[0];

    await onMessage({ channel_id: '123456789012345678', author: { bot: false } }, context);
    await vi.advanceTimersByTimeAsync(500);
    await onMessage({ channel_id: '123456789012345678', author: { bot: false } }, context);

    expect(databases.queuedRows).toEqual([]);
    expect(context.editedMessages).toHaveLength(2);
    expect(context.sentMessages).toHaveLength(1);
    expect(module.state()).toMatchObject({
        messagesSinceRepost: 0,
        questCount: 0
    });
    expect(
        module
            .getLogs()
            .find((entry) => entry.type === 'quest_list.quests_removed')
            .data.removed.map((quest) => [quest.questID, quest.removalReason])
    ).toEqual([['quest-1', 'completed']]);
});

test('full flow lets managers configure a disabled module and start it later', async () => {
    const context = createContext({ data: { values: ['234567890123456789'] }, userID: 'manager-1' });
    const databases = createDatabases();
    const module = createModule({ databases });
    const modules = new ModuleRegistry([module]);

    await modules.init();
    await modules.disable(module);
    await module.interactionRoutes.components.get(QuestListIDs.ChannelSelect).handle(context);

    expect(module.state()).toMatchObject({
        enabled: false,
        channelID: '234567890123456789',
        messageID: undefined
    });
    expect(context.sentMessages).toHaveLength(0);
    expect(context.edits).toHaveLength(1);

    await modules.enable(module, context);

    expect(module.state()).toMatchObject({
        enabled: true,
        channelID: '234567890123456789',
        messageID: 'posted-message'
    });
    expect(context.sentMessages).toHaveLength(1);
});

test('full flow lets managers remove queued users incrementally and update the panel', async () => {
    const context = createContext({
        modalValues: {
            [QuestListIDs.QueueTypeInput]: ['all'],
            [QuestListIDs.QueueUsersInput]: ['user-1'],
            [QuestListIDs.QueueNotifyInput]: false
        },
        userID: 'manager-1'
    });
    const databases = createDatabases({
        config: { quest_list_channel: '123456789012345678' },
        queuedRows: [
            storedQuest({ questID: 'quest-1', userID: 'user-1' }),
            storedQuest({ questID: 'quest-2', userID: 'user-2' })
        ],
        queuedDocs: [owoQuest({ _id: 'quest-1', userId: 'user-1' }), owoQuest({ _id: 'quest-2', userId: 'user-2' })],
        stats: {
            'user-1': { cookies_received: 2 },
            'user-2': { cookies_received: 3 }
        }
    });
    const module = createModule({ databases });

    await module.onEnable();
    await module.events.get('ready')[0](context);
    context.sentMessages = [];
    await module.interactionRoutes.modals.get(QuestListIDs.ManageQueueModal).handle(context);

    expect(databases.queuedRows.map((quest) => quest.questID)).toEqual(['quest-2']);
    expect(module.state()).toMatchObject({
        questCount: 1,
        userCount: 1
    });
    expect(context.editedMessages).toHaveLength(1);
    expect(context.edits).toHaveLength(1);
    expect(context.sentMessages).toHaveLength(0);
    expect(module.getLogs().find((entry) => entry.type === 'quest_list.quests_removed').data).toMatchObject({
        reason: 'staff_removed',
        removedCount: 1,
        removed: [expect.objectContaining({ questID: 'quest-1' })]
    });
});

test('full flow lets managers clear a selected quest list by leaving users empty', async () => {
    const context = createContext({
        modalValues: {
            [QuestListIDs.QueueTypeInput]: ['cookieBy'],
            [QuestListIDs.QueueNotifyInput]: false
        },
        userID: 'manager-1'
    });
    const databases = createDatabases({
        config: { quest_list_channel: '123456789012345678' },
        queuedRows: [
            storedQuest({ questID: 'quest-1', questType: 'cookieBy', userID: 'user-1' }),
            storedQuest({ questID: 'quest-2', questType: 'prayBy', userID: 'user-2' })
        ],
        queuedDocs: [
            owoQuest({ _id: 'quest-1', questType: 'cookieBy', userId: 'user-1' }),
            owoQuest({ _id: 'quest-2', questType: 'prayBy', statKey: 'pray_received', userId: 'user-2' })
        ],
        stats: {
            'user-1': { cookies_received: 2 },
            'user-2': { pray_received: 3 }
        }
    });
    const module = createModule({ databases });

    await module.onEnable();
    await module.events.get('ready')[0](context);
    context.sentMessages = [];
    await module.interactionRoutes.modals.get(QuestListIDs.ManageQueueModal).handle(context);

    expect(databases.queuedRows.map((quest) => quest.questID)).toEqual(['quest-2']);
    expect(module.getLogs().find((entry) => entry.type === 'quest_list.quests_removed').data).toMatchObject({
        reason: 'staff_clear',
        action: 'clear',
        type: 'cookieBy',
        removedCount: 1,
        removed: [expect.objectContaining({ questID: 'quest-1' })]
    });
});

afterEach(() => {
    vi.useRealTimers();
});

function createModule({ databases = createDatabases() } = {}) {
    return new QuestListModule({
        config: testConfig(),
        databases
    });
}

function testConfig() {
    return {
        discord: {
            guildId: '987654321098765432'
        },
        roles: {
            helper: [],
            manager: [],
            admin: []
        },
        modules: {
            defaultLogsLimit: 50_000
        },
        colors: {
            primary: 0x5865f2,
            success: 0x2ecc71,
            warning: 0xf1c40f,
            danger: 0xe74c3c,
            neutral: 0x95a5a6,
            red: 0xe74c3c,
            orange: 0xe67e22,
            yellow: 0xf1c40f,
            green: 0x2ecc71,
            blue: 0x3498db,
            purple: 0x9b59b6,
            pastel: {
                red: 0xffadad,
                orange: 0xffd6a5,
                yellow: 0xfdffb6,
                green: 0xcaffbf,
                blue: 0x9bf6ff,
                purple: 0xbdb2ff
            }
        },
        users: {
            owner: 'manager-1'
        }
    };
}

function createDatabases({ activeDocs = [], config = {}, queuedDocs = activeDocs, queuedRows = [], stats = {} } = {}) {
    const configValues = new Map(Object.entries(config));
    const databases = {
        loadCalls: 0,
        queuedRows: [...queuedRows],
        snail: {
            mongo: {
                Config: {
                    findById(key) {
                        return {
                            lean: async () => {
                                if (!configValues.has(key)) {
                                    return undefined;
                                }

                                return { _id: key, value: configValues.get(key) };
                            }
                        };
                    },
                    async deleteOne({ _id: key }) {
                        configValues.delete(key);
                    },
                    async updateOne({ _id: key }, update) {
                        configValues.set(key, update.$set.value);
                    }
                },
                Quest: {
                    find() {
                        return {
                            sort() {
                                return {
                                    lean: async () => {
                                        databases.loadCalls++;
                                        return databases.queuedRows;
                                    }
                                };
                            }
                        };
                    },
                    async deleteMany(query = {}) {
                        const questIDs = new Set(query.questID?.$in ?? []);

                        if (!questIDs.size) {
                            databases.queuedRows = [];
                            return;
                        }

                        databases.queuedRows = databases.queuedRows.filter((quest) => !questIDs.has(quest.questID));
                    },
                    async bulkWrite(operations) {
                        const upsertedIds = {};

                        operations.forEach((operation, index) => {
                            const quest = operation.updateOne.update.$setOnInsert;
                            const exists = databases.queuedRows.some((row) => row.questID === quest.questID);

                            if (exists) {
                                return;
                            }

                            databases.queuedRows.push(quest);
                            upsertedIds[index] = quest.questID;
                        });

                        return { upsertedIds };
                    }
                }
            }
        },
        owo: {
            mongo: {
                UserQuest: {
                    find(query) {
                        return createUserQuestQuery(query.userId ? activeDocs : filterQueuedDocs(queuedDocs, query));
                    }
                }
            },
            redis: {
                client: {
                    async hmGet(key, keys) {
                        const userID = key.slice('user_stats:'.length);

                        return keys.map((statKey) => stats[userID]?.[statKey]?.toString());
                    }
                }
            }
        }
    };

    return databases;
}

function createUserQuestQuery(docs) {
    return {
        sort() {
            return {
                lean: async () => docs
            };
        },
        lean: async () => docs
    };
}

function filterQueuedDocs(docs, query) {
    const questIDs = new Set(query._id?.$in?.map(String) ?? []);

    return docs.filter((doc) => questIDs.has(String(doc._id)));
}

function createContext({
    botUserID,
    config = testConfig(),
    data = {},
    modalValues = {},
    modules = new ModuleRegistry([]),
    userID
} = {}) {
    return {
        config,
        data,
        botUserID,
        deferred: false,
        edits: [],
        editedMessages: [],
        modalValues,
        modules,
        sentMessages: [],
        userID,
        async defer() {
            this.deferred = true;
        },
        async editMessage(channelID, messageID, message) {
            this.editedMessages.push({ channelID, messageID, message });
        },
        async edit(message) {
            this.edits.push(message);
        },
        async editReply(message) {
            this.editedReply = message;
        },
        async openModal(modal) {
            this.openedModal = modal;
        },
        async respond(message) {
            this.response = message;
        },
        async sendMessage(channelID, message) {
            this.sentMessages.push({ channelID, message });

            return { id: 'posted-message' };
        }
    };
}

function createRestMock() {
    return {
        edits: [],
        responses: [],
        async edit(interaction, message) {
            this.edits.push({ interaction, message });
        },
        async respond(interaction, message) {
            this.responses.push({ interaction, message });
        }
    };
}

function componentInteraction(customID, data = {}) {
    return {
        t: 'INTERACTION_CREATE',
        d: {
            id: `interaction-${customID}`,
            token: 'token',
            type: 3,
            data: { custom_id: customID, ...data },
            member: { user: { id: 'manager-1' }, roles: [] }
        }
    };
}

function storedQuest(overrides = {}) {
    return {
        userID: 'user-1',
        questID: 'quest-1',
        questType: 'cookieBy',
        startValue: 0,
        targetValue: 10,
        addedAt: 1000,
        ...overrides
    };
}

function sameTypeQuestDisplayState() {
    const first = displayQuest({ questID: 'quest-1', count: 1, addedAt: 1 });
    const second = displayQuest({ questID: 'quest-2', count: 2, addedAt: 2 });

    return {
        capacity: {
            cookieBy: 3,
            prayBy: 3,
            curseBy: 3,
            emoteBy: 3
        },
        quests: [first, second],
        questsByType: {
            cookieBy: [first, second],
            prayBy: [],
            curseBy: [],
            emoteBy: []
        }
    };
}

function displayQuest(overrides = {}) {
    return {
        userID: 'user-1',
        questID: 'quest-1',
        questType: 'cookieBy',
        startValue: 0,
        targetValue: 10,
        addedAt: 1000,
        count: 1,
        total: 10,
        ...overrides
    };
}

function owoQuest(overrides = {}) {
    return {
        _id: 'quest-1',
        userId: 'user-1',
        questType: 'cookieBy',
        statKey: 'cookies_received',
        startValue: 0,
        targetValue: 10,
        targetCount: 10,
        locked: false,
        ...overrides
    };
}
