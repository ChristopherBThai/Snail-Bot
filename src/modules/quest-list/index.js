import { buildModulePanel } from '../../commands/module.js';
import {
    actionButton,
    actionRow,
    ButtonStyle,
    ChannelType,
    channelSelect,
    checkbox,
    ephemeralText,
    label,
    section,
    separator,
    stringSelect,
    TextInputStyle,
    textDisplay,
    textInput,
    userSelect
} from '../../systems/discord/components.js';
import { auth, lines } from '../../utils.js';
import { Module } from '../index.js';
import { DefaultCapacity, DefaultEmptyMessage, QuestListIDs, QuestListSettings, QuestTypes } from './constants.js';
import { createQuestListData } from './data.js';
import {
    buildAddQuestsResponse,
    buildQuestListMessage,
    buildRemovedUsersNotice,
    buildUserPositionResponse,
    buildVisibleMentionsResponse
} from './display.js';

const ConfigKeys = Object.freeze({
    Channel: 'channel',
    EmptyMessage: 'empty_message',
    RepostInterval: 'repost_interval',
    Capacity: {
        cookieBy: 'cookie_capacity',
        prayBy: 'pray_capacity',
        curseBy: 'curse_capacity',
        emoteBy: 'action_capacity'
    }
});

export class QuestListModule extends Module {
    static LogTypes = Object.freeze({
        ConfigUpdated: 'quest_list.config_updated',
        ListPublished: 'quest_list.list_published',
        NoChannelConfigured: 'quest_list.no_channel_configured',
        QuestsAdded: 'quest_list.quests_added',
        QuestsLoaded: 'quest_list.quests_loaded',
        QuestsRemoved: 'quest_list.quests_removed',
        QuestsRefreshed: 'quest_list.quests_refreshed'
    });

    #capacity;
    #channelID;
    #config;
    #data;
    #emptyMessage;
    #guildID;
    #messageEventQueue;
    #messageID;
    #messagesSinceRepost;
    #questIDs;
    #quests;
    #questsByType;
    #questsByUser;
    #refreshQueued;
    #refreshTimer;
    #repostInterval;

