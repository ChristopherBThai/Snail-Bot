const Command = require('../Command.js');
const { ephemeralInteractionResponse } = require('../../utils/sender');

const FIND_PREVIEW_LEN = 180;
const FIND_QUESTION_LEN = 90;
const FIELD_VALUE_LIMIT = 1000;
const QUESTION_MODAL_INPUT_ID = 'kb_questions_bulk_text';
const QUESTIONS_EDIT_ID = 'kb_questions_edit';

module.exports = new Command({
    alias: ['kb'],

    group: 'Module',

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: 'snail kb {...arguments}',

    description:
        '- `snail kb status`\n  - Show tag-backed knowledge base sync status and collection info\n' +
        '- `snail kb reindex`\n  - Sync Mongo tags to Qdrant (only changed tag points are re-embedded)\n' +
        '- `snail kb reindex dry`\n  - Show what a reindex would do without making changes\n' +
        '- `snail kb reset confirm`\n  - Destructively recreate the Qdrant collection, then sync Mongo tags. Remote resets require backup through `ssh hub.corg.network` first.\n' +
        '- `snail kb find {query}`\n  - Search matching tags for manager/debug review\n' +
        '- `snail kb questions {tag}`\n  - Show/edit retrieval questions cached in Mongo for a tag\n' +
        '- `snail kb exclude {tag...}`\n  - Exclude one or more tags from KB retrieval and delete their Qdrant points\n' +
        '- `snail kb include {tag...}`\n  - Include one or more tags in KB retrieval and sync their Qdrant points\n' +
        '- `snail kb excluded`\n  - List tags excluded from KB retrieval\n' +
        '- `snail kb model {modelSlug}`\n  - Set the chat model (OpenRouter slug)\n',

    examples: [
        'snail kb status',
        'snail kb reindex',
        'snail kb reindex dry',
        'snail kb reset confirm',
        'snail kb find how do gems expire',
        'snail kb questions gems',
        'snail kb exclude newtr trstart',
        'snail kb include newtr trstart',
        'snail kb excluded',
        'snail kb model anthropic/claude-haiku-4.5',
    ],

    execute: async function () {
        const KB = this.bot.modules['knowledgebase'];
        if (!KB) {
            await this.error('the Knowledge Base module is not loaded.');
            return;
        }

        const subcommand = this.message.args.shift()?.toLowerCase();

        switch (subcommand) {
            case 'status':
                return showStatus.call(this, KB);
            case 'reindex':
                return runReindex.call(this, KB);
            case 'reset':
                return runReset.call(this, KB);
            case 'find':
                return runFind.call(this, KB);
            case 'questions':
                return showQuestions.call(this, KB);
            case 'exclude':
                return setTagExcluded.call(this, KB, true);
            case 'include':
                return setTagExcluded.call(this, KB, false);
            case 'excluded':
                return listExcludedTags.call(this, KB);
            case 'add':
                await this.error(
                    '`snail kb add` has been removed. Add support content with `snail tag add {name} {data}`.'
                );
                return;
            case 'model':
                return setModel.call(this, KB);
            default:
                await this.error(
                    'that is not a valid subcommand! Use `snail kb [status|reindex|reset|find|questions|exclude|include|excluded|model] {...arguments}`'
                );
        }
    },
});

async function showStatus(KB) {
    let pointCount = null;
    try {
        if (!KB.qdrant) await KB.initQdrant();
        pointCount = await KB.qdrant.count(KB.collection);
    } catch (err) {
        pointCount = `error: ${err.message}`;
    }

    let last;
    if (KB.syncing) last = 'in progress';
    else if (KB.lastSync) last = `<t:${Math.floor(KB.lastSync.getTime() / 1000)}:R>`;
    else last = 'never';

    const lastSummary = KB.lastSyncSummary
        ? `\n - added: ${KB.lastSyncSummary.added}` +
          `\n - vector updates: ${KB.lastSyncSummary.vectorUpdated}` +
          `\n - payload updates: ${KB.lastSyncSummary.metaUpdated}` +
          `\n - deleted: ${KB.lastSyncSummary.deleted}` +
          `\n - unchanged: ${KB.lastSyncSummary.unchanged}`
        : '';

    const progress = typeof KB.getSyncProgress === 'function' ? KB.getSyncProgress() : null;
    const progressSummary = progress ? formatSyncProgress(progress) : '';

    const embed = {
        title: 'Knowledge Base Status',
        color: this.config.embedcolor,
        description:
            `**Enabled:** ${KB.enabled}\n` +
            `**Collection:** \`${KB.collection}\`\n` +
            `**Points in Qdrant:** ${pointCount}\n` +
            `**Chat Model:** \`${KB.chatModel}\`\n` +
            `**Embedding Model:** \`${KB.embeddingModel}\`\n` +
            `**Last Sync:** ${last}${lastSummary}${progressSummary}`,
    };
    await this.send({ embed });
}

