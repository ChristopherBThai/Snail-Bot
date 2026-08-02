const Command = require('../Command.js');
const { ephemeralInteractionResponse } = require('../../utils/sender');

const FIND_PREVIEW_LEN = 180;
const FIND_QUESTION_LEN = 90;
const FIELD_VALUE_LIMIT = 1000;
const EMBED_TOTAL_LIMIT = 6000;
const EMBED_DESCRIPTION_LIMIT = 4096;
const EMBED_FIELD_VALUE_LIMIT = 1024;
const ANSWER_CHUNK_LIMIT = 1000;
const QUESTION_MODAL_INPUT_ID = 'kb_questions_bulk_text';
const QUESTIONS_EDIT_ID = 'kb_questions_edit';
const QUESTIONS_GENERATE_ID = 'kb_questions_generate';
module.exports = new Command({
    alias: ['kb'],

    group: 'Module',

    auth: require('../../utils/permissions.js').hasManagerPerms,

    usage: 'snail kb {...arguments}',

    description:
        '- `snail kb status`\n  - Show tag-backed knowledge base sync status and collection info\n' +
        '- `snail kb reindex`\n  - Sync Mongo tags to Qdrant (only changed tag points are re-embedded)\n' +
        '- `snail kb reindex dry`\n  - Show what a reindex would do without making changes\n' +
        '- `snail kb reindex questions`\n  - Regenerate retrieval questions for all tags, then incrementally sync Qdrant\n' +
        '- `snail kb reset confirm`\n  - Destructively recreate the Qdrant collection, then sync Mongo tags. Remote resets require backup through `ssh hub.corg.network` first.\n' +
        '- `snail kb find {query}`\n  - Search matching tags for manager/debug review\n' +
        '- `snail kb add {name} {data}`\n  - Add a KB-only/private support tag\n' +
        '- `snail kb edit {name} {data}`\n  - Edit a KB-only/private support tag\n' +
        '- `snail kb delete {name}`\n  - Delete a KB-only/private support tag\n' +
        '- `snail kb list`\n  - List KB-only/private support tags\n' +
        '- `snail kb questions {tag}`\n  - Show/edit retrieval questions cached in Mongo for a tag\n' +
        '- `snail kb term set {id} {meaning}`\n  - Add or update an OwO bot term appended to final ask prompts\n' +
        '- `snail kb term delete {id}`\n  - Delete an OwO bot term\n' +
        '- `snail kb term list`\n  - List stored OwO bot terms\n' +
        '- `snail kb exclude {tag...}`\n  - Exclude one or more tags from KB retrieval and delete their Qdrant points\n' +
        '- `snail kb include {tag...}`\n  - Include one or more tags in KB retrieval and sync their Qdrant points\n' +
        '- `snail kb excluded`\n  - List tags excluded from KB retrieval\n' +
        '- `snail kb enableThreads true|false`\n  - Enable or disable ask thread responses\n' +
        '- `snail kb model {modelSlug}`\n  - Set the chat model (OpenRouter slug)\n',

    examples: [
        'snail kb status',
        'snail kb reindex',
        'snail kb reindex dry',
        'snail kb reindex questions',
        'snail kb reset confirm',
        'snail kb find how do gems expire',
        'snail kb add privategems Private note for support helpers only',
        'snail kb edit privategems Updated private note for support helpers only',
        'snail kb delete privategems',
        'snail kb list',
        'snail kb questions gems',
        'snail kb term set dt distorted pets',
        'snail kb term delete dt',
        'snail kb term list',
        'snail kb exclude newtr trstart',
        'snail kb include newtr trstart',
        'snail kb excluded',
        'snail kb enableThreads false',
        'snail kb model anthropic/claude-haiku-4.5',
    ],

    execute: async function () {
        const KB = this.bot.modules['knowledgebase'];
        const openrouter = this.bot.modules.openrouter;
        if (!KB) {
            await this.error('the Knowledge Base module is not loaded.');
            return;
        }

        if (!openrouter?.enabled) {
            await this.error('the OpenRouter module is not loaded or enabled.');
            return;
        }

        const subcommand = this.message.args.shift()?.toLowerCase();

        switch (subcommand) {
            case 'status':
                return showStatus.call(this, KB, openrouter);
            case 'reindex':
                return runReindex.call(this, KB);
            case 'reset':
                return runReset.call(this, KB);
            case 'find':
                return runFind.call(this, KB);
            case 'add':
                return addKbOnlyTag.call(this, KB);
            case 'edit':
                return editKbOnlyTag.call(this, KB);
            case 'delete':
                return deleteKbOnlyTag.call(this, KB);
            case 'list':
                return listKbOnlyTags.call(this);
            case 'questions':
                return showQuestions.call(this, KB);
            case 'term':
                return runTerm.call(this, KB);
            case 'exclude':
                return setTagExcluded.call(this, KB, true);
            case 'include':
                return setTagExcluded.call(this, KB, false);
            case 'excluded':
                return listExcludedTags.call(this, KB);
            case 'enablethreads': {
                const [value] = this.message.args;
                if (this.message.args.length !== 1 || (value !== 'true' && value !== 'false')) {
                    await this.error('please choose exactly `true` or `false`.');
                    return;
                }
                const enabled = value === 'true';
                await KB.setThreadsEnabled(enabled);
                return this.send(`I have set KB thread responses to \`${enabled}\`!`);
            }
            case 'model':
                return setModel.call(this, openrouter);
            default:
                await this.error(
                    'that is not a valid subcommand! Use `snail kb [status|reindex|reset|find|add|edit|delete|list|questions|term|exclude|include|excluded|enableThreads|model] {...arguments}`'
                );
        }
    },
});