    constructor({ config, databases }) {
        super({
            databases,
            id: 'quest_list',
            name: 'Quest List',
            description: 'Maintains the shared OwO social quest queue.',
            logsLimit: config.modules.defaultLogsLimit
        });

        this.#capacity = { ...DefaultCapacity };
        this.#channelID = undefined;
        this.#config = config;
        this.#data = createQuestListData(databases);
        this.#emptyMessage = DefaultEmptyMessage;
        this.#guildID = config.discord.guildId;
        this.#messageEventQueue = Promise.resolve();
        this.#messageID = undefined;
        this.#messagesSinceRepost = 0;
        this.#questIDs = new Set();
        this.#quests = [];
        this.#questsByType = {};
        this.#questsByUser = {};
        this.#refreshQueued = false;
        this.#refreshTimer = undefined;
        this.#repostInterval = 15;
        this.#setQuests([]);

        this.addComponent(QuestListIDs.AddQuests, (context) => this.#addUserQuests(context));
        this.addComponent(QuestListIDs.MyPosition, (context) => this.#showUserPosition(context));
        this.addComponent(QuestListIDs.VisibleMentions, (context) => this.#showVisibleMentions(context));
        this.addComponent(QuestListIDs.ToggleReminders, (context) => this.#toggleReminders(context));
        this.addComponent(QuestListIDs.ChannelSelect, (context) => this.#setChannelFromSelect(context), {
            allowDisabled: true,
            auth: auth.manager
        });
        this.addComponent(
            QuestListIDs.EditCapacity,
            (context) => this.#openSettingsModal(context, QuestListSettings.Capacity),
            {
                allowDisabled: true,
                auth: auth.manager
            }
        );
        this.addComponent(
            QuestListIDs.EditRepostInterval,
            (context) => this.#openSettingsModal(context, QuestListSettings.RepostInterval),
            { allowDisabled: true, auth: auth.manager }
        );
        this.addComponent(
            QuestListIDs.EditEmptyMessage,
            (context) => this.#openSettingsModal(context, QuestListSettings.EmptyMessage),
            { allowDisabled: true, auth: auth.manager }
        );
        this.addComponent(QuestListIDs.ManageQueue, (context) => this.#openManageQueueModal(context), {
            auth: auth.manager
        });
        this.addComponent(QuestListIDs.ForceRepost, (context) => this.#forceRepost(context), { auth: auth.manager });
        this.addModal(QuestListIDs.CapacityModal, (context) => this.#setCapacityFromModal(context), {
            allowDisabled: true,
            auth: auth.manager
        });
        this.addModal(QuestListIDs.RepostIntervalModal, (context) => this.#setRepostIntervalFromModal(context), {
            allowDisabled: true,
            auth: auth.manager
        });
        this.addModal(QuestListIDs.EmptyMessageModal, (context) => this.#setEmptyMessageFromModal(context), {
            allowDisabled: true,
            auth: auth.manager
        });
        this.addModal(QuestListIDs.ManageQueueModal, (context) => this.#manageQueue(context), {
            auth: auth.manager
        });
        this.addEvent('ready', (discord) => this.#onReady(discord));
        this.addEvent('message', (message, discord) => this.#onMessage(message, discord));
    }

    async onEnable(context) {
        await this.#loadConfig();

        if (!this.#channelID) {
            this.log({
                level: this.LogLevels.Info,
                type: this.constructor.LogTypes.NoChannelConfigured,
                data: { message: 'Quest List channel is not configured.' }
            });
            return;
        }

        await this.#loadQuests();
        if (context) {
            await this.#refreshQuests('module_enabled');
            await this.#publishList(context, { repost: true });
        }
    }

    state() {
        return {
            ...super.state(),
            channelID: this.#channelID,
            messageID: this.#messageID,
            capacity: this.#capacity,
            repostInterval: this.#repostInterval,
            messagesSinceRepost: this.#messagesSinceRepost,
            emptyMessage: this.#emptyMessage,
            questTypes: Object.keys(QuestTypes),
            questCount: this.#quests.length,
            userCount: Object.keys(this.#questsByUser).length,
            questsByType: this.#questsByType,
            quests: this.#quests
        };
    }

    async onDisable() {
        clearTimeout(this.#refreshTimer);
        this.#refreshQueued = false;
        this.#refreshTimer = undefined;
    }

    panelComponents() {
        const controls = [
            separator(),
            section(
                [textDisplay(lines('**Message**', this.#messageLink()))],
                actionButton('Repost', QuestListIDs.ForceRepost, { style: ButtonStyle.Primary })
            ),
            section(
                [textDisplay(lines('**Queued Quests**', this.#quests.length.toLocaleString()))],
                actionButton('Manage', QuestListIDs.ManageQueue)
            ),
            textDisplay(lines('**Messages Since Repost**', this.#messagesSinceRepost.toLocaleString())),
            separator(),
            textDisplay('### Settings'),
            section(
                [
                    textDisplay(
                        lines(
                            '**Visible Limits**',
                            `Cookie ${this.#capacity.cookieBy}, Pray ${this.#capacity.prayBy}, Curse ${this.#capacity.curseBy}, Action ${this.#capacity.emoteBy}`
                        )
                    )
                ],
                actionButton('Edit', QuestListIDs.EditCapacity)
            ),
            separator(),
            section(
                [textDisplay(lines('**Repost Interval**', `${this.#repostInterval.toLocaleString()} messages`))],
                actionButton('Edit', QuestListIDs.EditRepostInterval)
            ),
            separator(),
            section(
                [textDisplay(lines('**Empty Message**', this.#emptyMessage))],
                actionButton('Edit', QuestListIDs.EditEmptyMessage)
            ),
            separator(),
            textDisplay(
                lines(
                    '**Post Channel**',
                    this.#channelID ? `<#${this.#channelID}>` : 'Not set. Select a channel to start Quest List.'
                )
            ),
            actionRow(
                channelSelect(QuestListIDs.ChannelSelect, {
                    channelTypes: [ChannelType.GuildText],
                    defaultValues: this.#channelID ? [{ id: this.#channelID, type: 'channel' }] : undefined,
                    placeholder: 'Choose Quest List channel'
                })
            )
        ];

        return controls;
    }

    async #loadConfig() {
        this.#channelID = (await this.getConfig(ConfigKeys.Channel)) ?? this.#channelID;
        this.#emptyMessage = (await this.getConfig(ConfigKeys.EmptyMessage)) ?? this.#emptyMessage;
        this.#repostInterval = (await this.getConfig(ConfigKeys.RepostInterval)) ?? this.#repostInterval;

        for (const [type, key] of Object.entries(ConfigKeys.Capacity)) {
            this.#capacity[type] = (await this.getConfig(key)) ?? this.#capacity[type];
        }
    }

    async #loadQuests() {
        const quests = await this.#data.loadQueuedQuests();
        this.#setQuests(quests.map(normalizeStoredQuest));
        this.log({
            level: this.LogLevels.Info,
            type: this.constructor.LogTypes.QuestsLoaded,
            data: {
                quests: this.#quests.length,
                users: Object.keys(this.#questsByUser).length
            }
        });
    }

    async #onReady(discord) {
        if (!this.#channelID) {
            this.log({
                level: this.LogLevels.Info,
                type: this.constructor.LogTypes.NoChannelConfigured,
                data: { message: 'Quest List channel is not configured.' }
            });
            return;
        }

        await this.#refreshQuests('ready');
        await this.#publishList(discord);
    }

    async #onMessage(message, discord) {
        return this.#enqueueMessageEvent(() => this.#handleMessage(message, discord));
    }

    async #handleMessage(message, discord) {
        if (!this.#channelID || getMessageChannelID(message) !== this.#channelID) {
            return;
        }

        if (getMessageID(message) === this.#messageID || isOwnBotMessage(message, discord)) {
            return;
        }

        await this.#refreshAfterMessage(discord);

        this.#messagesSinceRepost++;
        if (this.#messagesSinceRepost < this.#repostInterval) {
            return;
        }

        clearTimeout(this.#refreshTimer);
        this.#refreshQueued = false;
        this.#refreshTimer = undefined;
        await this.#refreshAndPublish('repost_interval', discord, { repost: true });
    }

    #enqueueMessageEvent(work) {
        const next = this.#messageEventQueue.catch(() => {}).then(work);

        this.#messageEventQueue = next.catch((error) => this.#logRefreshError('message_event_queue', error));

        return next;
    }

    async #addUserQuests(context) {
        if (!this.#channelID) {
            await context.respond(ephemeralText('The Quest List channel has not been set yet.'));
            return;
        }

        if (!context.userID) {
            await context.respond(ephemeralText('I could not identify your user.'));
            return;
        }

        await context.defer({ ephemeral: true });
        const activeQuests = await this.#getActiveUserQuests(context.userID, Date.now());
        const newQuests = activeQuests.filter((quest) => !this.#questIDs.has(quest.questID));

        if (!newQuests.length) {
            await context.editReply(
                buildAddQuestsResponse({
                    capacity: this.#capacity,
                    newQuests,
                    questsByType: this.#questsByType,
                    queuedQuests: this.#questsByUser[context.userID] ?? [],
                    userID: context.userID
                })
            );
            return;
        }

        const addedQuests = await this.#addQueuedQuests(newQuests, { reason: 'user_add', userID: context.userID });
        if (!addedQuests.length) {
            await this.#loadQuests();
            await context.editReply(
                buildAddQuestsResponse({
                    capacity: this.#capacity,
                    newQuests: addedQuests,
                    questsByType: this.#questsByType,
                    queuedQuests: this.#questsByUser[context.userID] ?? [],
                    userID: context.userID
                })
            );
            return;
        }

        await context.editReply(
            buildAddQuestsResponse({
                capacity: this.#capacity,
                newQuests: addedQuests,
                questsByType: this.#questsByType,
                queuedQuests: this.#questsByUser[context.userID] ?? [],
                userID: context.userID
            })
        );
        await this.#refreshQuests('after_add');
        await this.#publishList(context);
    }

    async #showUserPosition(context) {
        if (!context.userID) {
            await context.respond(ephemeralText('I could not identify your user.'));
            return;
        }

        const userQuests = this.#questsByUser[context.userID] ?? [];
        if (!userQuests.length) {
            await context.respond(ephemeralText('You do not have any quests on the Quest List.'));
            return;
        }

        await context.respond(
            buildUserPositionResponse({
                capacity: this.#capacity,
                questsByType: this.#questsByType,
                userID: context.userID,
                userQuests
            })
        );
    }

    async #showVisibleMentions(context) {
        await context.respond(
            buildVisibleMentionsResponse({
                capacity: this.#capacity,
                questsByType: this.#questsByType
            })
        );
    }

    async #toggleReminders(context) {
        await context.respond(ephemeralText('Quest List reminders are a work in progress and coming soon.'));
    }

    async #openSettingsModal(context, setting) {
        switch (setting) {
            case QuestListSettings.Capacity:
                await context.openModal({
                    title: 'Quest List Visible Limits',
                    custom_id: QuestListIDs.CapacityModal,
                    components: [
                        label(
                            'Cookie',
                            textInput(QuestListIDs.CookieCapacityInput, { value: String(this.#capacity.cookieBy) })
                        ),
                        label(
                            'Pray',
                            textInput(QuestListIDs.PrayCapacityInput, { value: String(this.#capacity.prayBy) })
                        ),
                        label(
                            'Curse',
                            textInput(QuestListIDs.CurseCapacityInput, { value: String(this.#capacity.curseBy) })
                        ),
                        label(
                            'Action',
                            textInput(QuestListIDs.ActionCapacityInput, { value: String(this.#capacity.emoteBy) })
                        )
                    ]
                });
                return;
            case QuestListSettings.RepostInterval:
                await context.openModal({
                    title: 'Quest List Repost Interval',
                    custom_id: QuestListIDs.RepostIntervalModal,
                    components: [
                        label(
                            'Messages between reposts',
                            textInput(QuestListIDs.RepostIntervalInput, { value: String(this.#repostInterval) })
                        )
                    ]
                });
                return;
            case QuestListSettings.EmptyMessage:
                await context.openModal({
                    title: 'Quest List Empty Message',
                    custom_id: QuestListIDs.EmptyMessageModal,
                    components: [
                        label(
                            'Empty message',
                            textInput(QuestListIDs.EmptyMessageInput, {
                                value: this.#emptyMessage,
                                style: TextInputStyle.Paragraph
                            })
                        )
                    ]
                });
                return;
            default:
                await context.respond(ephemeralText('Choose a valid Quest List setting.'));
        }
    }

    async #openManageQueueModal(context) {
        await context.openModal({
            title: 'Manage Quest Queue',
            custom_id: QuestListIDs.ManageQueueModal,
            components: [
                label(
                    'Quest Type',
                    stringSelect(
                        QuestListIDs.QueueTypeInput,
                        [
                            { label: 'All', value: 'all' },
                            ...Object.entries(QuestTypes).map(([type, data]) => ({ label: data.name, value: type }))
                        ],
                        'Choose a quest type'
                    )
                ),
                label(
                    'Notify Users',
                    checkbox(QuestListIDs.QueueNotifyInput),
                    'Posts a notice in the quest list channel mentioning affected users.'
                ),
                label(
                    'Users',
                    userSelect(QuestListIDs.QueueUsersInput, {
                        minValues: 0,
                        placeholder: 'Choose users to remove',
                        required: false
                    }),
                    'Leave empty to clear the selected list.'
                )
            ]
        });
    }

    async #setChannelFromSelect(context) {
        const channelID = context.data.values?.[0];
        if (!channelID) {
            await context.respond(ephemeralText('Choose a valid channel.'));
            return;
        }

        this.#channelID = channelID;
        this.#messageID = undefined;
        this.#messagesSinceRepost = 0;
        await this.setConfig(ConfigKeys.Channel, channelID);
        if (this.active) {
            await this.#loadQuests();
            await this.#refreshQuests('channel_set');
            await this.#publishList(context, { repost: true });
        }
        await this.#updateModulePanel(context, `Set the Quest List channel to <#${channelID}>.`);
        this.#logConfigUpdated('channelID', channelID);
    }

    async #setCapacityFromModal(context) {
        const capacity = {
            cookieBy: getModalPositiveInteger(context, QuestListIDs.CookieCapacityInput),
            prayBy: getModalPositiveInteger(context, QuestListIDs.PrayCapacityInput),
            curseBy: getModalPositiveInteger(context, QuestListIDs.CurseCapacityInput),
            emoteBy: getModalPositiveInteger(context, QuestListIDs.ActionCapacityInput)
        };

        if (Object.values(capacity).some((value) => !value)) {
            await context.respond(ephemeralText('All visible limits must be numbers greater than 0.'));
            return;
        }

        this.#capacity = capacity;
        for (const [type, value] of Object.entries(capacity)) {
            await this.setConfig(ConfigKeys.Capacity[type], value);
        }

        if (this.active && this.#channelID) {
            await this.#publishList(context);
        }

        await this.#updateModulePanel(context, 'Updated the Quest List visible limits.');
        this.#logConfigUpdated('capacity', capacity);
    }

    async #setRepostIntervalFromModal(context) {
        const repostInterval = getModalPositiveInteger(context, QuestListIDs.RepostIntervalInput);
        if (!repostInterval) {
            await context.respond(ephemeralText('Choose a number greater than 0.'));
            return;
        }

        this.#repostInterval = repostInterval;
        this.#messagesSinceRepost = 0;
        await this.setConfig(ConfigKeys.RepostInterval, repostInterval);
        await this.#updateModulePanel(
            context,
            `Set the Quest List repost interval to ${repostInterval.toLocaleString()} messages.`
        );
        this.#logConfigUpdated('repostInterval', repostInterval);
    }

    async #setEmptyMessageFromModal(context) {
        const emptyMessage = getModalString(context, QuestListIDs.EmptyMessageInput)?.trim();
        if (!emptyMessage) {
            await context.respond(ephemeralText('Provide an empty message.'));
            return;
        }

        this.#emptyMessage = emptyMessage;
        await this.setConfig(ConfigKeys.EmptyMessage, emptyMessage);

        if (this.active && this.#channelID) {
            await this.#publishList(context);
        }

        await this.#updateModulePanel(context, 'Updated the Quest List empty message.');
        this.#logConfigUpdated('emptyMessage', emptyMessage);
    }

    async #manageQueue(context) {
        const type = getModalSelectValue(context, QuestListIDs.QueueTypeInput);
        const notify = context.modalValues[QuestListIDs.QueueNotifyInput] === true;
        const userIDs = getUniqueModalSelectValues(context, QuestListIDs.QueueUsersInput);
        const clearing = !userIDs.length;

        if (type !== 'all' && !QuestTypes[type]) {
            await context.respond(ephemeralText('Choose a valid quest type.'));
            return;
        }

        if (notify && !this.#channelID) {
            await context.respond(ephemeralText('Set a Quest List channel before notifying removed users.'));
            return;
        }

        const removed = clearing ? this.#clearQueue(type) : this.#removeUsersFromQueue(type, userIDs);

        await this.#deleteQueuedQuests(removed, {
            reason: clearing ? 'staff_clear' : 'staff_removed',
            action: clearing ? 'clear' : 'remove',
            type,
            userID: context.userID
        });
        if (notify) {
            await this.#notifyRemovedUsers(context, type, removed);
        }

        if (removed.length && this.#channelID) {
            await this.#publishList(context);
        }

        await this.#updateModulePanel(
            context,
            `${clearing ? 'Cleared' : 'Removed'} ${removed.length.toLocaleString()} queued quest${removed.length === 1 ? '' : 's'}.`
        );
    }

    async #forceRepost(context) {
        if (!this.#channelID) {
            await context.respond(ephemeralText('Set a Quest List channel before reposting.'));
            return;
        }

        await this.#refreshQuests('force_repost');
        await this.#publishList(context, { repost: true });
        await this.#updateModulePanel(context, 'Reposted the Quest List.');
    }

    async #getActiveUserQuests(userID, addedAt) {
        const docs = await this.#data.getActiveUserQuests(userID, Object.keys(QuestTypes));
        const savedQuestByID = Object.fromEntries(
            docs.map((doc) => [
                String(doc._id),
                {
                    userID: doc.userId,
                    questID: String(doc._id),
                    questType: doc.questType,
                    startValue: Number(doc.startValue),
                    targetValue: Number(doc.targetValue),
                    addedAt
                }
            ])
        );

        return await this.#buildDisplayQuests(docs, savedQuestByID);
    }

    async #hydrateQueuedQuests(quests) {
        const savedQuests = quests.map(normalizeStoredQuest);
        if (!savedQuests.length) {
            return { hydrated: [], removed: [], updated: [] };
        }

        const savedQuestByID = Object.fromEntries(savedQuests.map((quest) => [quest.questID, quest]));
        const docs = await this.#data.getQueuedOwOQuests(savedQuests.map((quest) => quest.questID));
        const docsByID = Object.fromEntries(docs.map((doc) => [String(doc._id), doc]));
        const buildableDocs = [];
        const removed = [];

        for (const savedQuest of savedQuests) {
            const doc = docsByID[savedQuest.questID];
            const removal = getQuestRemoval(savedQuest, doc);

            if (removal) {
                removed.push(removal);
            } else {
                buildableDocs.push(doc);
            }
        }

        const statsByUser = await this.#data.getStatsByUser(buildableDocs);
        const hydrated = [];

        for (const doc of buildableDocs) {
            const savedQuest = savedQuestByID[String(doc._id)];
            const currentValue = getQuestCurrentValue(doc, statsByUser);
            if (currentValue >= Number(doc.targetValue)) {
                removed.push({
                    quest: savedQuest,
                    removalReason: 'completed',
                    details: {
                        currentValue,
                        statKey: doc.statKey,
                        targetValue: Number(doc.targetValue)
                    }
                });
                continue;
            }

            hydrated.push({
                userID: doc.userId,
                questID: String(doc._id),
                questType: doc.questType,
                startValue: Number(doc.startValue),
                targetValue: Number(doc.targetValue),
                addedAt: savedQuest.addedAt,
                count: getQuestProgress(doc, currentValue),
                total: Number(doc.targetCount)
            });
        }

        hydrated.sort((left, right) => left.addedAt - right.addedAt);
        const queueIndexByQuestID = Object.fromEntries(savedQuests.map((quest, index) => [quest.questID, index]));
        removed.sort(
            (left, right) => queueIndexByQuestID[left.quest.questID] - queueIndexByQuestID[right.quest.questID]
        );

        return {
            hydrated,
            removed,
            updated: getUpdatedQuests(savedQuests, hydrated)
        };
    }

    async #addQueuedQuests(quests, data) {
        const addedQuests = await this.#data.insertQueuedQuests(quests.map(toStoredQuest));
        const addedQuestIDs = new Set(addedQuests.map((quest) => quest.questID));
        const displayQuests = quests.filter((quest) => addedQuestIDs.has(quest.questID));
        this.#setQuests([...this.#quests, ...displayQuests]);
        this.log({
            level: this.LogLevels.Info,
            type: this.constructor.LogTypes.QuestsAdded,
            data: {
                ...data,
                addedCount: displayQuests.length,
                questCount: this.#quests.length,
                quests: displayQuests.map(getQuestLogData)
            }
        });

        return displayQuests;
    }

    async #deleteQueuedQuests(quests, data) {
        if (!quests.length) {
            return;
        }

        await this.#data.deleteQueuedQuestsByIDs(quests.map((quest) => quest.questID));
        const removedQuestIDs = new Set(quests.map((quest) => quest.questID));
        this.#setQuests(this.#quests.filter((quest) => !removedQuestIDs.has(quest.questID)));
        this.log({
            level: this.LogLevels.Info,
            type: this.constructor.LogTypes.QuestsRemoved,
            data: {
                ...data,
                removedCount: quests.length,
                questCount: this.#quests.length,
                removed: quests.map(getQuestLogData)
            }
        });
    }

    async #deleteRemovedQuestChanges(removed, data) {
        if (!removed.length) {
            return;
        }

        const quests = removed.map((entry) => entry.quest);
        await this.#data.deleteQueuedQuestsByIDs(quests.map((quest) => quest.questID));
        this.log({
            level: this.LogLevels.Info,
            type: this.constructor.LogTypes.QuestsRemoved,
            data: {
                ...data,
                removedCount: removed.length,
                questCount: this.#quests.length,
                removed: removed.map((entry) => ({
                    ...getQuestLogData(entry.quest),
                    removalReason: entry.removalReason,
                    details: entry.details
                }))
            }
        });
    }

    async #buildDisplayQuests(docs, savedQuestByID) {
        const supportedDocs = docs.filter(
            (doc) => QuestTypes[doc.questType] && Number(doc.locked) !== 1 && doc.locked !== true
        );
        const statsByUser = await this.#data.getStatsByUser(supportedDocs);
        const quests = [];

        for (const doc of supportedDocs) {
            const savedQuest = savedQuestByID[String(doc._id)];
            if (!savedQuest) {
                continue;
            }

            const currentValue = getQuestCurrentValue(doc, statsByUser);
            const total = Number(doc.targetCount);
            const count = getQuestProgress(doc, currentValue);
            if (currentValue >= Number(doc.targetValue)) {
                continue;
            }

            quests.push({
                userID: doc.userId,
                questID: String(doc._id),
                questType: doc.questType,
                startValue: Number(doc.startValue),
                targetValue: Number(doc.targetValue),
                addedAt: savedQuest.addedAt,
                count,
                total
            });
        }

        return quests;
    }

    #setQuests(quests) {
        this.#quests = [...quests].sort((left, right) => left.addedAt - right.addedAt);
        this.#questIDs = new Set();
        this.#questsByUser = {};
        this.#questsByType = Object.fromEntries(Object.keys(QuestTypes).map((type) => [type, []]));

        for (const quest of this.#quests) {
            this.#questIDs.add(quest.questID);
            this.#questsByUser[quest.userID] ??= [];
            this.#questsByUser[quest.userID].push(quest);
            this.#questsByType[quest.questType].push(quest);
        }
    }

    async #refreshQuests(reason) {
        const { hydrated, removed, updated } = await this.#hydrateQueuedQuests(this.#quests);
        const changed = Boolean(removed.length || updated.length);

        this.#setQuests(hydrated);
        await this.#deleteRemovedQuestChanges(removed, { reason });

        this.log({
            level: this.LogLevels.Info,
            type: this.constructor.LogTypes.QuestsRefreshed,
            data: {
                reason,
                questCount: this.#quests.length,
                removedCount: removed.length,
                updatedCount: updated.length
            }
        });

        return { changed };
    }

    async #publishList(context, { repost = false } = {}) {
        if (!this.#channelID) {
            return;
        }

        const message = buildQuestListMessage({
            accentColor: this.#config.colors.yellow,
            quests: this.#quests,
            questsByType: this.#questsByType,
            capacity: this.#capacity,
            emptyMessage: this.#emptyMessage
        });

        if (repost || !this.#messageID) {
            const sent = await context.sendMessage(this.#channelID, message);
            this.#messageID = String(sent.id);
            this.#messagesSinceRepost = 0;
        } else {
            try {
                await context.editMessage(this.#channelID, this.#messageID, message);
            } catch {
                const sent = await context.sendMessage(this.#channelID, message);
                this.#messageID = String(sent.id);
                this.#messagesSinceRepost = 0;
            }
        }

        this.log({
            level: this.LogLevels.Info,
            type: this.constructor.LogTypes.ListPublished,
            data: {
                channelID: this.#channelID,
                messageID: this.#messageID,
                quests: this.#quests.length
            }
        });
    }

    async #refreshAfterMessage(discord) {
        if (this.#refreshTimer) {
            this.#refreshQueued = true;
            return;
        }

        this.#refreshTimer = setTimeout(() => {
            void this.#enqueueMessageEvent(() => this.#runQueuedRefreshAfterCooldown(discord));
        }, 500);

        await this.#refreshAndPublish('message_cooldown', discord);
    }

    async #runQueuedRefreshAfterCooldown(discord) {
        this.#refreshTimer = undefined;

        if (!this.#refreshQueued) {
            return;
        }

        this.#refreshQueued = false;
        this.#refreshTimer = setTimeout(() => {
            void this.#enqueueMessageEvent(() => this.#runQueuedRefreshAfterCooldown(discord));
        }, 500);

        await this.#refreshAndPublish('message_cooldown_queued', discord);
    }

    async #refreshAndPublish(reason, discord, { repost = false } = {}) {
        try {
            await this.#refreshQuests(reason);
            await this.#publishList(discord, { repost });
        } catch (error) {
            this.#logRefreshError(reason, error);
        }
    }

    #logRefreshError(reason, error) {
        this.log({
            level: this.LogLevels.Error,
            type: this.constructor.LogTypes.QuestsRefreshed,
            data: {
                reason,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            }
        });
    }

    #clearQueue(type) {
        return this.#removeQuests((quest) => type === 'all' || quest.questType === type);
    }

    #removeUsersFromQueue(type, userIDs) {
        const userIDSet = new Set(userIDs);

        return this.#removeQuests(
            (quest) => userIDSet.has(quest.userID) && (type === 'all' || quest.questType === type)
        );
    }

    #removeQuests(predicate) {
        const removed = [];
        const kept = [];

        for (const quest of this.#quests) {
            if (predicate(quest)) {
                removed.push(quest);
            } else {
                kept.push(quest);
            }
        }

        this.#setQuests(kept);

        return removed;
    }

    async #notifyRemovedUsers(context, type, quests) {
        if (!this.#channelID || !quests.length) {
            return;
        }

        const users = [...new Set(quests.map((quest) => quest.userID))];
        const typeName = type === 'all' ? 'quest' : QuestTypes[type].name.toLowerCase();

        await context.sendMessage(
            this.#channelID,
            buildRemovedUsersNotice({
                typeName,
                userIDs: users
            })
        );
    }

    async #updateModulePanel(context, fallback) {
        try {
            await context.edit(buildModulePanel(context, this));
        } catch {
            await context.respond(ephemeralText(fallback));
        }
    }

    #logConfigUpdated(key, value) {
        this.log({
            level: this.LogLevels.Info,
            type: this.constructor.LogTypes.ConfigUpdated,
            data: { key, value }
        });
    }

    #messageLink() {
        if (!this.#messageID) {
            return '*not posted yet*';
        }

        return `https://discord.com/channels/${this.#guildID}/${this.#channelID}/${this.#messageID}`;
    }
}

