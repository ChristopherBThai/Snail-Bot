import {
    ButtonStyle,
    ChannelType,
    ComponentType,
    SelectMenuDefaultValueType,
    SeparatorSpacingSize,
    TextInputStyle,
} from 'discord-api-types/v10';
import { getModalValue } from '../../discord/interactions.js';

export const SETTINGS_IDS = Object.freeze({
    feedbackChannel: 'knowledgeBase:feedbackChannel',
    clearFeedbackChannel: 'knowledgeBase:clearFeedbackChannel',
    reindex: 'knowledgeBase:reindex',
    reindexModal: 'knowledgeBase:reindexModal',
    reindexMode: 'knowledgeBase:reindexMode',
    reset: 'knowledgeBase:reset',
    resetModal: 'knowledgeBase:resetModal',
    resetCheck: 'knowledgeBase:resetCheck',
    resetText: 'knowledgeBase:resetText',
});

const SYNC_PHASE_LABELS = Object.freeze({
    deletingCollection: 'Deleting collection',
    creatingCollection: 'Creating collection',
    preparingTags: 'Preparing tags',
    readingPoints: 'Reading points',
    comparingPoints: 'Comparing points',
    embeddingPoints: 'Embedding points',
    updatingPoints: 'Updating points',
    complete: 'Complete',
    failed: 'Failed',
});

export function buildOverview(overview) {
    const lastSync = overview.lastSync ? `<t:${Math.floor(overview.lastSync.getTime() / 1000)}:R>` : 'Never';
    return [
        text(
            `### Knowledge Base\n` +
                `**Tags:** ${overview.publicTags.toLocaleString()} public · ` +
                `${overview.privateTags.toLocaleString()} private · ${overview.excludedTags.toLocaleString()} excluded\n` +
                `**Terms:** ${overview.terms.toLocaleString()}\n` +
                `**Qdrant:** ${overview.collection} · ` +
                `${overview.points === undefined ? 'Rebuilding' : `${overview.points.toLocaleString()} points`}\n` +
                `**Models:** Embedding \`${overview.models.embedding}\` · Chat \`${overview.models.chat}\` · ` +
                `Rerank \`${overview.models.rerank}\`\n` +
                `**Retrieval:** ${overview.embeddingSize} dimensions · ${overview.topK} results · ` +
                `${overview.candidateLimit} candidates · ${overview.scoreThreshold} threshold\n` +
                `**Last Sync:** ${overview.syncing ? `In progress · ${formatProgress(overview.progress)}` : lastSync}` +
                (overview.lastSummary
                    ? `\n**Last Result:** ${overview.lastSummary.desiredPoints.toLocaleString()} points · ` +
                      `${overview.lastSummary.added.toLocaleString()} added · ` +
                      `${overview.lastSummary.vectorUpdated.toLocaleString()} vectors updated · ` +
                      `${overview.lastSummary.metaUpdated.toLocaleString()} payloads updated · ` +
                      `${overview.lastSummary.deleted.toLocaleString()} deleted` +
                      (overview.lastSummary.failedTags
                          ? ` · ${overview.lastSummary.failedTags.toLocaleString()} failed`
                          : '') +
                      (overview.lastSummary.dryRun ? ' · dry run' : '')
                    : ''),
        ),
    ];
}

function formatProgress(progress) {
    if (!progress) return 'Starting';
    const phase = SYNC_PHASE_LABELS[progress.phase] ?? progress.phase;
    return `${phase} · ${progress.processed.toLocaleString()}/${progress.total.toLocaleString()}`;
}

export function buildConfiguration(settings) {
    return [
        text('### Feedback Channel'),
        {
            type: ComponentType.ActionRow,
            components: [
                {
                    type: ComponentType.ChannelSelect,
                    customId: SETTINGS_IDS.feedbackChannel,
                    placeholder: 'Choose feedback channel',
                    channelTypes: [ChannelType.GuildText],
                    ...(settings.feedbackChannelId
                        ? {
                              defaultValues: [
                                  {
                                      id: settings.feedbackChannelId,
                                      type: SelectMenuDefaultValueType.Channel,
                                  },
                              ],
                          }
                        : {}),
                },
            ],
        },
        section(
            `### Current Channel\n${settings.feedbackChannelId ? `<#${settings.feedbackChannelId}>` : 'Not configured'}`,
            SETTINGS_IDS.clearFeedbackChannel,
            'Clear',
            !settings.feedbackChannelId,
        ),
    ];
}

export function buildMaintenance(syncing) {
    return [
        section('### Reindex\nSynchronize Mongo tags into Qdrant.', SETTINGS_IDS.reindex, 'Reindex', syncing),
        separator(false),
        section('### Reset\nDelete and rebuild the derived Qdrant collection.', SETTINGS_IDS.reset, 'Reset', syncing),
    ];
}

export function buildReindexModal() {
    return {
        title: 'Reindex Knowledge Base',
        customId: SETTINGS_IDS.reindexModal,
        components: [
            {
                type: ComponentType.Label,
                label: 'Mode',
                component: {
                    type: ComponentType.RadioGroup,
                    customId: SETTINGS_IDS.reindexMode,
                    required: true,
                    options: [
                        {
                            label: 'Synchronize',
                            description: 'Synchronize tags and questions, generating any that are missing.',
                            value: 'sync',
                        },
                        {
                            label: 'Dry run',
                            description: 'Compare cached tags and questions without modifying Mongo or Qdrant.',
                            value: 'dry',
                        },
                        {
                            label: 'Regenerate questions',
                            description: 'Replace questions for every searchable tag, then synchronize.',
                            value: 'regenerate',
                        },
                    ],
                },
            },
        ],
    };
}

export function readReindexMode(interaction) {
    return getModalValue(interaction, SETTINGS_IDS.reindexMode);
}

export function buildResetModal() {
    return {
        title: 'Reset Knowledge Base Index',
        customId: SETTINGS_IDS.resetModal,
        components: [
            {
                type: ComponentType.Label,
                label: 'I understand this deletes the derived index',
                component: {
                    type: ComponentType.Checkbox,
                    customId: SETTINGS_IDS.resetCheck,
                },
            },
            {
                type: ComponentType.Label,
                label: 'Type RESET to confirm',
                component: {
                    type: ComponentType.TextInput,
                    customId: SETTINGS_IDS.resetText,
                    style: TextInputStyle.Short,
                    required: true,
                    maxLength: 5,
                },
            },
        ],
    };
}

export function readResetConfirmation(interaction) {
    const checked = getModalValue(interaction, SETTINGS_IDS.resetCheck);
    const textValue = String(getModalValue(interaction, SETTINGS_IDS.resetText) ?? '')
        .trim()
        .toUpperCase();
    return checked === true && textValue === 'RESET';
}

function text(content) {
    return { type: ComponentType.TextDisplay, content };
}

function section(content, customId, label, disabled = false) {
    return {
        type: ComponentType.Section,
        components: [text(content)],
        accessory: { type: ComponentType.Button, customId, label, style: ButtonStyle.Secondary, disabled },
    };
}

function separator(divider) {
    return { type: ComponentType.Separator, divider, spacing: SeparatorSpacingSize.Small };
}
