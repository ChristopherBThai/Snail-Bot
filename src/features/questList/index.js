import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { hasManagerAccess } from '../../discord/auth.js';
import { getInteractionUser, getSelectValue } from '../../discord/interactions.js';
import { QUEST_TYPES } from './quests.js';
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
import { createQuestListRepository } from './repository.js';
import {
    buildCapacityModal,
    buildConfiguration,
    buildEmptyMessageModal,
    buildManageQueueModal,
    buildOverview,
    buildQueueRemovalResponse,
    buildRepostIntervalModal,
    readCapacity,
    readEmptyMessage,
    readManageQueue,
    readRepostInterval,
    SETTINGS_IDS,
} from './settings.js';
import { createQuestListUpdates } from './updates.js';

/** @type {import('../../packages.js').PackageSetup} */
export default function setup({ features, logging, rest, services, unavailable }) {
    const log = logging.createLogger('questList');
    const repository =
        services.snail.mongo && services.owo.mongo && services.owo.redis
            ? createQuestListRepository({
                  Quest: services.snail.mongo.Quest,
                  UserQuest: services.owo.mongo.UserQuest,
                  User: services.snail.mongo.User,
                  Setting: services.snail.mongo.Setting,
                  redis: services.owo.redis,
              })
            : undefined;
    const updates = createQuestListUpdates({ repository, rest, log, isEnabled });
    const reminders = createPrayCurseReminders({
        repository,
        rest,
        log,
        getChannelId: () => updates.state.channelId,
    });

    return {
        name: 'Quest List',
        missing: [
            ...(unavailable.snail.mongo ?? []),
            ...(unavailable.owo.mongo ?? []),
            ...(unavailable.owo.redis ?? []),
        ],
        components: [
            { id: ADD_QUESTS_ID, handle: addQuests },
            { id: MY_POSITION_ID, handle: showPosition },
            { id: VISIBLE_MENTIONS_ID, handle: showVisibleMentions },
            { id: TOGGLE_REMINDERS_ID, handle: toggleReminders },
            interaction(SETTINGS_IDS.channel, setChannel),
            interaction(SETTINGS_IDS.editCapacity, openCapacityModal),
            interaction(SETTINGS_IDS.editRepostInterval, openRepostIntervalModal),
            interaction(SETTINGS_IDS.editEmptyMessage, openEmptyMessageModal),
            interaction(SETTINGS_IDS.manageQueue, openManageQueueModal),
            interaction(SETTINGS_IDS.forceRepost, forceRepost, false),
        ],
        modals: [
            interaction(SETTINGS_IDS.capacityModal, setCapacity),
            interaction(SETTINGS_IDS.repostIntervalModal, setRepostInterval),
            interaction(SETTINGS_IDS.emptyMessageModal, setEmptyMessage),
            interaction(SETTINGS_IDS.manageQueueModal, manageQueue),
        ],
        feature: {
            id: 'questList',
            description: 'Maintains the shared OwO social quest queue.',
            toggleable: true,
            activate,
            deactivate: reminders.deactivate,
            events: [{ event: GatewayDispatchEvents.MessageCreate, handle: updates.messageCreated }],
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
        return Boolean(feature?.available && feature.enabled);
    }

    function isRunning() {
        return Boolean(isEnabled() && updates.state.channelId);
    }

    async function activate() {
        await updates.activate();
        if (isEnabled()) await reminders.activate();
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

    async function renderOverview() {
        await updates.loadSettings();
        return buildOverview(updates.state, isRunning());
    }

    async function renderConfiguration() {
        await updates.loadSettings();
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

    async function openManageQueueModal(context) {
        await context.openModal(buildManageQueueModal());
    }

    async function manageQueue(context) {
        const { questType, userIds } = readManageQueue(context.interaction);
        if (questType !== 'all' && !QUEST_TYPES[questType]) {
            await context.respond('Choose a valid quest type.', { ephemeral: true });
            return;
        }

        await context.deferUpdate();
        const result = await updates.removeQuests(questType, userIds);
        const response = buildQueueRemovalResponse(questType, userIds, result.quests);

        try {
            await context.editResponse(await renderQuestListSettings('overview'));
        } catch (error) {
            log.error('Could not refresh settings after removing Quest List quests', {
                error,
                quests: result.quests.length,
            });
            await context.respond(`${response}\n\nThe settings panel could not be refreshed.`, { ephemeral: true });
            return;
        }

        await context.respond(response, { ephemeral: true });
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
