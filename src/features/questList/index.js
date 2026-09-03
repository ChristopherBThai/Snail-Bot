import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { hasManagerAccess } from '../../discord/auth.js';
import { getInteractionUser, getSelectValue } from '../../discord/interactions.js';
import { createQuestSource, QUEST_TYPES } from './quests.js';
import { createPrayCurseReminders } from './reminders.js';
import {
    ADD_QUESTS_ID,
    buildAddQuestsResponse,
    buildPositionResponse,
    buildVisibleMentionsResponse,
    MAX_EMPTY_MESSAGE_LENGTH,
    MAX_VISIBLE_QUESTS,
    MY_POSITION_ID,
    TOGGLE_REMINDERS_ID,
    VISIBLE_MENTIONS_ID,
} from './render.js';
import {
    buildCapacityModal,
    buildConfiguration,
    buildEmptyMessageModal,
    buildFindUsersModal,
    buildInvalidUserIdResponses,
    buildManageQueueModal,
    buildOverview,
    buildQueueRemovalResponses,
    buildRepostIntervalModal,
    buildUserPositionResponses,
    readCapacity,
    readEmptyMessage,
    readFindUsers,
    readManageQueue,
    readRepostInterval,
    SETTINGS_IDS,
} from './settings.js';
import { createQuestListUpdates } from './updates.js';