function formatSyncProgress(progress) {
    const started = progress.startedAt
        ? `<t:${Math.floor(new Date(progress.startedAt).getTime() / 1000)}:R>`
        : 'unknown';
    const updated = progress.updatedAt
        ? `<t:${Math.floor(new Date(progress.updatedAt).getTime() / 1000)}:R>`
        : 'unknown';
    const lines = [
        '',
        '**Current Sync Progress:**',
        ` - mode: ${progress.dryRun ? 'dry run' : 'live sync'}`,
        ` - phase: ${progress.phase}`,
        ` - questions generated: ${progress.processedTags}/${progress.totalTags}`,
        ` - qdrant sync: ${progress.tagsWithQuestionsInQdrant}/${progress.totalTags}`,
        ` - planned points: ${progress.plannedPoints}`,
    ];

    if (progress.totalAnswers || progress.totalQuestions) {
        lines.push(
            ` - point types: ${progress.totalAnswers} tag data + ${progress.totalQuestions} retrieval questions`
        );
    }
    if (progress.totalEmbeds) lines.push(` - embedded: ${progress.embeddedPoints}/${progress.totalEmbeds}`);
    if (progress.totalPayloadUpdates) {
        lines.push(` - payload updates: ${progress.updatedPayloads}/${progress.totalPayloadUpdates}`);
    }
    if (progress.deletedPoints) lines.push(` - deleted: ${progress.deletedPoints}`);
    lines.push(` - started: ${started}`);
    lines.push(` - updated: ${updated}`);
    return `\n${lines.join('\n')}`;
}

async function runReindex(KB) {
    const dry = this.message.args[0]?.toLowerCase() === 'dry';

    if (KB.syncing) {
        await this.error('a sync is already in progress!');
        return;
    }

    const status = await this.send(`🐌 **|** ${dry ? 'Computing diff' : 'Syncing'}...`);

    try {
        const summary = await KB.sync({ dryRun: dry });
        const embed = {
            title: dry ? 'Reindex (dry run)' : 'Reindex Complete',
            color: this.config.embedcolor,
            description:
                `**Added:** ${summary.added}\n` +
                `**Vector updates:** ${summary.vectorUpdated}\n` +
                `**Payload updates:** ${summary.metaUpdated}\n` +
                `**Deleted:** ${summary.deleted}\n` +
                `**Unchanged:** ${summary.unchanged}\n` +
                `**Tags:** ${summary.totalTags}\n` +
                `**Points:** ${summary.totalPoints} ` +
                `(${summary.totalQuestions} retrieval questions + ${summary.totalAnswers} tag data points)`,
        };
        await status.edit({ content: '', embed });
    } catch (err) {
        console.error('[KB] reindex failed:', err);
        await status.edit({ content: `🚫 **|** Reindex failed: \`${err.message}\`` });
    }
}

async function runReset(KB) {
    const confirm = this.message.args[0]?.toLowerCase() === 'confirm';
    const backupReminder =
        'Remote reset requires backup evidence first: run/record backup through `ssh hub.corg.network` before using this command against remote Qdrant.';

    if (!confirm) {
        await this.error(
            `this is destructive: it recreates Qdrant collection \`${KB.collection}\`. ` +
                `${backupReminder} To continue, run \`snail kb reset confirm\`.`
        );
        return;
    }

    if (KB.syncing) {
        await this.error('a sync is already in progress!');
        return;
    }

    const status = await this.send(`⚠️ **|** Resetting Qdrant collection \`${KB.collection}\` and syncing tags...`);

    try {
        const summary = await KB.resetQdrantAndSync();
        const embed = {
            title: 'Qdrant Reset Complete',
            color: this.config.embedcolor,
            description:
                `**Collection:** \`${summary.collection || KB.collection}\`\n` +
                `**Tags:** ${summary.totalTags}\n` +
                `**Points:** ${summary.totalPoints} ` +
                `(${summary.totalQuestions} retrieval questions + ${summary.totalAnswers} tag data points)\n\n` +
                `**Backup reminder:** ${backupReminder}`,
        };
        await status.edit({ content: '', embed });
    } catch (err) {
        console.error('[KB] reset failed:', err);
        await status.edit({ content: `🚫 **|** Reset failed: \`${err.message}\`` });
    }
}

