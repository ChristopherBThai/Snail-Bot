export const QuestTypes = Object.freeze({
    cookieBy: {
        name: 'Cookie',
        emoji: ':cookie:'
    },
    prayBy: {
        name: 'Pray',
        emoji: ':pray:'
    },
    curseBy: {
        name: 'Curse',
        emoji: ':skull:'
    },
    emoteBy: {
        name: 'Action',
        emoji: ':joy:'
    }
});

export const QuestListIDs = Object.freeze({
    AddQuests: 'quest_list:add_quests',
    MyPosition: 'quest_list:my_position',
    VisibleMentions: 'quest_list:visible_mentions',
    ToggleReminders: 'quest_list:toggle_reminders',
    ChannelSelect: 'quest_list:channel_select',
    EditCapacity: 'quest_list:edit_capacity',
    EditRepostInterval: 'quest_list:edit_repost_interval',
    EditEmptyMessage: 'quest_list:edit_empty_message',
    ManageQueue: 'quest_list:manage_queue',
    ForceRepost: 'quest_list:force_repost',
    CapacityModal: 'quest_list:capacity_modal',
    RepostIntervalModal: 'quest_list:repost_interval_modal',
    EmptyMessageModal: 'quest_list:empty_message_modal',
    ManageQueueModal: 'quest_list:manage_queue_modal',
    CookieCapacityInput: 'quest_list:cookie_capacity_input',
    PrayCapacityInput: 'quest_list:pray_capacity_input',
    CurseCapacityInput: 'quest_list:curse_capacity_input',
    ActionCapacityInput: 'quest_list:action_capacity_input',
    RepostIntervalInput: 'quest_list:repost_interval_input',
    EmptyMessageInput: 'quest_list:empty_message_input',
    QueueTypeInput: 'quest_list:queue_type_input',
    QueueNotifyInput: 'quest_list:queue_notify_input',
    QueueUsersInput: 'quest_list:queue_users_input'
});

export const QuestListSettings = Object.freeze({
    Capacity: 'capacity',
    RepostInterval: 'repost_interval',
    EmptyMessage: 'empty_message'
});

export const DefaultCapacity = Object.freeze({
    cookieBy: 5,
    prayBy: 10,
    curseBy: 10,
    emoteBy: 5
});

export const DefaultEmptyMessage = 'There are no quests!';