/** @type {import('../../packages.js').PackageSetup} */
export default async function setup({ features, logging, rest, services }) {
    const log = logging.createLogger('questList');
    const mongo = services.snail.mongo;
    const owoMongo = services.owo.mongo;
    const redis = services.owo.redis;
    const liveMissing = [!owoMongo && 'OwO Mongo', !redis && 'OwO Redis'].filter(Boolean);
    const questSource =
        mongo && owoMongo && redis ? createQuestSource({ UserQuest: owoMongo.UserQuest, redis }) : undefined;
    const updates = mongo
        ? createQuestListUpdates({
              Quest: mongo.Quest,
              Setting: mongo.Setting,
              questSource,
              rest,
              log,
              isEnabled,
          })
        : undefined;
    await updates?.initialize();
    const reminders =
        mongo && redis
            ? createPrayCurseReminders({
                  User: mongo.User,
                  redis,
                  rest,
                  log,
                  getChannelId: () => updates.state.channelId,
              })
            : undefined;

    return {
        name: 'Quest List',
        missing: mongo ? [] : ['Snail Mongo'],
        components: [
            { id: ADD_QUESTS_ID, missing: liveMissing, handle: addQuests },
            { id: MY_POSITION_ID, missing: liveMissing, handle: showPosition },
            { id: VISIBLE_MENTIONS_ID, missing: liveMissing, handle: showVisibleMentions },
            { id: TOGGLE_REMINDERS_ID, missing: redis ? [] : ['OwO Redis'], handle: toggleReminders },
            interaction(SETTINGS_IDS.channel, setChannel),
            interaction(SETTINGS_IDS.editCapacity, openCapacityModal),
            interaction(SETTINGS_IDS.editRepostInterval, openRepostIntervalModal),
            interaction(SETTINGS_IDS.editEmptyMessage, openEmptyMessageModal),
            { ...interaction(SETTINGS_IDS.findUsers, openFindUsersModal), missing: liveMissing },
            { ...interaction(SETTINGS_IDS.manageQueue, openManageQueueModal), missing: liveMissing },
            { ...interaction(SETTINGS_IDS.forceRepost, forceRepost, false), missing: liveMissing },
        ],
        modals: [
            interaction(SETTINGS_IDS.capacityModal, setCapacity),
            interaction(SETTINGS_IDS.repostIntervalModal, setRepostInterval),
            interaction(SETTINGS_IDS.emptyMessageModal, setEmptyMessage),
            { ...interaction(SETTINGS_IDS.findUsersModal, findUsers), missing: liveMissing },
            { ...interaction(SETTINGS_IDS.manageQueueModal, manageQueue), missing: liveMissing },
        ],
        feature: {
            id: 'questList',
            description: 'Maintains the shared OwO social quest queue.',
            toggleable: true,
            activate,
            deactivate: () => reminders?.deactivate(),
            events: questSource ? [{ event: GatewayDispatchEvents.MessageCreate, handle: updates.messageCreated }] : [],
            settings: {
                pages: [
                    { id: 'overview', label: 'Overview', render: renderOverview },
                    { id: 'configuration', label: 'Configuration', render: renderConfiguration },
                ],
            },
        },
    };

    function interaction(id, handle, availableWhenDisabled = true) {
        return { id, availableWhenDisabled, authorize: hasManagerAccess, handle };
    }

    function isEnabled() {
        const feature = features.get('questList');
        return Boolean(feature?.enabled && !feature.missing.length);
    }

    async function activate() {
        await updates.activate();
        if (isEnabled()) await reminders?.activate();
    }

    async function addQuests(context) {
        if (!updates.state.channelId) {
            await context.respond('The Quest List channel has not been configured.', { ephemeral: true });
            return;
        }

        const userId = getInteractionUser(context.interaction)?.id;
        if (!userId) {
            await context.respond('I could not identify your user.', { ephemeral: true });
            return;
        }

        const timer = log.time();
        await context.defer({ ephemeral: true });
        const added = await updates.addQuests(userId);
        await context.editResponse(buildAddQuestsResponse(updates.state, userId, added));
        timer.debug('Completed Add My Quests interaction', {
            userId,
            added: added.length,
        });
    }

    async function showPosition(context) {
        const userId = getInteractionUser(context.interaction)?.id;
        await context.respond(
            userId ? buildPositionResponse(updates.state, userId) : 'I could not identify your user.',
            { ephemeral: true },
        );
    }

    async function showVisibleMentions(context) {
        await context.respond(buildVisibleMentionsResponse(updates.state), { ephemeral: true });
    }

    async function toggleReminders(context) {
        const userId = getInteractionUser(context.interaction)?.id;
        if (!userId) {
            await context.respond('I could not identify your user.', { ephemeral: true });
            return;
        }

        const enabled = await reminders.toggle(userId);
        await context.respond(
            enabled
                ? 'Pray/curse reminders are now enabled in the Quest List channel.'
                : 'Pray/curse reminders are now disabled.',
            { ephemeral: true },
        );
    }

    function renderOverview() {
        return buildOverview(updates.state, {
            running: updates.isRunning(),
            questUpdatesAvailable: Boolean(questSource),
        });
    }

    function renderConfiguration() {
        return buildConfiguration(updates.state);
    }

    async function setChannel(context) {
        const channelId = getSelectValue(context.interaction);
        if (!channelId) {
            await context.respond('Choose a channel.', { ephemeral: true });
            return;
        }

        await context.deferUpdate();
        await updates.setChannel(channelId);
        await context.editResponse(await renderQuestListSettings('configuration'));
    }

    async function openCapacityModal(context) {
        await context.openModal(buildCapacityModal(updates.state));
    }

    async function setCapacity(context) {
        const capacity = readCapacity(context.interaction);
        if (!capacity) {
            await context.respond(
                `Every visible limit must be a positive integer, with no more than ${MAX_VISIBLE_QUESTS} quests combined.`,
                { ephemeral: true },
            );
            return;
        }

        await context.deferUpdate();
        await updates.setCapacity(capacity);
        await context.editResponse(await renderQuestListSettings('configuration'));
    }

    async function openRepostIntervalModal(context) {
        await context.openModal(buildRepostIntervalModal(updates.state));
    }

    async function setRepostInterval(context) {
        const repostInterval = readRepostInterval(context.interaction);
        if (!repostInterval) {
            await context.respond('The repost interval must be a positive integer.', { ephemeral: true });
            return;
        }

        await context.deferUpdate();
        await updates.setRepostInterval(repostInterval);
        await context.editResponse(await renderQuestListSettings('configuration'));
    }

    async function openEmptyMessageModal(context) {
        await context.openModal(buildEmptyMessageModal(updates.state));
    }

    async function setEmptyMessage(context) {
        const emptyMessage = readEmptyMessage(context.interaction);
        if (!emptyMessage || emptyMessage.length > MAX_EMPTY_MESSAGE_LENGTH) {
            await context.respond(
                `The empty message must contain 1–${MAX_EMPTY_MESSAGE_LENGTH.toLocaleString()} characters.`,
                { ephemeral: true },
            );
            return;
        }

        await context.deferUpdate();
        await updates.setEmptyMessage(emptyMessage);
        await context.editResponse(await renderQuestListSettings('configuration'));
    }

    async function openFindUsersModal(context) {
        await context.openModal(buildFindUsersModal());
    }

    async function findUsers(context) {
        const { userIds, invalidValues } = readFindUsers(context.interaction);
        if (!userIds.size && !invalidValues.length) {
            await context.respond('Enter one or more valid Discord user IDs separated by whitespace.', {
                ephemeral: true,
            });
            return;
        }

        await context.defer({ ephemeral: true });
        await updates.refreshPositions();
        await respondAll(context, [
            ...buildUserPositionResponses(updates.state, userIds),
            ...buildInvalidUserIdResponses(invalidValues),
        ]);
    }

    async function openManageQueueModal(context) {
        await context.openModal(buildManageQueueModal());
    }

    async function manageQueue(context) {
        const { questType, userIds, invalidValues } = readManageQueue(context.interaction);
        if (questType !== 'all' && !QUEST_TYPES[questType]) {
            await context.respond('Choose a valid quest type.', { ephemeral: true });
            return;
        }
        if (!userIds.size && invalidValues.length) {
            await respondAll(context, buildInvalidUserIdResponses(invalidValues));
            return;
        }

        await context.deferUpdate();
        const result = await updates.removeQuests(questType, userIds);
        const responses = [
            ...buildQueueRemovalResponses(questType, userIds, result.quests),
            ...buildInvalidUserIdResponses(invalidValues),
        ];

        try {
            await context.editResponse(await renderQuestListSettings('overview'));
        } catch (error) {
            log.error('Could not refresh settings after removing Quest List quests', {
                error,
                quests: result.quests.length,
            });
            responses.push('The settings panel could not be refreshed.');
        }

        await respondAll(context, responses);
    }

    async function forceRepost(context) {
        if (!updates.state.channelId) {
            await context.respond('Select a Quest List channel first.', { ephemeral: true });
            return;
        }

        await context.deferUpdate();
        await updates.forceRepost();
        await context.editResponse(await renderQuestListSettings('overview'));
    }

    function renderQuestListSettings(pageId) {
        return features.get('questList').renderSettings(pageId);
    }
}

async function respondAll(context, responses) {
    for (const response of responses) await context.respond(response, { ephemeral: true });
}
