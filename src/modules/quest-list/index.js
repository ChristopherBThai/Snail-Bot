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
import { LogLevels, Module } from '../index.js';
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
        ActiveQuestsLoaded: 'quest_list.active_quests_loaded',
        AddQuestsCandidatesLoaded: 'quest_list.add_quests.candidates_loaded',
        AddQuestsCompleted: 'quest_list.add_quests.completed',
        AddQuestsSkipped: 'quest_list.add_quests.skipped',
        AddQuestsStarted: 'quest_list.add_quests.started',
        ConfigLoaded: 'quest_list.config_loaded',
        ConfigUpdated: 'quest_list.config_updated',
        DisplayQuestsBuilt: 'quest_list.display_quests_built',
        InteractionValidationFailed: 'quest_list.interaction_validation_failed',
        ListPublished: 'quest_list.list_published',
        ListPublishAction: 'quest_list.list_publish_action',
        ListPublishFallback: 'quest_list.list_publish_fallback',
        ListPublishSkipped: 'quest_list.list_publish_skipped',
        ManageQueueCompleted: 'quest_list.manage_queue.completed',
        ManageQueueStarted: 'quest_list.manage_queue.started',
        MessageHandled: 'quest_list.message_handled',
        MessageIgnored: 'quest_list.message_ignored',
        RefreshCooldownQueued: 'quest_list.refresh_cooldown_queued',
        RefreshPublishCompleted: 'quest_list.refresh_publish.completed',
        RefreshPublishStarted: 'quest_list.refresh_publish.started',
        SettingsModalOpened: 'quest_list.settings_modal_opened',
        NoChannelConfigured: 'quest_list.no_channel_configured',
        QuestsAdded: 'quest_list.quests_added',
        QuestsHydrated: 'quest_list.quests_hydrated',
        QuestsLoaded: 'quest_list.quests_loaded',
        QuestsRemoved: 'quest_list.quests_removed',
        QuestsRefreshed: 'quest_list.quests_refreshed',
        QueueIndexed: 'quest_list.queue_indexed',
        UserPositionShown: 'quest_list.user_position_shown',
        VisibleMentionsShown: 'quest_list.visible_mentions_shown'
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

    constructor({ config, databases, logging }) {
        super({
            databases,
            id: 'quest_list',
            name: 'Quest List',
            description: 'Maintains the shared OwO social quest queue.',
            logsLimit: config.modules.defaultLogsLimit,
            logging
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
        const timer = this.logger.time('quest_list.enable');

        await this.#loadConfig();

        if (!this.#channelID) {
            this.logger.info(this.constructor.LogTypes.NoChannelConfigured, {
                message: 'Quest List channel is not configured.'
            });
            timer.end({ configured: false });
            return;
        }

        await this.#loadQuests();
        if (context) {
            await this.#refreshQuests('module_enabled');
            await this.#publishList(context, { repost: true });
        }

        timer.end({
            channelID: this.#channelID,
            configured: true,
            questCount: this.#quests.length
        });
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
        this.logger.debug('quest_list.disabled_runtime_cleared');
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
        const timer = this.logger.time(this.constructor.LogTypes.ConfigLoaded);

        this.#channelID = (await this.getConfig(ConfigKeys.Channel)) ?? this.#channelID;
        this.#emptyMessage = (await this.getConfig(ConfigKeys.EmptyMessage)) ?? this.#emptyMessage;
        this.#repostInterval = (await this.getConfig(ConfigKeys.RepostInterval)) ?? this.#repostInterval;

        for (const [type, key] of Object.entries(ConfigKeys.Capacity)) {
            this.#capacity[type] = (await this.getConfig(key)) ?? this.#capacity[type];
        }

        timer.end({
            channelID: this.#channelID,
            capacity: this.#capacity,
            hasCustomEmptyMessage: this.#emptyMessage !== DefaultEmptyMessage,
            repostInterval: this.#repostInterval
        });
    }

    async #loadQuests() {
        const timer = this.logger.time(this.constructor.LogTypes.QuestsLoaded);
        const quests = await this.#data.loadQueuedQuests();

        this.#setQuests(quests.map(normalizeStoredQuest));
        timer.end(
            {
                quests: this.#quests.length,
                users: Object.keys(this.#questsByUser).length
            },
            { level: LogLevels.Info }
        );
    }

    async #onReady(discord) {
        const log = this.logger.child({ logID: this.createLogID('ready') });

        if (!this.#channelID) {
            log.info(this.constructor.LogTypes.NoChannelConfigured, {
                message: 'Quest List channel is not configured.'
            });
            return;
        }

        log.debug(this.constructor.LogTypes.RefreshPublishStarted, {
            reason: 'ready',
            repost: false
        });
        await this.#refreshQuests('ready');
        await this.#publishList(discord);
        log.debug(this.constructor.LogTypes.RefreshPublishCompleted, {
            reason: 'ready',
            repost: false,
            questCount: this.#quests.length
        });
    }

    async #onMessage(message, discord) {
        return this.#enqueueMessageEvent(() => this.#handleMessage(message, discord));
    }

    async #handleMessage(message, discord) {
        const channelID = getMessageChannelID(message);
        const messageID = getMessageID(message);
        const log = this.logger.child({ logID: this.createLogID('message'), channelID, messageID });

        if (!this.#channelID) {
            log.trace(this.constructor.LogTypes.MessageIgnored, { reason: 'no_channel_configured' });
            return;
        }

        if (channelID !== this.#channelID) {
            log.trace(this.constructor.LogTypes.MessageIgnored, {
                reason: 'different_channel',
                questListChannelID: this.#channelID
            });
            return;
        }

        if (messageID === this.#messageID) {
            log.trace(this.constructor.LogTypes.MessageIgnored, { reason: 'current_list_message' });
            return;
        }

        if (isOwnBotMessage(message, discord)) {
            log.trace(this.constructor.LogTypes.MessageIgnored, { reason: 'snail_authored' });
            return;
        }

        log.debug(this.constructor.LogTypes.MessageHandled, {
            messagesSinceRepost: this.#messagesSinceRepost,
            repostInterval: this.#repostInterval
        });
        await this.#refreshAfterMessage(discord);

        this.#messagesSinceRepost++;
        if (this.#messagesSinceRepost < this.#repostInterval) {
            log.trace(this.constructor.LogTypes.MessageHandled, {
                action: 'counted',
                messagesSinceRepost: this.#messagesSinceRepost,
                repostInterval: this.#repostInterval
            });
            return;
        }

        log.info(this.constructor.LogTypes.MessageHandled, {
            action: 'repost_interval_reached',
            messagesSinceRepost: this.#messagesSinceRepost,
            repostInterval: this.#repostInterval
        });
        clearTimeout(this.#refreshTimer);
        this.#refreshQueued = false;
        this.#refreshTimer = undefined;
        await this.#refreshAndPublish('repost_interval', discord, { repost: true });
    }

    #enqueueMessageEvent(work) {
        this.logger.trace('quest_list.message_event_queued');
        const next = this.#messageEventQueue.catch(() => {}).then(work);

        this.#messageEventQueue = next.catch((error) => this.#logRefreshError('message_event_queue', error));

        return next;
    }

    async #addUserQuests(context) {
        const log = this.logger.child({
            logID: this.createLogID('add_quests'),
            userID: context.userID
        });
        const timer = log.time(this.constructor.LogTypes.AddQuestsCompleted);

        log.debug(this.constructor.LogTypes.AddQuestsStarted, {
            channelID: this.#channelID,
            questCount: this.#quests.length
        });

        if (!this.#channelID) {
            log.warn(this.constructor.LogTypes.InteractionValidationFailed, { reason: 'no_channel_configured' });
            await context.respond(ephemeralText('The Quest List channel has not been set yet.'));
            timer.end({ skipped: true });
            return;
        }

        if (!context.userID) {
            log.warn(this.constructor.LogTypes.InteractionValidationFailed, { reason: 'missing_user_id' });
            await context.respond(ephemeralText('I could not identify your user.'));
            timer.end({ skipped: true });
            return;
        }

        await context.defer({ ephemeral: true });
        const activeQuests = await this.#getActiveUserQuests(context.userID, Date.now());
        const newQuests = activeQuests.filter((quest) => !this.#questIDs.has(quest.questID));

        log.debug(this.constructor.LogTypes.AddQuestsCandidatesLoaded, {
            activeCount: activeQuests.length,
            newCount: newQuests.length,
            queuedCount: this.#questsByUser[context.userID]?.length ?? 0
        });
        log.trace(this.constructor.LogTypes.AddQuestsCandidatesLoaded, {
            activeQuests: activeQuests.map(getQuestLogData),
            newQuests: newQuests.map(getQuestLogData),
            queuedQuests: (this.#questsByUser[context.userID] ?? []).map(getQuestLogData)
        });

        if (!newQuests.length) {
            log.debug(this.constructor.LogTypes.AddQuestsSkipped, {
                reason: 'no_new_quests',
                activeCount: activeQuests.length
            });
            await context.editReply(
                buildAddQuestsResponse({
                    capacity: this.#capacity,
                    newQuests,
                    questsByType: this.#questsByType,
                    queuedQuests: this.#questsByUser[context.userID] ?? [],
                    userID: context.userID
                })
            );
            timer.end({ addedCount: 0, skipped: true });
            return;
        }

        const addedQuests = await this.#addQueuedQuests(newQuests, { reason: 'user_add', userID: context.userID });
        if (!addedQuests.length) {
            log.warn(this.constructor.LogTypes.AddQuestsSkipped, {
                reason: 'inserted_no_quests',
                newCount: newQuests.length
            });
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
            timer.end({ addedCount: 0, newCount: newQuests.length, skipped: true });
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
        timer.end({
            addedCount: addedQuests.length,
            newCount: newQuests.length,
            questCount: this.#quests.length
        });
    }

    async #showUserPosition(context) {
        const log = this.logger.child({
            logID: this.createLogID('user_position'),
            userID: context.userID
        });

        if (!context.userID) {
            log.warn(this.constructor.LogTypes.InteractionValidationFailed, { reason: 'missing_user_id' });
            await context.respond(ephemeralText('I could not identify your user.'));
            return;
        }

        const userQuests = this.#questsByUser[context.userID] ?? [];
        if (!userQuests.length) {
            log.debug(this.constructor.LogTypes.UserPositionShown, { questCount: 0 });
            await context.respond(ephemeralText('You do not have any quests on the Quest List.'));
            return;
        }

        log.debug(this.constructor.LogTypes.UserPositionShown, { questCount: userQuests.length });
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
        this.logger.debug(this.constructor.LogTypes.VisibleMentionsShown, {
            visibleUsers: getVisibleUserCount(this.#questsByType, this.#capacity)
        });
        await context.respond(
            buildVisibleMentionsResponse({
                capacity: this.#capacity,
                questsByType: this.#questsByType
            })
        );
    }

    async #toggleReminders(context) {
        this.logger.debug('quest_list.reminders_requested', { userID: context.userID });
        await context.respond(ephemeralText('Quest List reminders are a work in progress and coming soon.'));
    }

    async #openSettingsModal(context, setting) {
        this.logger.trace(this.constructor.LogTypes.SettingsModalOpened, {
            setting,
            userID: context.userID
        });

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
                this.logger.warn(this.constructor.LogTypes.InteractionValidationFailed, {
                    reason: 'invalid_setting',
                    setting,
                    userID: context.userID
                });
                await context.respond(ephemeralText('Choose a valid Quest List setting.'));
        }
    }

    async #openManageQueueModal(context) {
        this.logger.trace(this.constructor.LogTypes.SettingsModalOpened, {
            setting: 'manage_queue',
            userID: context.userID
        });
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
            this.logger.warn(this.constructor.LogTypes.InteractionValidationFailed, {
                reason: 'invalid_channel',
                userID: context.userID
            });
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
        this.#logConfigUpdated('channel', { channelID });
    }

    async #setCapacityFromModal(context) {
        const capacity = {
            cookieBy: getModalPositiveInteger(context, QuestListIDs.CookieCapacityInput),
            prayBy: getModalPositiveInteger(context, QuestListIDs.PrayCapacityInput),
            curseBy: getModalPositiveInteger(context, QuestListIDs.CurseCapacityInput),
            emoteBy: getModalPositiveInteger(context, QuestListIDs.ActionCapacityInput)
        };

        if (Object.values(capacity).some((value) => !value)) {
            this.logger.warn(this.constructor.LogTypes.InteractionValidationFailed, {
                capacity,
                reason: 'invalid_capacity',
                userID: context.userID
            });
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
        this.#logConfigUpdated('capacity', { capacity });
    }

    async #setRepostIntervalFromModal(context) {
        const repostInterval = getModalPositiveInteger(context, QuestListIDs.RepostIntervalInput);
        if (!repostInterval) {
            this.logger.warn(this.constructor.LogTypes.InteractionValidationFailed, {
                reason: 'invalid_repost_interval',
                userID: context.userID
            });
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
        this.#logConfigUpdated('repost_interval', { repostInterval });
    }

    async #setEmptyMessageFromModal(context) {
        const emptyMessage = getModalString(context, QuestListIDs.EmptyMessageInput)?.trim();
        if (!emptyMessage) {
            this.logger.warn(this.constructor.LogTypes.InteractionValidationFailed, {
                reason: 'invalid_empty_message',
                userID: context.userID
            });
            await context.respond(ephemeralText('Provide an empty message.'));
            return;
        }

        this.#emptyMessage = emptyMessage;
        await this.setConfig(ConfigKeys.EmptyMessage, emptyMessage);

        if (this.active && this.#channelID) {
            await this.#publishList(context);
        }

        await this.#updateModulePanel(context, 'Updated the Quest List empty message.');
        this.#logConfigUpdated('empty_message', { contentLength: emptyMessage.length });
    }

    async #manageQueue(context) {
        const type = getModalSelectValue(context, QuestListIDs.QueueTypeInput);
        const notify = context.modalValues[QuestListIDs.QueueNotifyInput] === true;
        const userIDs = getUniqueModalSelectValues(context, QuestListIDs.QueueUsersInput);
        const clearing = !userIDs.length;
        const log = this.logger.child({
            logID: this.createLogID('manage_queue'),
            userID: context.userID
        });
        const timer = log.time(this.constructor.LogTypes.ManageQueueCompleted);

        log.debug(this.constructor.LogTypes.ManageQueueStarted, {
            action: clearing ? 'clear' : 'remove',
            notify,
            type,
            userCount: userIDs.length
        });

        if (type !== 'all' && !QuestTypes[type]) {
            log.warn(this.constructor.LogTypes.InteractionValidationFailed, { reason: 'invalid_queue_type', type });
            await context.respond(ephemeralText('Choose a valid quest type.'));
            timer.end({ skipped: true });
            return;
        }

        if (notify && !this.#channelID) {
            log.warn(this.constructor.LogTypes.InteractionValidationFailed, { reason: 'notify_without_channel', type });
            await context.respond(ephemeralText('Set a Quest List channel before notifying removed users.'));
            timer.end({ skipped: true });
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
        timer.end({
            action: clearing ? 'clear' : 'remove',
            notify,
            removedCount: removed.length,
            type
        });
    }

    async #forceRepost(context) {
        if (!this.#channelID) {
            this.logger.warn(this.constructor.LogTypes.InteractionValidationFailed, {
                reason: 'force_repost_without_channel',
                userID: context.userID
            });
            await context.respond(ephemeralText('Set a Quest List channel before reposting.'));
            return;
        }

        await this.#refreshQuests('force_repost');
        await this.#publishList(context, { repost: true });
        await this.#updateModulePanel(context, 'Reposted the Quest List.');
    }

    async #getActiveUserQuests(userID, addedAt) {
        const timer = this.logger.time(this.constructor.LogTypes.ActiveQuestsLoaded, { userID });
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

        const quests = await this.#buildDisplayQuests(docs, savedQuestByID);

        timer.end({
            activeDocs: docs.length,
            displayQuests: quests.length
        });

        return quests;
    }

    async #hydrateQueuedQuests(quests) {
        const timer = this.logger.time(this.constructor.LogTypes.QuestsHydrated, { queuedCount: quests.length });
        const savedQuests = quests.map(normalizeStoredQuest);
        if (!savedQuests.length) {
            this.logger.trace(this.constructor.LogTypes.QuestsHydrated, { queuedCount: 0 });
            timer.end({ hydratedCount: 0, removedCount: 0, updatedCount: 0 });
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
                this.logger.trace(this.constructor.LogTypes.QuestsHydrated, {
                    quest: getQuestLogData(savedQuest),
                    removalReason: removal.removalReason
                });
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
                this.logger.trace(this.constructor.LogTypes.QuestsHydrated, {
                    details: {
                        currentValue,
                        statKey: doc.statKey,
                        targetValue: Number(doc.targetValue)
                    },
                    quest: getQuestLogData(savedQuest),
                    removalReason: 'completed'
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

        const result = {
            hydrated,
            removed,
            updated: getUpdatedQuests(savedQuests, hydrated)
        };

        if (result.updated.length) {
            this.logger.trace(this.constructor.LogTypes.QuestsHydrated, {
                updated: result.updated
            });
        }

        timer.end({
            buildableDocs: buildableDocs.length,
            hydratedCount: result.hydrated.length,
            removedCount: result.removed.length,
            updatedCount: result.updated.length
        });

        return result;
    }

    async #addQueuedQuests(quests, data) {
        const addedQuests = await this.#data.insertQueuedQuests(quests.map(toStoredQuest));
        const addedQuestIDs = new Set(addedQuests.map((quest) => quest.questID));
        const displayQuests = quests.filter((quest) => addedQuestIDs.has(quest.questID));
        this.#setQuests([...this.#quests, ...displayQuests]);
        this.logger.info(this.constructor.LogTypes.QuestsAdded, {
            ...data,
            addedCount: displayQuests.length,
            questCount: this.#quests.length,
            quests: displayQuests.map(getQuestLogData)
        });

        return displayQuests;
    }

    async #deleteQueuedQuests(quests, data) {
        if (!quests.length) {
            this.logger.trace(this.constructor.LogTypes.QuestsRemoved, {
                ...data,
                removedCount: 0
            });
            return;
        }

        await this.#data.deleteQueuedQuestsByIDs(quests.map((quest) => quest.questID));
        const removedQuestIDs = new Set(quests.map((quest) => quest.questID));
        this.#setQuests(this.#quests.filter((quest) => !removedQuestIDs.has(quest.questID)));
        this.logger.info(this.constructor.LogTypes.QuestsRemoved, {
            ...data,
            removedCount: quests.length,
            questCount: this.#quests.length,
            removed: quests.map(getQuestLogData)
        });
    }

    async #deleteRemovedQuestChanges(removed, data) {
        if (!removed.length) {
            this.logger.trace(this.constructor.LogTypes.QuestsRemoved, {
                ...data,
                removedCount: 0
            });
            return;
        }

        const quests = removed.map((entry) => entry.quest);
        await this.#data.deleteQueuedQuestsByIDs(quests.map((quest) => quest.questID));
        this.logger.info(this.constructor.LogTypes.QuestsRemoved, {
            ...data,
            removedCount: removed.length,
            questCount: this.#quests.length,
            removed: removed.map((entry) => ({
                ...getQuestLogData(entry.quest),
                removalReason: entry.removalReason,
                details: entry.details
            }))
        });
    }

    async #buildDisplayQuests(docs, savedQuestByID) {
        const timer = this.logger.time(this.constructor.LogTypes.DisplayQuestsBuilt, { docCount: docs.length });
        const supportedDocs = docs.filter(
            (doc) => QuestTypes[doc.questType] && Number(doc.locked) !== 1 && doc.locked !== true
        );
        const statsByUser = await this.#data.getStatsByUser(supportedDocs);
        const quests = [];

        for (const doc of supportedDocs) {
            const savedQuest = savedQuestByID[String(doc._id)];
            if (!savedQuest) {
                this.logger.trace(this.constructor.LogTypes.DisplayQuestsBuilt, {
                    questID: String(doc._id),
                    reason: 'not_saved'
                });
                continue;
            }

            const currentValue = getQuestCurrentValue(doc, statsByUser);
            const total = Number(doc.targetCount);
            const count = getQuestProgress(doc, currentValue);
            if (currentValue >= Number(doc.targetValue)) {
                this.logger.trace(this.constructor.LogTypes.DisplayQuestsBuilt, {
                    questID: String(doc._id),
                    reason: 'completed',
                    currentValue,
                    targetValue: Number(doc.targetValue)
                });
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

        timer.end({
            displayCount: quests.length,
            supportedCount: supportedDocs.length
        });

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

        this.logger.trace(this.constructor.LogTypes.QueueIndexed, {
            questCount: this.#quests.length,
            typeCounts: Object.fromEntries(
                Object.entries(this.#questsByType).map(([type, typeQuests]) => [type, typeQuests.length])
            ),
            userCount: Object.keys(this.#questsByUser).length
        });
    }

    async #refreshQuests(reason) {
        const timer = this.logger.time(this.constructor.LogTypes.QuestsRefreshed, { reason });
        const { hydrated, removed, updated } = await this.#hydrateQueuedQuests(this.#quests);
        const changed = Boolean(removed.length || updated.length);

        this.#setQuests(hydrated);
        await this.#deleteRemovedQuestChanges(removed, { reason });

        timer.end(
            {
                changed,
                questCount: this.#quests.length,
                removedCount: removed.length,
                updatedCount: updated.length
            },
            { level: LogLevels.Info }
        );

        return { changed };
    }

    async #publishList(context, { repost = false } = {}) {
        if (!this.#channelID) {
            this.logger.warn(this.constructor.LogTypes.ListPublishSkipped, { reason: 'no_channel_configured' });
            return;
        }

        const timer = this.logger.time(this.constructor.LogTypes.ListPublished, {
            channelID: this.#channelID,
            repost
        });
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
            this.logger.debug(this.constructor.LogTypes.ListPublishAction, {
                action: 'send',
                channelID: this.#channelID,
                messageID: this.#messageID,
                repost
            });
        } else {
            try {
                await context.editMessage(this.#channelID, this.#messageID, message);
                this.logger.debug(this.constructor.LogTypes.ListPublishAction, {
                    action: 'edit',
                    channelID: this.#channelID,
                    messageID: this.#messageID
                });
            } catch (error) {
                this.logger.warn(this.constructor.LogTypes.ListPublishFallback, {
                    channelID: this.#channelID,
                    error,
                    messageID: this.#messageID,
                    reason: 'edit_failed'
                });
                const sent = await context.sendMessage(this.#channelID, message);
                this.#messageID = String(sent.id);
                this.#messagesSinceRepost = 0;
            }
        }

        timer.end(
            {
                messageID: this.#messageID,
                quests: this.#quests.length
            },
            { level: LogLevels.Info }
        );
    }

    async #refreshAfterMessage(discord) {
        if (this.#refreshTimer) {
            this.#refreshQueued = true;
            this.logger.debug(this.constructor.LogTypes.RefreshCooldownQueued, {
                reason: 'cooldown_active'
            });
            return;
        }

        this.logger.trace(this.constructor.LogTypes.RefreshCooldownQueued, {
            action: 'start_cooldown'
        });
        this.#refreshTimer = setTimeout(() => {
            void this.#enqueueMessageEvent(() => this.#runQueuedRefreshAfterCooldown(discord));
        }, 500);

        await this.#refreshAndPublish('message_cooldown', discord);
    }

    async #runQueuedRefreshAfterCooldown(discord) {
        this.#refreshTimer = undefined;

        if (!this.#refreshQueued) {
            this.logger.trace(this.constructor.LogTypes.RefreshCooldownQueued, {
                action: 'cooldown_finished_without_queue'
            });
            return;
        }

        this.#refreshQueued = false;
        this.logger.debug(this.constructor.LogTypes.RefreshCooldownQueued, {
            action: 'run_queued_refresh'
        });
        this.#refreshTimer = setTimeout(() => {
            void this.#enqueueMessageEvent(() => this.#runQueuedRefreshAfterCooldown(discord));
        }, 500);

        await this.#refreshAndPublish('message_cooldown_queued', discord);
    }

    async #refreshAndPublish(reason, discord, { repost = false } = {}) {
        const log = this.logger.child({ logID: this.createLogID('refresh_publish') });
        const timer = log.time(this.constructor.LogTypes.RefreshPublishCompleted, { reason, repost });

        try {
            log.debug(this.constructor.LogTypes.RefreshPublishStarted, { reason, repost });
            await this.#refreshQuests(reason);
            await this.#publishList(discord, { repost });
            timer.end({
                messageID: this.#messageID,
                questCount: this.#quests.length
            });
        } catch (error) {
            timer.fail(error, { reason, repost });
            this.#logRefreshError(reason, error);
        }
    }

    #logRefreshError(reason, error) {
        this.logger.error(this.constructor.LogTypes.QuestsRefreshed, {
            reason,
            error
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

    #logConfigUpdated(setting, data = {}) {
        this.logger.info(this.constructor.LogTypes.ConfigUpdated, { setting, ...data });
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

function getVisibleUserCount(questsByType, capacity) {
    const userIDs = new Set();

    for (const [type, quests] of Object.entries(questsByType)) {
        for (const quest of quests.slice(0, capacity[type])) {
            userIDs.add(quest.userID);
        }
    }

    return userIDs.size;
}

function getQuestLogData(quest) {
    return {
        userID: quest.userID,
        questID: quest.questID,
        questType: quest.questType,
        startValue: quest.startValue,
        targetValue: quest.targetValue,
        addedAt: quest.addedAt,
        ...(quest.count !== undefined ? { count: quest.count } : {}),
        ...(quest.total !== undefined ? { total: quest.total } : {})
    };
}