async function showStatus(KB, openrouter) {
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
            `**Chat Model:** \`${openrouter.chatModel}\`\n` +
            `**Embedding Model:** \`${openrouter.embeddingModel}\`\n` +
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
    const modes = new Set(this.message.args.map((arg) => arg.toLowerCase()));
    const dry = modes.has('dry');
    const regenerateQuestions = modes.has('questions');

    if (dry && regenerateQuestions) {
        await this.error(
            '`snail kb reindex questions` regenerates Mongo question caches, so it cannot be combined with `dry`.'
        );
        return;
    }

    if (KB.syncing) {
        await this.error('a sync is already in progress!');
        return;
    }

    const status = await this.send(
        `🐌 **|** ${dry ? 'Computing diff' : regenerateQuestions ? 'Regenerating questions and syncing' : 'Syncing'}...`
    );

    try {
        const summary = await KB.sync({ dryRun: dry, regenerateQuestions });
        const embed = {
            title: dry ? 'Reindex (dry run)' : regenerateQuestions ? 'Question Reindex Complete' : 'Reindex Complete',
            color: this.config.embedcolor,
            description:
                `**Question Cache:** ${summary.regeneratedQuestions ? 'regenerated' : 'preserved'}\n` +
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
            `**Visibility:** ${group.visibility === 'kb_only' ? 'KB-only' : 'public'}\n` +
            `**Matched kinds:** ${kinds}\n` +
            `**Retrieval-question matches:**\n${questions}\n` +
            `**Tag data preview:** ${preview}${ellipsis}\n`;
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
                'Results are tag-backed. Use `snail tag add/edit/delete` for public tags and `snail kb add/edit/delete` for KB-only tags.',
            color: this.config.embedcolor,
            fields,
        },
    });
}

async function addKbOnlyTag(KB) {
    const name = this.message.args.shift()?.toLowerCase();
    const data = this.message.args.join(' ');
    if (!name) {
        await this.error('please provide a tag name!');
        return;
    }
    if (!data) {
        await this.error('please provide some data for the KB-only tag!');
        return;
    }
    if (!/^[a-z0-9]+$/.test(name)) {
        await this.error('tag names can only contain alphanumeric characters!');
        return;
    }

    const tag = await this.snail_db.Tag.findById(name);
    if (tag) {
        const visibilityHint =
            tag.visibility === 'kb_only'
                ? ' Use `snail kb edit/delete` for existing KB-only tags.'
                : ' This is a public tag; use `snail tag edit/delete`.';
        await this.error(`that tag already exists!${visibilityHint}`);
        return;
    }

    await this.snail_db.Tag.create({ _id: name, data, visibility: 'kb_only' });
    if (KB.enabled) {
        try {
            await KB.syncTagById(name);
        } catch (err) {
            console.error(`[KB] KB-only tag add sync hook failed for '${name}':`, err.message);
        }
    }
    await this.send(`I created the KB-only tag \`${name}\`!`);
}