function getModalString(context, id) {
    return typeof context.modalValues[id] === 'string' ? context.modalValues[id] : undefined;
}

function getModalSelectValue(context, id) {
    return Array.isArray(context.modalValues[id]) ? context.modalValues[id][0] : undefined;
}

function getUniqueModalSelectValues(context, id) {
    return [...new Set(Array.isArray(context.modalValues[id]) ? context.modalValues[id] : [])];
}

function getModalPositiveInteger(context, id) {
    const value = Number.parseInt(getModalString(context, id), 10);

    return value > 0 ? value : undefined;
}

function getMessageChannelID(message) {
    return message.channel_id ?? message.channelId;
}

function getMessageID(message) {
    const messageID = message.id ?? message.message_id ?? message.messageId;

    return messageID === undefined || messageID === null ? undefined : String(messageID);
}

function isOwnBotMessage(message, discord) {
    return Boolean(discord.botUserID && message.author?.id === discord.botUserID);
}

function normalizeStoredQuest(quest) {
    return {
        userID: quest.userID,
        questID: String(quest.questID),
        questType: quest.questType,
        startValue: Number(quest.startValue),
        targetValue: Number(quest.targetValue),
        addedAt: Number(quest.addedAt) || Date.now(),
        count: Number(quest.count) || 0,
        total: Number(quest.total) || Number(quest.targetValue) - Number(quest.startValue)
    };
}