async function runFind(KB) {
    const query = this.message.args.join(' ').trim();
    if (!query) {
        await this.error('please provide a query! Example: `snail kb find how do gems work`');
        return;
    }
    if (query.length > 500) {
        await this.error('that is too long! Keep it under 500 characters.');
        return;
    }

    let groups;
    try {
        groups = await KB.findSimilar(query, { limit: 5 });
    } catch (err) {
        console.error('[KB] findSimilar failed:', err);
        await this.error(`search failed: \`${err.message}\``);
        return;
    }

    if (!groups.length) {
        await this.send({
            embed: {
                title: 'KB Tag Find — no results',
                description: `No matching tags found for: ${query}`,
                color: this.config.color.orange,
            },
        });
        return;
    }

    const fields = groups.slice(0, 5).map((group, index) => {
        const kinds = group.matchedKinds?.join(', ') || '—';
        const matchedQuestions = (group.matchedQuestions || []).map(
            (q) => `- ${q.slice(0, FIND_QUESTION_LEN)}${q.length > FIND_QUESTION_LEN ? '…' : ''}`
        );
        const questions = matchedQuestions.length ? matchedQuestions.join('\n') : '—';
        const preview = (group.dataPreview || '').slice(0, FIND_PREVIEW_LEN);
        const ellipsis = (group.dataPreview || '').length > FIND_PREVIEW_LEN ? '…' : '';
        const value =
            `**Matched kinds:** ${kinds}\n` +
            `**Retrieval-question matches:**\n${questions}\n` +
            `**Tag data preview:** ${preview}${ellipsis}\n` +
            `**Manage:** \`snail tag edit ${group.tagId} {data}\` or \`snail tag delete ${group.tagId}\``;
        return {
            name: `${index + 1}. \`${group.tagId}\` — top score ${group.topScore.toFixed(4)}`,
            value: truncateFieldValue(value),
        };
    });

    await this.send({
        embed: {
            title: 'KB Tag Find Results',
            description:
                `**Query:** ${query}\n` +
                'Results are tag-backed. Add or change support content with `snail tag add/edit/delete`.',
            color: this.config.embedcolor,
            fields,
        },
    });
}

async function showQuestions(KB) {
    const tagId = this.message.args.shift();
    if (!tagId) {
        await this.error('please provide a tag id! Example: `snail kb questions gems`');
        return;
    }

    let editor;
    try {
        editor = await KB.getTagQuestionEditor(tagId);
    } catch (err) {
        console.error('[KB] getTagQuestionEditor failed:', err);
        await this.error(`failed to read cached questions: \`${err.message}\``);
        return;
    }

    if (!editor) {
        await this.error(`I could not find tag \`${tagId}\`.`);
        return;
    }

    let content = renderQuestionEditor(this, editor);
    const message = await this.send(content);
    const collectorModule = this.bot.modules['interactioncollector'];
    if (!collectorModule?.create) return;

    const filter = (user) => this.message.author.id === user.id;
    const collector = collectorModule.create(message, filter, { idle: 120000 });
    collector.on('collect', async (data, interaction) => {
        let acknowledged = false;
        try {
            if (data.isModal) {
                const rawText = getModalInputValue(data, QUESTION_MODAL_INPUT_ID);
                await interaction.acknowledge();
                acknowledged = true;
                const result = await KB.updateTagQuestions(editor.tagId, rawText);
                if (!result) {
                    await message.edit({ content: '🚫 **|** That tag no longer exists.', components: [] });
                    collector.stop('missing');
                    return;
                }
                editor = result.editor;
                content = renderQuestionEditor(this, editor, summarizeSyncResult('Saved questions', result));
                await message.edit(content);
                return;
            }

            switch (data.custom_id) {
                case QUESTIONS_EDIT_ID:
                    await interaction.createModal(getQuestionsModal(editor, message.id));
                    return;
            }
        } catch (err) {
            console.error(`[KB] questions editor failed for '${editor?.tagId || tagId}':`, err);
            if (acknowledged) {
                content = renderQuestionEditor(this, editor, `🚫 ${err.message}`);
                await message.edit(content).catch(() => {});
            } else {
                await interaction.createMessage(ephemeralInteractionResponse(`🚫 **|** ${err.message}`)).catch(() => {});
            }
        }
    });

    collector.on('end', async () => {
        disableComponents(content);
        await message.edit(content).catch(() => {});
    });
}

function renderQuestionEditor(command, editor, notice = '') {
    const renderedQuestions = editor.questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n');
    const questions = editor.questions.length
        ? renderedQuestions.slice(0, 3000)
        : 'No retrieval questions are cached for this tag. Use **Edit Questions** to add retrieval questions, or leave it empty to index only the tag answer.';
    const generatedAt = editor.generatedAt ? `<t:${Math.floor(new Date(editor.generatedAt).getTime() / 1000)}:R>` : 'never';
    const status = [
        `**Excluded:** ${editor.excluded ? 'yes (Qdrant tag points are deleted)' : 'no'}`,
        `**Prompt Version:** \`${editor.promptVersion || 'none'}\``,
        `**Generated:** ${generatedAt}`,
        `**Question Count:** ${editor.questions.length}`,
    ];
    if (!editor.cacheCurrent) status.push('**Cache:** metadata will be refreshed on next sync.');
    if (notice) status.push('', notice);

    return {
        embed: {
            title: `KB Retrieval Questions — ${editor.tagId}`,
            color: command.config.embedcolor,
            description: `${status.join('\n')}\n\n${questions}`,
            footer: { text: 'Edit one retrieval question per line. Tag answers still use only tag data.' },
        },
        components: [
            {
                type: 1,
                components: [
                    { type: 2, custom_id: QUESTIONS_EDIT_ID, style: 1, label: 'Edit Questions' },
                ],
            },
        ],
    };
}