async function editKbOnlyTag(KB) {
    const name = this.message.args.shift()?.toLowerCase();
    const data = this.message.args.join(' ');
    if (!name) {
        await this.error('please provide a tag name!');
        return;
    }
    if (!data) {
        await this.error('please provide some data for the KB-only tag!');
        return;
    }

    const tag = await this.snail_db.Tag.findById(name);
    if (!tag) {
        await this.error('that tag does not exist!');
        return;
    }
    if (tag.visibility !== 'kb_only') {
        await this.error(`\`${name}\` is a public tag. Use \`snail tag edit ${name}\` instead.`);
        return;
    }

    await this.snail_db.Tag.updateOne({ _id: name }, { data });
    if (KB.enabled) {
        try {
            await KB.syncTagById(name);
        } catch (err) {
            console.error(`[KB] KB-only tag edit sync hook failed for '${name}':`, err.message);
        }
    }
    await this.send(`I updated the KB-only tag \`${name}\`!`);
}

async function deleteKbOnlyTag(KB) {
    const name = this.message.args.shift()?.toLowerCase();
    if (!name) {
        await this.error('please provide a tag name!');
        return;
    }

    const tag = await this.snail_db.Tag.findById(name);
    if (!tag) {
        await this.error('that tag does not exist!');
        return;
    }
    if (tag.visibility !== 'kb_only') {
        await this.error(`\`${name}\` is a public tag. Use \`snail tag delete ${name}\` instead.`);
        return;
    }

    await this.snail_db.Tag.deleteOne({ _id: name });
    if (KB.enabled) {
        try {
            await KB.deleteTagById(name);
        } catch (err) {
            console.error(`[KB] KB-only tag delete sync hook failed for '${name}':`, err.message);
        }
    }
    await this.send(`I deleted the KB-only tag \`${name}\`!`);
}

async function listKbOnlyTags() {
    let tags;
    try {
        tags = (await this.snail_db.Tag.find({ visibility: 'kb_only' }))
            .map((tag) => String(tag._id))
            .sort((a, b) => a.localeCompare(b));
    } catch (err) {
        console.error('[KB] list KB-only tags failed:', err);
        await this.error(`failed to list KB-only tags: \`${err.message}\``);
        return;
    }

    if (!tags.length) {
        await this.error(`Oh no! I don't have any KB-only tags :(`);
        return;
    }

    await this.send({
        embed: {
            title: `KB-only Tags (${tags.length})`,
            description: formatTagList(tags).slice(0, 3500),
            timestamp: new Date(),
            color: this.config.embedcolor,
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

    let rendered = renderQuestionEditorMessages(this, editor);
    let content = rendered.content;
    const message = await this.send(content);
    let answerMessage = rendered.answerContent ? await this.send(rendered.answerContent) : null;
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
                    content = { content: '🚫 **|** That tag no longer exists.', components: [] };
                    await message.edit(content);
                    if (answerMessage) {
                        await answerMessage.delete().catch(() => {});
                        answerMessage = null;
                    }
                    collector.stop('missing');
                    return;
                }
                editor = result.editor;
                rendered = renderQuestionEditorMessages(this, editor, summarizeSyncResult('Saved questions', result));
                content = rendered.content;
                await message.edit(content);
                if (rendered.answerContent) {
                    if (answerMessage) await answerMessage.edit(rendered.answerContent);
                    else answerMessage = await this.send(rendered.answerContent);
                } else if (answerMessage) {
                    await answerMessage.delete().catch(() => {});
                    answerMessage = null;
                }
                return;
            }

            switch (data.custom_id) {
                case QUESTIONS_EDIT_ID:
                    await interaction.createModal(getQuestionsModal(editor, message.id));
                    return;
                case QUESTIONS_GENERATE_ID: {
                    await interaction.acknowledge();
                    acknowledged = true;
                    rendered = renderQuestionEditorMessages(this, editor, 'Generating retrieval questions...');
                    content = rendered.content;
                    await message.edit(content);

                    const result = await KB.regenerateTagQuestions(editor.tagId);
                    if (!result) {
                        content = { content: '🚫 **|** That tag no longer exists.', components: [] };
                        await message.edit(content);
                        if (answerMessage) {
                            await answerMessage.delete().catch(() => {});
                            answerMessage = null;
                        }
                        collector.stop('missing');
                        return;
                    }

                    editor = result.editor;
                    rendered = renderQuestionEditorMessages(
                        this,
                        editor,
                        summarizeSyncResult('Regenerated questions', result)
                    );
                    content = rendered.content;
                    await message.edit(content);
                    if (rendered.answerContent) {
                        if (answerMessage) await answerMessage.edit(rendered.answerContent);
                        else answerMessage = await this.send(rendered.answerContent);
                    } else if (answerMessage) {
                        await answerMessage.delete().catch(() => {});
                        answerMessage = null;
                    }
                    return;
                }
            }
        } catch (err) {
            console.error(`[KB] questions editor failed for '${editor?.tagId || tagId}':`, err);
            if (acknowledged) {
                rendered = renderQuestionEditorMessages(this, editor, `🚫 ${err.message}`);
                content = rendered.content;
                await message.edit(content).catch(() => {});
            } else {
                await interaction
                    .createMessage(ephemeralInteractionResponse(`🚫 **|** ${err.message}`))
                    .catch(() => {});
            }
        }
    });

    collector.on('end', async () => {
        disableComponents(content);
        await message.edit(content).catch(() => {});
    });
}

