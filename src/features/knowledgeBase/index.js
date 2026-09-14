import { GatewayDispatchEvents } from 'discord-api-types/v10';
import { hasManagerAccess } from '../../discord/auth.js';
import { getInteractionUser, getSelectValue } from '../../discord/interactions.js';
import { ASK_COMMAND, createAsk } from './ask.js';
import { createKnowledgeBase } from './knowledge.js';
import { createKnowledgeBaseManagement } from './management.js';
import { IDS } from './render.js';
import {
    buildConfiguration,
    buildMaintenance,
    buildOverview,
    buildReindexModal,
    buildResetModal,
    readReindexMode,
    readResetConfirmation,
    SETTINGS_IDS,
} from './settings.js';

/**
 * @param {import('../../packages.js').PackageContext & {tags: Map<string, object>}} context
 * @returns {Promise<{
 *     package: import('../../packages.js').Package,
 *     tagSync: import('../../packages.js').KnowledgeBaseTagSync | undefined,
 * }>}
 */
export default async function setup({ config, features, logging, rest, services, tags }) {
    const log = logging.createLogger('knowledgeBase');
    const mongo = services.snail.mongo;
    const missingKnowledgeBaseConfig = [
        ['collection', config.knowledgeBase?.collection],
        ['embeddingSize', config.knowledgeBase?.embeddingSize],
        ['queryInstruction', config.knowledgeBase?.queryInstruction],
        ['topK', config.knowledgeBase?.topK],
        ['rerankCandidateLimit', config.knowledgeBase?.rerankCandidateLimit],
        ['scoreThreshold', config.knowledgeBase?.scoreThreshold],
    ]
        .filter(([, value]) => value === undefined)
        .map(([key]) => `knowledgeBase.${key} (config)`);
    const searchMissing = [
        !services.qdrant && 'Qdrant',
        !services.openRouter && 'OpenRouter',
        ...missingKnowledgeBaseConfig,
    ].filter(Boolean);
    const terms = new Map();
    const knowledge =
        mongo && !searchMissing.length
            ? createKnowledgeBase({
                  config: config.knowledgeBase,
                  Tag: mongo.Tag,
                  tags,
                  terms,
                  qdrant: services.qdrant,
                  openRouter: services.openRouter,
                  elasticApm: services.elasticApm,
                  log,
              })
            : undefined;
    const tagSync = knowledge
        ? {
              syncTags(tags_) {
                  if (!features.get('knowledgeBase')?.enabled) return;
                  return knowledge.syncTags(tags_);
              },
              deleteTags(tagIds) {
                  if (!features.get('knowledgeBase')?.enabled) return;
                  return knowledge.deleteTags(tagIds);
              },
          }
        : undefined;
    const management = createKnowledgeBaseManagement({
        Tag: mongo?.Tag,
        KnowledgeTerm: mongo?.KnowledgeTerm,
        knowledge,
        tagSync,
        tags,
        terms,
        log,
        searchMissing,
    });
    const ask = knowledge
        ? createAsk({
              knowledge,
              log,
              Setting: mongo.Setting,
              rest,
          })
        : undefined;
    await Promise.all([management.initialize(), knowledge?.initialize(), ask?.initialize()]);

    const package_ = {
        name: 'Knowledge Base',
        missing: mongo ? [] : ['Snail Mongo'],
        commands: [management.command, { definition: ASK_COMMAND, missing: searchMissing, handle: ask?.handleCommand }],
        components: [
            ...management.components,
            { prefix: IDS.feedback, missing: searchMissing, handle: ask?.submitFeedback },
            managerInteraction(SETTINGS_IDS.feedbackChannel, setFeedbackChannel, searchMissing),
            managerInteraction(SETTINGS_IDS.clearFeedbackChannel, clearFeedbackChannel, searchMissing),
            managerInteraction(SETTINGS_IDS.reindex, openReindex, searchMissing),
            managerInteraction(SETTINGS_IDS.reset, openReset, searchMissing),
        ],
        modals: [
            ...management.modals,
            managerInteraction(SETTINGS_IDS.reindexModal, runReindex, searchMissing),
            managerInteraction(SETTINGS_IDS.resetModal, runReset, searchMissing),
        ],
        feature: {
            id: 'knowledgeBase',
            description: 'Answers OwO questions from maintained support knowledge.',
            missing: searchMissing,
            toggleable: true,
            activate: knowledge?.activate,
            events: ask ? [{ event: GatewayDispatchEvents.MessageCreate, handle: ask.handleMessage }] : [],
            settings: {
                pages: [
                    { id: 'overview', label: 'Overview', render: renderOverview },
                    { id: 'configuration', label: 'Configuration', render: renderConfiguration },
                    { id: 'maintenance', label: 'Maintenance', render: renderMaintenance },
                ],
            },
        },
    };

    return { package: package_, tagSync };

    async function renderOverview() {
        const overview = await knowledge.getOverview();
        return buildOverview({
            ...overview,
            models: {
                embedding: services.openRouter.embeddingModel,
                chat: services.openRouter.chatModel,
                rerank: services.openRouter.rerankModel,
            },
        });
    }

    function renderConfiguration() {
        return buildConfiguration(ask.state);
    }

    function renderMaintenance() {
        return buildMaintenance(knowledge.state.syncing);
    }

    async function setFeedbackChannel(context) {
        const channelId = getSelectValue(context.interaction);
        if (!channelId) {
            await context.respond('Choose a feedback channel.', { ephemeral: true });
            return;
        }

        await context.deferUpdate();
        await ask.setFeedbackChannel(channelId);
        log.info('Changed Knowledge Base feedback channel', {
            channelId,
            userId: getInteractionUser(context.interaction)?.id,
        });
        await finishSettingsMutation(
            context,
            `Set the Knowledge Base feedback channel to <#${channelId}>.`,
            'configuration',
        );
    }

    async function clearFeedbackChannel(context) {
        await context.deferUpdate();
        await ask.clearFeedbackChannel();
        log.info('Cleared Knowledge Base feedback channel', {
            userId: getInteractionUser(context.interaction)?.id,
        });
        await finishSettingsMutation(context, 'Cleared the Knowledge Base feedback channel.', 'configuration');
    }

    async function openReindex(context) {
        await context.openModal(buildReindexModal());
    }

    async function runReindex(context) {
        const mode = readReindexMode(context.interaction);
        await context.deferUpdate();
        const summary = await knowledge.sync({
            dryRun: mode === 'dry',
            regenerateQuestions: mode === 'regenerate',
        });
        log.info('Ran Knowledge Base reindex', {
            mode,
            ...summary,
            userId: getInteractionUser(context.interaction)?.id,
        });
        const summaryText =
            mode === 'dry'
                ? `Dry run complete: ${summary.desiredPoints.toLocaleString()} cached points desired`
                : `Reindex complete: ${summary.desiredPoints.toLocaleString()} points synchronized`;
        await finishSettingsMutation(
            context,
            `${summaryText}${summary.failedTags ? `; ${summary.failedTags.toLocaleString()} tags failed` : ''}.`,
            'maintenance',
        );
    }

    async function openReset(context) {
        await context.openModal(buildResetModal());
    }

    async function runReset(context) {
        if (!readResetConfirmation(context.interaction)) {
            await context.respond('Check the confirmation and type RESET.', { ephemeral: true });
            return;
        }

        await context.deferUpdate();
        const summary = await knowledge.reset();
        log.warn('Reset Knowledge Base Qdrant collection', {
            ...summary,
            userId: getInteractionUser(context.interaction)?.id,
        });
        await finishSettingsMutation(
            context,
            `Knowledge Base index rebuilt with ${summary.desiredPoints.toLocaleString()} points` +
                `${summary.failedTags ? `; ${summary.failedTags.toLocaleString()} tags failed` : ''}.`,
            'maintenance',
        );
    }

    async function finishSettingsMutation(context, message, pageId) {
        try {
            await context.respond(message, { ephemeral: true });
        } catch (error) {
            log.warn('Could not send Knowledge Base settings confirmation', { error, pageId });
        }

        try {
            await context.editResponse(await renderKnowledgeBaseSettings(pageId));
        } catch (error) {
            log.warn('Could not refresh Knowledge Base settings', { error, pageId });
        }
    }

    function renderKnowledgeBaseSettings(pageId) {
        return features.get('knowledgeBase').renderSettings(pageId);
    }
}

function managerInteraction(id, handle, missing = []) {
    return { id, missing, availableWhenDisabled: true, authorize: hasManagerAccess, handle };
}