function getQuestionsModal(editor, modalId) {
    return {
        title: `Edit KB questions: ${editor.tagId}`.slice(0, 45),
        custom_id: modalId,
        components: [
            {
                type: 1,
                components: [
                    {
                        type: 4,
                        custom_id: QUESTION_MODAL_INPUT_ID,
                        label: 'One retrieval question per line',
                        style: 2,
                        max_length: 4000,
                        required: false,
                        value: editor.questions.map((question) => question.text).join('\n'),
                        placeholder: 'How do gems work?\nWhen do gems expire?',
                    },
                ],
            },
        ],
    };
}

function getModalInputValue(data, customId) {
    for (const row of data.components || []) {
        for (const component of row.components || []) {
            if (component.custom_id === customId) return component.value || '';
        }
    }
    return '';
}

function summarizeSyncResult(label, result) {
    if (result.excluded) return `${label}. Tag is excluded, so Qdrant tag points were deleted.`;
    return (
        `${label}. Qdrant sync: ` +
        `+${result.added || 0}, ~${result.vectorUpdated || 0} vectors, ` +
        `~${result.metaUpdated || 0} payloads, -${result.deleted || 0}.`
    );
}

function disableComponents(content) {
    for (const row of content.components || []) {
        for (const component of row.components || []) {
            component.disabled = true;
        }
    }
}

async function setTagExcluded(KB, excluded) {
    const tagIds = [...new Set(this.message.args.map((tagId) => tagId.trim()).filter(Boolean))];
    if (!tagIds.length) {
        await this.error(
            `please provide at least one tag id! Example: \`snail kb ${
                excluded ? 'exclude' : 'include'
            } taga tagb tagc\``
        );
        return;
    }

    const changed = [];
    const missing = [];
    const failed = [];
    for (const tagId of tagIds) {
        try {
            const result = await KB.setTagKbExcluded(tagId, excluded);
            if (!result) {
                missing.push(tagId);
                continue;
            }
            changed.push(result.tagId);
        } catch (err) {
            console.error(`[KB] ${excluded ? 'exclude' : 'include'} tag '${tagId}' failed:`, err);
            failed.push({ tagId, message: err.message });
        }
    }

    const action = excluded ? 'Excluded' : 'Included';
    const effect = excluded
        ? 'Deleted Qdrant tag/question points for matched tags.'
        : 'Synced Qdrant points for matched tags.';
    const lines = [`**${action}:** ${formatTagList(changed)}`, `**Missing:** ${formatTagList(missing)}`];
    if (failed.length) lines.push(`**Failed:** ${formatFailedTags(failed)}`);
    lines.push(effect);

    await this.send({
        embed: {
            title: `KB ${action} Tags`,
            color: failed.length ? this.config.color?.orange || this.config.embedcolor : this.config.embedcolor,
            description: lines.join('\n'),
        },
    });
}

function formatTagList(tagIds) {
    if (!tagIds.length) return 'none';
    return tagIds.map((tagId) => `\`${tagId}\``).join(', ');
}

function formatFailedTags(failed) {
    return failed.map(({ tagId, message }) => `\`${tagId}\` (${message})`).join(', ');
}

function truncateFieldValue(value) {
    if (value.length <= FIELD_VALUE_LIMIT) return value;
    return `${value.slice(0, FIELD_VALUE_LIMIT - 1)}…`;
}

async function listExcludedTags(KB) {
    let tags;
    try {
        tags = await KB.listKbExcludedTags();
    } catch (err) {
        console.error('[KB] list excluded tags failed:', err);
        await this.error(`failed to list excluded tags: \`${err.message}\``);
        return;
    }

    const listedTags = formatTagList(tags);
    const description = tags.length ? listedTags.slice(0, 3500) : 'No tags are excluded from the knowledge base.';

    await this.send({
        embed: {
            title: 'KB Excluded Tags',
            color: this.config.embedcolor,
            description,
        },
    });
}

async function setModel(KB) {
    const model = this.message.args.shift();
    if (!model) {
        await this.error('please provide a model slug! Example: `snail kb model anthropic/claude-haiku-4.5`');
        return;
    }
    await KB.setChatModel(model);
    await this.send(`I have set the chat model to \`${model}\`!`);
}