function renderQuestionEditorMessages(command, editor, notice = '') {
    const renderedQuestions = editor.questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n');
    const questions = editor.questions.length
        ? renderedQuestions.slice(0, 3000)
        : 'No retrieval questions are cached for this tag. Use **Edit Questions** to add retrieval questions, or leave it empty to index only the tag answer.';
    const generatedAt = editor.generatedAt
        ? `<t:${Math.floor(new Date(editor.generatedAt).getTime() / 1000)}:R>`
        : 'never';
    const status = [
        `**Excluded:** ${editor.excluded ? 'yes (Qdrant tag points are deleted)' : 'no'}`,
        `**Prompt Version:** \`${editor.promptVersion || 'none'}\``,
        `**Generated:** ${generatedAt}`,
        `**Question Count:** ${editor.questions.length}`,
    ];
    if (!editor.cacheCurrent) status.push('**Cache:** metadata will be refreshed on next sync.');
    if (notice) status.push('', notice);

    const answer = String(editor.answer || '').trim() || 'No answer text is stored for this tag.';
    const combinedDescription = `${status.join('\n')}\n\n${questions}\n\n**Answer:**\n${answer}`;
    const combinedContent = buildQuestionContent(command, editor, combinedDescription);

    if (canSendSingleEditorEmbed(combinedContent.embed)) {
        return { content: combinedContent, answerContent: null };
    }

    return {
        content: buildQuestionContent(command, editor, `${status.join('\n')}\n\n${questions}`),
        answerContent: buildAnswerContent(command, editor, answer),
    };
}

function buildQuestionContent(command, editor, description) {
    return {
        embed: {
            title: `KB Retrieval Questions — ${editor.tagId}`,
            color: command.config.embedcolor,
            description,
            footer: { text: 'Edit one retrieval question per line. Tag answers still use only tag data.' },
        },
        components: [
            {
                type: 1,
                components: [
                    { type: 2, custom_id: QUESTIONS_EDIT_ID, style: 1, label: 'Edit Questions' },
                    { type: 2, custom_id: QUESTIONS_GENERATE_ID, style: 2, label: 'Regenerate Questions' },
                ],
            },
        ],
    };
}

function buildAnswerContent(command, editor, answer) {
    const chunks = chunkAnswer(answer, EMBED_TOTAL_LIMIT - `KB Tag Answer — ${editor.tagId}`.length);
    return {
        embed: {
            title: `KB Tag Answer — ${editor.tagId}`,
            color: command.config.embedcolor,
            fields: chunks.map((chunk, index) => ({
                name: chunks.length === 1 ? 'Answer' : `Answer ${index + 1}/${chunks.length}`,
                value: chunk,
            })),
        },
    };
}