function toStoredQuest(quest) {
    return {
        userID: quest.userID,
        questID: quest.questID,
        questType: quest.questType,
        startValue: quest.startValue,
        targetValue: quest.targetValue,
        addedAt: quest.addedAt
    };
}

function getQuestRemoval(savedQuest, doc) {
    if (!doc) {
        return {
            quest: savedQuest,
            removalReason: 'owo_missing',
            details: {}
        };
    }

    if (!QuestTypes[doc.questType]) {
        return {
            quest: savedQuest,
            removalReason: 'unsupported_type',
            details: {
                owoQuestType: doc.questType
            }
        };
    }

    if (Number(doc.locked) === 1 || doc.locked === true) {
        return {
            quest: savedQuest,
            removalReason: 'locked',
            details: {
                locked: doc.locked
            }
        };
    }

    if (
        savedQuest.questType !== doc.questType ||
        savedQuest.startValue !== Number(doc.startValue) ||
        savedQuest.targetValue !== Number(doc.targetValue)
    ) {
        return {
            quest: savedQuest,
            removalReason: 'fingerprint_mismatch',
            details: {
                stored: {
                    questType: savedQuest.questType,
                    startValue: savedQuest.startValue,
                    targetValue: savedQuest.targetValue
                },
                owo: {
                    questType: doc.questType,
                    startValue: Number(doc.startValue),
                    targetValue: Number(doc.targetValue)
                }
            }
        };
    }

    return undefined;
}

function getQuestCurrentValue(doc, statsByUser) {
    return statsByUser[doc.userId]?.[doc.statKey] ?? 0;
}

function getQuestProgress(doc, currentValue) {
    return Math.max(0, Math.min(currentValue - Number(doc.startValue), Number(doc.targetCount)));
}

function getUpdatedQuests(previousQuests, nextQuests) {
    const previousByID = Object.fromEntries(previousQuests.map((quest) => [quest.questID, quest]));

    return nextQuests
        .map((quest) => {
            const previous = previousByID[quest.questID];
            if (!previous || (previous.count === quest.count && previous.total === quest.total)) {
                return undefined;
            }

            return {
                questID: quest.questID,
                userID: quest.userID,
                questType: quest.questType,
                before: {
                    count: previous.count,
                    total: previous.total
                },
                after: {
                    count: quest.count,
                    total: quest.total
                }
            };
        })
        .filter(Boolean);
}

function getQuestLogData(quest) {
    return {
        userID: quest.userID,
        questID: quest.questID,
        questType: quest.questType,
        startValue: quest.startValue,
        targetValue: quest.targetValue,
        addedAt: quest.addedAt
    };
}