function canSendSingleEditorEmbed(embed) {
    return embed.description.length <= EMBED_DESCRIPTION_LIMIT && getEmbedTextLength(embed) <= EMBED_TOTAL_LIMIT;
}

function getEmbedTextLength(embed) {
    const fields = embed.fields || [];
    return (
        String(embed.title || '').length +
        String(embed.description || '').length +
        String(embed.footer?.text || '').length +
        fields.reduce((total, field) => total + String(field.name || '').length + String(field.value || '').length, 0)
    );
}

function chunkAnswer(answer, remainingLimit) {
    const chunks = [];
    let remaining = String(answer || '');
    let available = Math.max(EMBED_FIELD_VALUE_LIMIT, remainingLimit - 50);

    while (remaining.length && chunks.length < 6 && available > 0) {
        const maxChunk = Math.min(ANSWER_CHUNK_LIMIT, available);
        chunks.push(remaining.slice(0, maxChunk));
        remaining = remaining.slice(maxChunk);
        available -= maxChunk + 16;
    }

    if (remaining.length && chunks.length) {
        const last = chunks[chunks.length - 1];
        chunks[chunks.length - 1] = `${last.slice(0, Math.max(0, last.length - 24))}…\n(truncated)`;
    }

    return chunks.length ? chunks : ['No answer text is stored for this tag.'];
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

async function runTerm(KB) {
    const action = this.message.args.shift()?.toLowerCase();
    switch (action) {
        case 'set':
            return setKnowledgeTerm.call(this, KB);
        case 'delete':
            return deleteKnowledgeTerm.call(this, KB);
        case 'list':
            return listKnowledgeTerms.call(this, KB);
        default:
            await this.error(
                'please use `snail kb term set {id} {meaning}`, `snail kb term delete {id}`, or `snail kb term list`.'
            );
    }
}

async function setKnowledgeTerm(KB) {
    const termId = this.message.args.shift();
    const meaning = this.message.args.join(' ').trim();
    if (!termId || !meaning) {
        await this.error('please provide a term id and meaning! Example: `snail kb term set dt distorted pets`');
        return;
    }

    try {
        const term = await KB.setKnowledgeTerm(termId, meaning);
        await this.send(`✅ **|** Set OwO bot term \`${term._id}\` = ${term.meaning}`);
    } catch (err) {
        console.error('[KB] set term failed:', err);
        await this.error(`failed to set term: \`${err.message}\``);
    }
}

async function deleteKnowledgeTerm(KB) {
    const termId = this.message.args.shift();
    if (!termId) {
        await this.error('please provide a term id! Example: `snail kb term delete dt`');
        return;
    }

    try {
        const result = await KB.deleteKnowledgeTerm(termId);
        const status = result.deleted ? 'Deleted' : 'No stored term found for';
        await this.send(`✅ **|** ${status} OwO bot term \`${result._id}\`.`);
    } catch (err) {
        console.error('[KB] delete term failed:', err);
        await this.error(`failed to delete term: \`${err.message}\``);
    }
}

async function listKnowledgeTerms(KB) {
    let terms;
    try {
        terms = await KB.listKnowledgeTerms();
    } catch (err) {
        console.error('[KB] list terms failed:', err);
        await this.error(`failed to list terms: \`${err.message}\``);
        return;
    }

    const termLines = terms.map((term) => `\`${term._id}\` = ${term.meaning}`).join('\n');
    const description = terms.length ? termLines.slice(0, 3500) : 'No OwO bot terms are stored.';

    await this.send({
        embed: {
            title: 'OwO Bot Terms',
            color: this.config.embedcolor,
            description,
        },
    });
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

async function setModel(openrouter) {
    const model = this.message.args.shift();
    if (!model) {
        await this.error('please provide a model slug! Example: `snail kb model anthropic/claude-haiku-4.5`');
        return;
    }
    await openrouter.setChatModel(model);
    await this.send(`I have set the chat model to \`${model}\`!`);
}
