const crypto = require('crypto');
const { v5: uuidv5 } = require('uuid');

const { ephemeralInteractionResponse } = require('../utils/sender.js');
const { Qdrant } = require('../utils/kb.js');

const SYSTEM_PROMPT =
    'You are Snail, a friendly helper in the OwO Discord bot support server. ' +
    "Answer the user's question directly using ONLY the provided support notes. " +
    'Only answer questions related to the OwO bot or this support server. ' +
    'Do not guess, infer missing details, or use outside knowledge. ' +
    'If the notes only contain related info but not the exact answer, say the exact answer is not specified. ' +
    "If the notes do not contain the answer, say you don't know and suggest asking a helper. " +
    'If the question is unrelated to the OwO bot or this support server, say you can only help with OwO bot or server questions. ' +
    'You may use Discord markdown when it makes the answer easier to read, such as bullets, bold text, headers, or short code spans. ' +
    'You may reuse emojis, including custom Discord emoji tokens, exactly as they appear in the provided support notes. Do not invent custom emojis. ' +
    'Return only a raw JSON object with exactly this semantic shape: {"answer":"string","tagIds":["tag_id"]}. ' +
    'Set answer to the user-facing answer text. Set tagIds to only the tag ids you used, copied exactly from the [Tag: id] labels in the provided notes. ' +
    'Do not mention the knowledge base, support notes, entries, context, sources, or phrases like "based on". ' +
    'Do not include source tags or links in the answer string — they will be appended separately.';

const EMBED_BATCH = 64;
const META_LOG_EVERY = 50;
const ASK_DEADLINE_MS = 90000;
const ASK_QDRANT_TIMEOUT = 15000;
const ASK_QDRANT_RETRY_ATTEMPTS = 2;
const ASK_RETRY_DELAY_MS = 500;
const DEFAULT_RERANK_CANDIDATE_LIMIT = 30;
const ASK_FEEDBACK_IDLE_MS = 30 * 60 * 1000;
const ASK_FEEDBACK_HELPFUL_ID = 'kb_ask_feedback_helpful';
const ASK_FEEDBACK_NEEDS_FIX_ID = 'kb_ask_feedback_needs_fix';
const EMBED_FIELD_VALUE_LIMIT = 1024;
const TAG_SYNC_LOG_EVERY = 25;
const RAW_GENERATION_RESPONSE_LOG_CHARS = 4000;
const TAG_QUESTION_PROMPT_VERSION = 'tag-question-v3';
const TAG_QUESTION_SYSTEM_PROMPT = 'You generate retrieval scaffolding questions for OwO Discord bot support tags.';
const TAG_QUESTION_PROMPT_SOURCE = `${TAG_QUESTION_PROMPT_VERSION}:${TAG_QUESTION_SYSTEM_PROMPT}`;

module.exports = class KnowledgeBase extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'knowledgebase',
            name: 'Knowledge Base',
            description:
                'Answers OwO bot questions using a knowledge base. ' +
                'Triggered by `snail ask <question>` or by @mentioning Snail.',
            toggleable: true,
        });

        const kbConfig = bot.config.kb ?? {};

        this.qdrantUrl = process.env.QDRANT_URL || kbConfig.qdrantUrl || 'http://localhost:6333';
        this.qdrantApiKey = process.env.QDRANT_API_KEY;

        this.collection = kbConfig.collection || 'owo_knowledge';
        this.namespace = kbConfig.namespace || '1b671a64-40d5-491e-99b0-da01ff1f3341';
        this.embeddingSize = kbConfig.embeddingSize || 1536;
        this.queryInstruction =
            kbConfig.queryInstruction ||
            'Given a user question about the OwO Discord bot, retrieve a matching knowledge base entry that answers it.';
        this.topK = kbConfig.topK ?? 6;
        this.rerankCandidateLimit =
            kbConfig.rerankCandidateLimit ?? Math.max(DEFAULT_RERANK_CANDIDATE_LIMIT, this.topK * 5);
        this.scoreThreshold = kbConfig.scoreThreshold ?? 0.3;
        this.dupeThreshold = kbConfig.dupeThreshold ?? 0.75;
        this.askFeedbackChannel = kbConfig.askFeedbackChannel;

        this.qdrant = null;
        this.syncing = false;
        this.syncProgress = null;
        this.syncQueue = Promise.resolve();
        this.lastSync = null;
        this.lastSyncSummary = null;

        this.addEvent('messageCreate', this.onMessage);
    }

    get Tag() {
        return this.bot.snail_db.Tag;
    }

    get KnowledgeTerm() {
        return this.bot.snail_db.KnowledgeTerm;
    }

    get openrouter() {
        return this.bot.modules.openrouter;
    }

    get elasticApm() {
        return this.bot.modules.elasticapm;
    }

    async onceReady() {
        await super.onceReady();

        const persistedFeedbackChannel = await this.bot.getConfiguration(`${this.id}_ask_feedback_channel`);
        if (persistedFeedbackChannel) this.askFeedbackChannel = persistedFeedbackChannel;
        await this.openrouter.loadPersistedConfiguration();

        if (this.enabled) {
            await this.initQdrant().catch((err) => {
                console.error('[KB] Qdrant init failed:', err.message);
            });
            this.sync().catch((err) => {
                console.error('[KB] startup sync failed:', err.message);
            });
        }
    }

    async enable() {
        await super.enable();
        try {
            await this.initQdrant();
            this.sync().catch((err) => console.error('[KB] post-enable sync failed:', err.message));
        } catch (err) {
            console.error('[KB] enable failed:', err.message);
        }
    }

    async initQdrant() {
        this.qdrant = new Qdrant({ url: this.qdrantUrl, apiKey: this.qdrantApiKey });
        await this.qdrant.ensureCollection(this.collection, this.embeddingSize);
    }

    // ─── Message handling ────────────────────────────────────────────────

    async onMessage(message) {
        if (message.author?.bot) return;
        if (!message.mentions?.some((u) => u.id === this.bot.user?.id)) return;

        const channel = await this.bot.snail_db.Channel.findById(message.channel.id);
        if (channel?.disabledCommands.includes('ask')) return;

        const stripped = message.content.replace(new RegExp(`<@!?${this.bot.user.id}>`, 'g'), '').trim();

        if (!stripped) return;
        if (stripped.length > 500) return;

        await message.channel.sendTyping().catch(() => {});

        try {
            const result = await this.ask(stripped);
            await this.sendAnswer(message, result, { question: stripped });
        } catch (err) {
            console.error('[KB] mention ask failed:', err.message);
            await message.channel
                .createMessage({
                    content: `🚫 **|** Something went wrong while looking that up.`,
                    messageReference: { messageID: message.id },
                    allowedMentions: { repliedUser: false, everyone: false, roles: false, users: false },
                })
                .catch(() => {});
        }
    }

    async sendAnswer(message, { answer, sources }, { question } = {}) {
        const collectorModule = this.bot.modules['interactioncollector'];
        const components = this.askFeedbackChannel && collectorModule?.create ? buildAskFeedbackComponents() : [];
        const feedback = {
            originalMessage: message,
            question,
            answer,
            sources,
        };

        const threadAnswer = await this.trySendThreadAnswer(message, answer, sources, components, question);
        if (threadAnswer) {
            if (this.askFeedbackChannel && collectorModule?.create) {
                this.collectAskFeedback(collectorModule, threadAnswer.answerMessage, threadAnswer.content, feedback);
            }
            return;
        }

        const content = this.buildFallbackAnswerContent(answer, sources, components, message);
        const answerMessage = await message.channel.createMessage(content);

        if (this.askFeedbackChannel && collectorModule?.create) {
            this.collectAskFeedback(collectorModule, answerMessage, content, feedback);
        }
    }

    async trySendThreadAnswer(message, answer, sources, components, question) {
        if (typeof message.channel?.createThreadWithMessage !== 'function') return;

        try {
            const thread = await message.channel.createThreadWithMessage(message.id, {
                name: buildAskThreadName(question),
                autoArchiveDuration: 1440,
            });
            const content = {
                content: buildPlainAnswerContent(answer, sources),
                components,
                allowedMentions: { repliedUser: false, everyone: false, roles: false, users: false },
            };
            const answerMessage = await thread.createMessage(content);
            return { answerMessage, content };
        } catch (err) {
            console.warn('[KB] ask thread delivery failed, falling back to reply:', err.message);
        }
    }

    buildFallbackAnswerContent(answer, sources, components, message) {
        const base = {
            components,
            messageReference: { messageID: message.id },
            allowedMentions: { repliedUser: false, everyone: false, roles: false, users: false },
        };

        if (isThreadChannel(message.channel)) {
            return {
                ...base,
                content: buildPlainAnswerContent(answer, sources),
            };
        }

        return {
            ...base,
            embeds: [
                {
                    color: this.bot.config.embedcolor,
                    description: buildPlainAnswerContent(answer, sources),
                },
            ],
        };
    }

    collectAskFeedback(collectorModule, answerMessage, content, feedback) {
        let submitted = false;
        const filter = (user) => user?.id === feedback.originalMessage.author?.id;
        const collector = collectorModule.create(answerMessage, filter, { idle: ASK_FEEDBACK_IDLE_MS });

        collector.on('collect', async (data, interaction) => {
            const rating = getAskFeedbackRating(data.custom_id);
            if (!rating) return;

            try {
                await this.forwardAskFeedback(answerMessage, feedback, rating);
                submitted = true;
                content.components = buildAskFeedbackComponents(rating.id);
                await answerMessage.edit(content).catch(() => {});
                await interaction.createMessage(ephemeralInteractionResponse(`✅ **|** Thank you for your feedback!`));
                collector.stop('submitted');
            } catch (err) {
                console.error('[KB] ask feedback forward failed:', err.message);
                await interaction
                    .createMessage(ephemeralInteractionResponse('🚫 **|** I could not forward that feedback.'))
                    .catch(() => {});
            }
        });

        collector.on('end', async () => {
            if (submitted) return;
            content.components = disableComponents(content.components);
            await answerMessage.edit(content).catch(() => {});
        });
    }

    async forwardAskFeedback(answerMessage, { originalMessage, question, answer, sources }, rating) {
        const channel = this.bot.getChannel(this.askFeedbackChannel);
        if (!channel) throw new Error(`Missing ask feedback channel: ${this.askFeedbackChannel}`);

        const answerLink = buildDiscordMessageLink(answerMessage);
        const originalLink = buildDiscordMessageLink(originalMessage);
        const fields = [
            { name: 'Asked By', value: `<@${originalMessage.author.id}> (\`${originalMessage.author.id}\`)` },
            { name: 'Question', value: truncateEmbedField(question || originalMessage.content || 'Unknown question') },
            { name: 'Answer', value: truncateEmbedField(answer || 'No answer text') },
        ];

        if (sources?.length) {
            fields.push({ name: 'Resources', value: `KB Tags: ${sources.slice(0, 10).map(formatSource).join(', ')}` });
        }

        if (answerLink) fields.push({ name: 'Snail Answer', value: answerLink });
        if (originalLink) fields.push({ name: 'Original Question', value: originalLink });

        await channel.createMessage({
            embed: {
                title: `Snail Ask Feedback: ${rating.label}`,
                color: rating.color,
                fields,
                timestamp: new Date().toISOString(),
            },
        });
    }

    // ─── Retrieval ──────────────────────────────────────────────────────

    formatQuery(question) {
        return `Instruct: ${this.queryInstruction}\nQuery: ${question}`;
    }

    async embedQuery(question) {
        const [vector] = await this.openrouter.embed([this.formatQuery(question)]);
        return vector;
    }

    async ask(question) {
        const transaction = this.elasticApm.startTransaction('snail.ask.fetch', 'bot');

        try {
            transaction?.setLabel('question_length', question.length);
            const result = await this.fetchAskAnswer(question);
            transaction?.setOutcome('success');
            return result;
        } catch (err) {
            transaction?.setOutcome('failure');
            this.elasticApm.captureError(err);
            throw err;
        } finally {
            transaction?.end();
        }
    }

    async fetchAskAnswer(question) {
        if (!this.qdrant) await this.initQdrant();

        const askStartedAt = Date.now();
        const vector = await this.embedQuery(question);

        assertAskBudget(askStartedAt);
        const rawHits = await this.qdrant.search(this.collection, {
            vector,
            limit: this.rerankCandidateLimit,
            scoreThreshold: this.scoreThreshold,
            ...remainingAskRequestOptions(askStartedAt, ASK_QDRANT_TIMEOUT, ASK_QDRANT_RETRY_ATTEMPTS),
        });

        assertAskBudget(askStartedAt);
        const candidateGroups = await this.materializeTagGroups(groupHitsByTag(rawHits));
        const groups = await this.rerankTagGroups(question, candidateGroups);
        const hits = groups.flatMap((group) => group.hits);

        if (!groups.length) {
            return {
                answer: "I don't know that one yet — please ask a helper or rephrase your question.",
                sources: [],
                hits: [],
            };
        }

        assertAskBudget(askStartedAt);
        const context = groups.map(formatTagAnswerContext).join('\n\n');
        const terms = await this.fetchQuestionTerms(question);

        const { content } = await this.openrouter.chat(SYSTEM_PROMPT, formatAnswerPrompt(context, question, terms));
        const answerResponse = parseAnswerResponse(content);
        const sources = selectAnswerSources(groups, answerResponse);

        return {
            answer: answerResponse.answer || "I don't know that one yet — please ask a helper or rephrase your question.",
            sources,
            hits,
        };
    }

    async fetchQuestionTerms(question) {
        const termIds = extractTermIds(question);
        if (!termIds.length) return [];

        const docs = await leanQuery(this.KnowledgeTerm.find({ _id: { $in: termIds } }));
        const termsById = new Map(docs.map((term) => [String(term._id), term]));
        return termIds.map((termId) => termsById.get(termId)).filter(Boolean);
    }

    async setKnowledgeTerm(termId, meaning) {
        const normalizedTermId = normalizeTermId(termId);
        const normalizedMeaning = String(meaning ?? '').trim();
        if (!normalizedTermId) throw new Error('Term id must contain at least one alphanumeric character.');
        if (!normalizedMeaning) throw new Error('Term meaning cannot be blank.');

        await this.KnowledgeTerm.updateOne(
            { _id: normalizedTermId },
            { $set: { meaning: normalizedMeaning } },
            { upsert: true }
        );
        return { _id: normalizedTermId, meaning: normalizedMeaning };
    }

    async deleteKnowledgeTerm(termId) {
        const normalizedTermId = normalizeTermId(termId);
        if (!normalizedTermId) throw new Error('Term id must contain at least one alphanumeric character.');

        const result = await this.KnowledgeTerm.deleteOne({ _id: normalizedTermId });
        return { _id: normalizedTermId, deleted: result.deletedCount > 0 };
    }

    async listKnowledgeTerms() {
        const terms = await leanQuery(this.KnowledgeTerm.find({}));
        return terms.sort((a, b) => String(a._id).localeCompare(String(b._id)));
    }

    async rerankTagGroups(question, groups) {
        if (groups.length <= 1) return groups.slice(0, this.topK);

        try {
            const documents = groups.map(formatRerankTagDocument);
            const rankings = await this.openrouter.rerank(question, documents, {
                topN: Math.min(this.topK, documents.length),
            });
            return selectRerankedGroups(groups, rankings, this.topK);
        } catch (err) {
            console.error('[KB] rerank failed, falling back to dense order:', err.message);
            return groups.slice(0, this.topK);
        }
    }

    async debugSearch(question, { limit, includeBelowThreshold = true } = {}) {
        if (!this.qdrant) await this.initQdrant();
        const vector = await this.embedQuery(question);

        const wantEntries = limit ?? this.topK;
        const hits = await this.qdrant.search(this.collection, {
            vector,
            limit: wantEntries * 5,
            scoreThreshold: includeBelowThreshold ? undefined : this.scoreThreshold,
        });
        const groups = (await this.materializeTagGroups(groupHitsByTag(hits))).slice(0, wantEntries);

        return { hits, groups, threshold: this.scoreThreshold };
    }

    // Find tags semantically similar to a question. Used by the manager "find"
    // flow as a read/debug surface over tag-backed retrieval results.
    async findSimilar(question, { limit = 5 } = {}) {
        if (!this.qdrant) await this.initQdrant();
        const vector = await this.embedQuery(question);

        const rawHits = await this.qdrant.search(this.collection, {
            vector,
            limit: Math.max(this.rerankCandidateLimit, limit * 5),
            scoreThreshold: this.scoreThreshold,
        });

        const groups = await this.materializeTagGroups(groupHitsByTag(rawHits));
        return (await this.rerankTagGroups(question, groups)).slice(0, limit);
    }

    async materializeTagGroups(groups) {
        if (!groups.length) return [];
        const tagIds = groups.map((group) => group.tagId);
        const docs = await leanQuery(this.Tag.find({ _id: { $in: tagIds } }));
        const tagById = new Map(docs.map((doc) => [String(doc._id), doc]));

        return groups
            .map((group) => {
                const tag = tagById.get(group.tagId);
                if (!tag || isTagKbExcluded(tag)) return null;
                const dataPreview = previewText(tag.data, 220);
                return {
                    ...group,
                    tag,
                    doc: tag,
                    visibility: tag?.visibility === 'kb_only' ? 'kb_only' : 'public',
                    dataPreview,
                };
            })
            .filter(Boolean);
    }

    // ─── Sync ───────────────────────────────────────────────────────────

    startSyncProgress(dryRun) {
        this.syncProgress = {
            dryRun,
            phase: 'starting',
            processedTags: 0,
            totalTags: 0,
            plannedPoints: 0,
            tagsWithQuestions: 0,
            tagsWithQuestionsInQdrant: 0,
            totalAnswers: 0,
            totalQuestions: 0,
            embeddedPoints: 0,
            totalEmbeds: 0,
            updatedPayloads: 0,
            totalPayloadUpdates: 0,
            deletedPoints: 0,
            startedAt: new Date(),
            updatedAt: new Date(),
        };
    }

    updateSyncProgress(patch) {
        if (!this.syncProgress) return;
        Object.assign(this.syncProgress, patch, { updatedAt: new Date() });
    }

    getSyncProgress() {
        if (!this.syncProgress) return null;
        return { ...this.syncProgress };
    }

    async sync({ dryRun = false, regenerateQuestions = false } = {}) {
        return this.enqueueSyncOperation(() => this.syncUnlocked({ dryRun, regenerateQuestions }));
    }

    async syncUnlocked({ dryRun = false, regenerateQuestions = false } = {}) {
        if (this.syncing) throw new Error('A sync is already in progress');
        if (dryRun && regenerateQuestions) throw new Error('Question regeneration cannot be dry-run');
        if (!this.qdrant) await this.initQdrant();
        if (!dryRun) this.openrouter.assertConfigured();

        this.syncing = true;
        this.startSyncProgress(dryRun);
        const modeLabel = dryRun ? ' (dry)' : regenerateQuestions ? ' (regenerate questions)' : '';
        const log = (msg) => console.log(`[KB] sync${modeLabel}: ${msg}`);
        try {
            const tags = await this.Tag.find();
            this.updateSyncProgress({ phase: 'planning', totalTags: tags.length });
            log(`loaded ${tags.length} tags from Mongo`);

            const desired = new Map();
            const skippedTagIds = new Set();
            let tagsWithQuestions = 0;
            for (let i = 0; i < tags.length; i++) {
                const tag = tags[i];
                if (!isTagKbExcluded(tag)) {
                    try {
                        if (regenerateQuestions) await this.regenerateTagQuestionCache(tag);
                        else if (!dryRun) await this.ensureTagKbCache(tag);
                        const tagPoints = this.buildDesiredTagPoints(tag);
                        if (hasQuestionPoint(tagPoints)) tagsWithQuestions += 1;
                        for (const [pointId, point] of tagPoints) desired.set(pointId, point);
                    } catch (err) {
                        skippedTagIds.add(String(tag._id));
                        log(`tag '${String(tag._id)}' skipped: ${err.message}`);
                    }
                }
                this.updateSyncProgress({
                    processedTags: i + 1,
                    plannedPoints: desired.size,
                    tagsWithQuestions,
                });
                if ((i + 1) % TAG_SYNC_LOG_EVERY === 0 || i + 1 === tags.length) {
                    log(`processed ${i + 1}/${tags.length} tags; planned ${desired.size} points so far`);
                }
            }

            const questionCount = countByKind(desired, 'tag_question');
            const answerCount = countByKind(desired, 'tag_answer');
            this.updateSyncProgress({
                phase: 'diffing',
                totalAnswers: answerCount,
                totalQuestions: questionCount,
                plannedPoints: desired.size,
            });
            log(
                `built ${answerCount} tag_answer points + ${questionCount} tag_question points = ${desired.size} total`
            );

            const existing = await this.qdrant.scrollAll(this.collection, tagPayloadFields());
            const existingForDiff = skippedTagIds.size
                ? existing.filter((point) => !skippedTagIds.has(String(point.payload?.tag_id)))
                : existing;
            const tagsWithQuestionsInQdrant = countTagsWithCurrentQuestionPoints(desired, existingForDiff);
            this.updateSyncProgress({ tagsWithQuestionsInQdrant });
            log(`scrolled ${existing.length} existing points in '${this.collection}'`);

            const diff = computeDiff(desired, existingForDiff);
            const summary = {
                added: diff.toEmbed.filter((x) => x.op === 'add').length,
                vectorUpdated: diff.toEmbed.filter((x) => x.op === 'vector').length,
                metaUpdated: diff.toUpdateMeta.length,
                deleted: diff.toDelete.length,
                unchanged: desired.size - diff.toEmbed.length - diff.toUpdateMeta.length,
                totalQuestions: questionCount,
                totalAnswers: answerCount,
                totalPoints: desired.size,
                totalTags: tags.length,
                dryRun,
                regeneratedQuestions: regenerateQuestions,
            };
            log(
                `diff: +${summary.added} add, ~${summary.vectorUpdated} vector, ` +
                    `~${summary.metaUpdated} meta, -${summary.deleted} delete, =${summary.unchanged} unchanged`
            );

            if (dryRun) {
                this.updateSyncProgress({ phase: 'complete' });
                return summary;
            }

            this.updateSyncProgress({
                phase: 'applying',
                totalEmbeds: diff.toEmbed.length,
                totalPayloadUpdates: diff.toUpdateMeta.length,
                deletedPoints: diff.toDelete.length,
            });
            await this.applyDiff(diff, log);

            this.lastSync = new Date();
            this.lastSyncSummary = summary;
            this.updateSyncProgress({ phase: 'complete' });
            log('complete');
            return summary;
        } catch (err) {
            this.updateSyncProgress({ phase: 'failed' });
            log(`failed: ${err.message}`);
            throw err;
        } finally {
            this.syncing = false;
        }
    }

    enqueueSyncOperation(fn) {
        const run = this.syncQueue.catch(() => {}).then(fn);
        this.syncQueue = run.catch(() => {});
        return run;
    }

    buildDesiredTagPoints(tag) {
        return buildDesiredTagPoints(tag.toObject ? tag.toObject() : tag, this.namespace);
    }

    async ensureTagKbCache(tag) {
        const dataHash = tagDataHash(tag.data);
        const generationHash = tagQuestionGenerationHash(tag, dataHash);

        if (isCurrentTagKbCache(tag.kb, dataHash, generationHash)) {
            return tag.kb;
        }

        if (hasInitializedQuestionCache(tag.kb)) {
            const kb = buildTagKbCache(tag, normalizeExistingQuestions(tag.kb.questions), dataHash, generationHash, {
                generatedAt: tag.kb?.generatedAt,
            });
            await this.persistTagKb(tag, kb);
            return tag.kb;
        }

        await this.regenerateTagQuestionCache(tag);
        return tag.kb;
    }

    async regenerateTagQuestionCache(tag) {
        this.openrouter.assertConfigured();

        const dataHash = tagDataHash(tag.data);
        const generationHash = tagQuestionGenerationHash(tag, dataHash);
        const questions = await this.generateTagQuestions(tag);
        const kb = buildTagKbCache(tag, questions, dataHash, generationHash);

        await this.persistTagKb(tag, kb);
        return tag.kb;
    }

    async generateTagQuestions(tag) {
        const { content } = await this.openrouter.chat(TAG_QUESTION_SYSTEM_PROMPT, buildTagQuestionPrompt(tag));

        let generatedQuestions;
        try {
            generatedQuestions = parseGeneratedQuestionArray(content);
        } catch (err) {
            console.error(
                `[KB] tag question generation raw response for tag '${String(tag._id)}': ${truncateForLog(content)}`
            );
            throw err;
        }

        return toQuestionCacheEntries(normalizeGeneratedQuestions(generatedQuestions));
    }

    async persistTagKb(tag, kb) {
        tag.kb = kb;
        if (typeof tag.set === 'function') tag.set('kb', kb);
        if (typeof tag.save === 'function') {
            await tag.save();
        } else {
            await this.Tag.updateOne({ _id: String(tag._id) }, { $set: { kb } });
        }
    }

    async getTagQuestionEditor(tagId) {
        const normalizedTagId = String(tagId);
        const tag = await leanQuery(this.Tag.findById(normalizedTagId));
        if (!tag) return null;

        const dataHash = tagDataHash(tag.data);
        const generationHash = tagQuestionGenerationHash(tag, dataHash);
        const questions = hasInitializedQuestionCache(tag.kb) ? normalizeExistingQuestions(tag.kb.questions) : [];

        return {
            tagId: normalizedTagId,
            answer: String(tag.data || ''),
            excluded: isTagKbExcluded(tag),
            promptVersion: tag.kb?.promptVersion,
            cacheCurrent: isCurrentTagKbCache(tag.kb, dataHash, generationHash),
            generatedAt: tag.kb?.generatedAt,
            questions,
        };
    }

    async updateTagQuestions(tagId, rawText) {
        return this.enqueueSyncOperation(() => this.updateTagQuestionsUnlocked(tagId, rawText));
    }

    async regenerateTagQuestions(tagId) {
        return this.enqueueSyncOperation(() => this.regenerateTagQuestionsUnlocked(tagId));
    }

    async regenerateTagQuestionsUnlocked(tagId) {
        const normalizedTagId = String(tagId);
        const tag = await this.Tag.findById(normalizedTagId);
        if (!tag) return null;

        await this.regenerateTagQuestionCache(tag);
        let summary;
        if (isTagKbExcluded(tag)) {
            await this.deleteTagByIdUnlocked(normalizedTagId);
            summary = {
                tagId: normalizedTagId,
                excluded: true,
                deleted: true,
            };
        } else {
            summary = await this.syncTagByIdUnlocked(normalizedTagId);
        }

        return { ...summary, editor: await this.getTagQuestionEditor(normalizedTagId) };
    }

    async updateTagQuestionsUnlocked(tagId, rawText) {
        const normalizedTagId = String(tagId);
        const tag = await this.Tag.findById(normalizedTagId);
        if (!tag) return null;

        const dataHash = tagDataHash(tag.data);
        const generationHash = tagQuestionGenerationHash(tag, dataHash);
        const questions = toQuestionCacheEntries(normalizeManualQuestions(rawText));
        const kb = buildTagKbCache(tag, questions, dataHash, generationHash, {
            generatedAt: tag.kb?.generatedAt,
        });

        await this.persistTagKb(tag, kb);
        let summary;
        if (isTagKbExcluded(tag)) {
            await this.deleteTagByIdUnlocked(normalizedTagId);
            summary = {
                tagId: normalizedTagId,
                excluded: true,
                deleted: true,
            };
        } else {
            summary = await this.syncTagByIdUnlocked(normalizedTagId);
        }

        return { ...summary, editor: await this.getTagQuestionEditor(normalizedTagId) };
    }

    tagFilter(tagId) {
        return tagFilter(tagId);
    }

    async syncTagById(tagId) {
        return this.enqueueSyncOperation(() => this.syncTagByIdUnlocked(tagId));
    }

    async syncTagByIdUnlocked(tagId) {
        if (!this.qdrant) await this.initQdrant();

        const normalizedTagId = String(tagId);
        const tag = await this.Tag.findById(normalizedTagId);
        if (!tag) {
            await this.deleteTagByIdUnlocked(normalizedTagId);
            return { deleted: true, tagId: normalizedTagId };
        }
        if (isTagKbExcluded(tag)) {
            await this.deleteTagByIdUnlocked(normalizedTagId);
            return { excluded: true, deleted: true, tagId: normalizedTagId };
        }
        this.openrouter.assertConfigured();

        await this.ensureTagKbCache(tag);
        const desired = this.buildDesiredTagPoints(tag);
        const existing = await this.qdrant.scrollAll(this.collection, tagPayloadFields(), tagFilter(normalizedTagId));
        const diff = computeDiff(desired, existing);
        await this.applyDiff(diff, () => {});

        return {
            tagId: normalizedTagId,
            added: diff.toEmbed.filter((x) => x.op === 'add').length,
            vectorUpdated: diff.toEmbed.filter((x) => x.op === 'vector').length,
            metaUpdated: diff.toUpdateMeta.length,
            deleted: diff.toDelete.length,
            unchanged: desired.size - diff.toEmbed.length - diff.toUpdateMeta.length,
            totalQuestions: countByKind(desired, 'tag_question'),
            totalAnswers: countByKind(desired, 'tag_answer'),
            totalPoints: desired.size,
            totalTags: 1,
        };
    }

    async deleteTagById(tagId) {
        return this.enqueueSyncOperation(() => this.deleteTagByIdUnlocked(tagId));
    }

    async deleteTagByIdUnlocked(tagId) {
        if (!this.qdrant) await this.initQdrant();
        await this.qdrant.deleteByFilter(this.collection, tagFilter(tagId));
    }

    async setTagKbExcluded(tagId, excluded) {
        return this.enqueueSyncOperation(() => this.setTagKbExcludedUnlocked(tagId, excluded));
    }

    async setTagKbExcludedUnlocked(tagId, excluded) {
        const normalizedTagId = String(tagId);
        const tag = await this.Tag.findById(normalizedTagId);
        if (!tag) return null;

        const knowledgeBase = { ...(tag.knowledgeBase?.toObject ? tag.knowledgeBase.toObject() : tag.knowledgeBase) };
        knowledgeBase.excluded = Boolean(excluded);

        if (typeof tag.set === 'function') tag.set('knowledgeBase', knowledgeBase);
        else tag.knowledgeBase = knowledgeBase;

        if (typeof tag.save === 'function') {
            await tag.save();
        } else {
            await this.Tag.updateOne(
                { _id: normalizedTagId },
                { $set: { 'knowledgeBase.excluded': Boolean(excluded) } }
            );
        }

        if (excluded) {
            await this.deleteTagByIdUnlocked(normalizedTagId);
            return { tagId: normalizedTagId, excluded: true, deleted: true };
        }

        const summary = await this.syncTagByIdUnlocked(normalizedTagId);
        return { tagId: normalizedTagId, excluded: false, ...summary };
    }

    async listKbExcludedTags() {
        const docs = await leanQuery(this.Tag.find({ 'knowledgeBase.excluded': true }));
        return docs.map((tag) => String(tag._id)).sort((a, b) => a.localeCompare(b));
    }

    async resetQdrantAndSync() {
        return this.enqueueSyncOperation(async () => {
            if (!this.qdrant) await this.initQdrant();
            await this.qdrant.resetCollection(this.collection, this.embeddingSize);
            const summary = await this.syncUnlocked();
            return { collection: this.collection, ...summary };
        });
    }

    async applyDiff({ toEmbed, toUpdateMeta, toDelete }, log) {
        if (toDelete.length) {
            await this.qdrant.deletePoints(this.collection, toDelete);
            this.updateSyncProgress({ deletedPoints: toDelete.length });
            log(`deleted ${toDelete.length}`);
        }

        for (let i = 0; i < toEmbed.length; i += EMBED_BATCH) {
            const batch = toEmbed.slice(i, i + EMBED_BATCH);
            const vectors = await this.openrouter.embed(batch.map((x) => x.text));
            const points = batch.map((x, j) => ({
                id: x.pointId,
                vector: vectors[j],
                payload: buildPayload(x),
            }));
            await this.qdrant.upsert(this.collection, points);
            this.updateSyncProgress({ embeddedPoints: Math.min(i + EMBED_BATCH, toEmbed.length) });
            log(`embedded ${Math.min(i + EMBED_BATCH, toEmbed.length)}/${toEmbed.length}`);
        }

        for (let i = 0; i < toUpdateMeta.length; i++) {
            const x = toUpdateMeta[i];
            await this.qdrant.setPayload(this.collection, x.pointId, buildPayload(x));
            this.updateSyncProgress({ updatedPayloads: i + 1 });
            if ((i + 1) % META_LOG_EVERY === 0 || i + 1 === toUpdateMeta.length) {
                log(`payload updated ${i + 1}/${toUpdateMeta.length}`);
            }
        }
    }

    getConfigurationOverview() {
        const last = this.syncing ? 'in progress' : this.lastSync ? this.lastSync.toISOString() : 'never';
        return (
            `${super.getConfigurationOverview()}\n` +
            `- Qdrant URL: ${this.qdrantUrl}\n` +
            `- Collection: ${this.collection}\n` +
            `- Embedding Size: ${this.embeddingSize}d\n` +
            `- Top K: ${this.topK}\n` +
            `- Rerank Candidates: ${this.rerankCandidateLimit}\n` +
            `- Score Threshold: ${this.scoreThreshold}\n` +
            `- Dupe Threshold: ${this.dupeThreshold}\n` +
            `- Last Sync: ${last}`
        );
    }
};

// ─── Pure helpers ───────────────────────────────────────────────────────

function tagFilter(tagId) {
    return { must: [{ key: 'tag_id', match: { value: String(tagId) } }] };
}

function normalizeTermId(termId) {
    return String(termId ?? '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
}

function extractTermIds(question) {
    const seen = new Set();
    const termIds = [];
    for (const match of String(question ?? '').match(/[a-z0-9]+/gi) || []) {
        const termId = normalizeTermId(match);
        if (!termId || seen.has(termId)) continue;
        seen.add(termId);
        termIds.push(termId);
    }
    return termIds;
}

function formatAnswerPrompt(context, question, terms) {
    const supportNotes = `Support notes:\n${context}`;
    if (!terms.length) return `${supportNotes}\n\nUser question:\n${question}`;

    const termLines = terms.map((term) => `${term._id} = ${term.meaning}`).join('\n');
    return `${supportNotes}\n\nOwO bot terms:\n${termLines}\n\nUser question:\n${question}`;
}

function isTagKbExcluded(tag) {
    return tag?.knowledgeBase?.excluded === true;
}

function assertAskBudget(startedAt) {
    if (Date.now() - startedAt >= ASK_DEADLINE_MS) {
        throw new Error('Knowledge base answer timed out. Please try again.');
    }
}

function remainingAskRequestOptions(startedAt, preferredMs, preferredAttempts) {
    const remaining = ASK_DEADLINE_MS - (Date.now() - startedAt);
    if (remaining <= 0) throw new Error('Knowledge base answer timed out. Please try again.');
    const attempts = remaining > ASK_RETRY_DELAY_MS + preferredAttempts ? preferredAttempts : 1;
    const retryDelayBudget = ASK_RETRY_DELAY_MS * Math.max(0, attempts - 1);
    const perAttemptBudget = Math.floor(Math.max(1, remaining - retryDelayBudget) / attempts);
    return { timeout: Math.max(1, Math.min(preferredMs, perAttemptBudget)), attempts };
}

function tagPayloadFields() {
    return ['tag_id', 'kind', 'data_hash', 'question_hash', 'question'];
}

function toPointId(namespace, key) {
    return uuidv5(String(key), namespace);
}

function sha1(text) {
    return crypto.createHash('sha1').update(text).digest('hex');
}

function stableStringify(obj) {
    const keys = Object.keys(obj).sort();
    return JSON.stringify(obj, keys);
}

function tagDataHash(data) {
    return sha1(String(data ?? '').trim());
}

function tagQuestionGenerationHash(tag, dataHash = tagDataHash(tag.data)) {
    return sha1(
        stableStringify({
            tagId: String(tag._id),
            dataHash,
            promptVersion: TAG_QUESTION_PROMPT_VERSION,
            promptSource: TAG_QUESTION_PROMPT_SOURCE,
        })
    );
}

function isCurrentTagKbCache(kb, dataHash, generationHash) {
    return (
        hasInitializedQuestionCache(kb) &&
        kb?.dataHash === dataHash &&
        kb?.promptVersion === TAG_QUESTION_PROMPT_VERSION &&
        kb?.generationHash === generationHash &&
        hasValidQuestionCacheEntries(kb.questions)
    );
}

function hasInitializedQuestionCache(kb) {
    return (
        Array.isArray(kb?.questions) &&
        (typeof kb?.dataHash === 'string' ||
            typeof kb?.promptVersion === 'string' ||
            typeof kb?.generationHash === 'string' ||
            Boolean(kb?.generatedAt))
    );
}

function hasValidQuestionCacheEntries(questions) {
    if (!Array.isArray(questions)) return false;
    return questions.every((question) => {
        if (typeof question?.text !== 'string' || typeof question?.hash !== 'string') return false;
        const text = question.text.replace(/\s+/g, ' ').trim();
        return Boolean(text) && question.text === text && question.hash === sha1(text);
    });
}

function buildTagKbCache(
    tag,
    questions,
    dataHash = tagDataHash(tag.data),
    generationHash = tagQuestionGenerationHash(tag, dataHash),
    options = {}
) {
    return {
        dataHash,
        promptVersion: TAG_QUESTION_PROMPT_VERSION,
        generationHash,
        questions,
        generatedAt: options.generatedAt || new Date(),
    };
}

function buildTagQuestionPrompt(tag) {
    const tagId = String(tag._id);
    const data = String(tag.data ?? '').trim();
    return (
        'Generate concise English user questions that this support tag can answer.\n' +
        'Use only the tag data as the source of truth.\n' +
        'Every question must be fully answerable from the tag data alone.\n' +
        'Cover the important facts explicitly stated in the tag data.\n' +
        'Do not add questions that require information outside the tag data.\n' +
        'Use natural user wording and vary phrasing when useful.\n' +
        'Do not start every question with "OwO bot" or the tag name.\n' +
        'Return only a raw JSON array of English strings.\n' +
        'Do not include explanations, markdown, code fences, or answer facts.\n' +
        `Tag id: ${tagId}\n` +
        `Tag data:\n${data}`
    );
}

function truncateForLog(value) {
    const text = String(value ?? '');
    if (text.length <= RAW_GENERATION_RESPONSE_LOG_CHARS) return text;
    return `${text.slice(0, RAW_GENERATION_RESPONSE_LOG_CHARS)}… [truncated ${
        text.length - RAW_GENERATION_RESPONSE_LOG_CHARS
    } chars]`;
}

function unwrapJsonResponse(content) {
    const text = String(content ?? '').trim();
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : text;
}

function parseAnswerResponse(content) {
    const rawAnswer = String(content ?? '').trim();
    let parsed;
    try {
        parsed = JSON.parse(unwrapJsonResponse(content));
    } catch (err) {
        return { answer: rawAnswer, tagIds: [], parseFailed: true };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof parsed.answer !== 'string') {
        return { answer: '', tagIds: [], parseFailed: true };
    }

    const answer = parsed.answer.trim();
    const tagIds = Array.isArray(parsed.tagIds)
        ? parsed.tagIds.map((tagId) => (typeof tagId === 'string' ? tagId.trim() : '')).filter(Boolean)
        : [];

    return { answer, tagIds, parseFailed: false };
}

function selectAnswerSources(groups, answerResponse) {
    if (answerResponse.parseFailed) {
        const [topGroup] = groups;
        return topGroup ? [{ tagId: topGroup.tagId, visibility: topGroup.visibility }] : [];
    }

    if (!answerResponse.tagIds.length) return [];

    const groupsByTagId = new Map(groups.map((group) => [group.tagId, group]));
    const seen = new Set();
    const sources = [];
    for (const tagId of answerResponse.tagIds) {
        if (seen.has(tagId)) continue;
        seen.add(tagId);
        const group = groupsByTagId.get(tagId);
        if (group) sources.push({ tagId: group.tagId, visibility: group.visibility });
    }
    return sources;
}

function parseGeneratedQuestionArray(content) {
    let parsed;
    try {
        parsed = JSON.parse(unwrapJsonResponse(content));
    } catch (err) {
        throw new Error('Tag question generation must return a JSON array of strings');
    }
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
        throw new Error('Tag question generation must return a JSON array of strings');
    }
    return parsed;
}

function normalizeGeneratedQuestions(questions) {
    const out = [];
    const seen = new Set();
    for (const question of questions) {
        const text = question.replace(/\s+/g, ' ').trim().slice(0, 180);
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(text);
    }
    return out;
}

function normalizeManualQuestions(rawText) {
    const out = [];
    const seen = new Set();
    for (const line of String(rawText ?? '').split(/\r?\n/)) {
        const text = line.replace(/\s+/g, ' ').trim().slice(0, 180);
        if (!text) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(text);
    }
    return out;
}

function toQuestionCacheEntries(questions) {
    return questions.map((text) => ({ text, hash: sha1(text) }));
}

function normalizeExistingQuestions(questions) {
    const out = [];
    const seen = new Set();
    for (const question of questions || []) {
        if (typeof question?.text !== 'string' || typeof question?.hash !== 'string') continue;
        const text = question.text.replace(/\s+/g, ' ').trim();
        if (!text || question.hash !== sha1(text)) continue;
        const key = text.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(text);
    }
    return toQuestionCacheEntries(out);
}

function buildDesiredTagPoints(tag, namespace) {
    const tagId = String(tag._id);
    const data = String(tag.data ?? '').trim();
    const dataHash = tag.kb?.dataHash || tagDataHash(data);
    const questions = hasInitializedQuestionCache(tag.kb) ? normalizeExistingQuestions(tag.kb.questions) : [];
    const desired = new Map();

    const answerPointId = toPointId(namespace, `tag:${tagId}:tag_answer:${dataHash}`);
    desired.set(answerPointId, {
        pointId: answerPointId,
        kind: 'tag_answer',
        text: data,
        tag,
        tagId,
        dataHash,
    });

    for (const question of questions) {
        const text = String(question.text ?? '').trim();
        if (!text) continue;
        const questionHash = question.hash || sha1(text);
        const pointId = toPointId(namespace, `tag:${tagId}:tag_question:${questionHash}`);
        desired.set(pointId, {
            pointId,
            kind: 'tag_question',
            text,
            tag,
            tagId,
            dataHash,
            questionHash,
        });
    }

    return desired;
}

function countByKind(desired, kind) {
    let n = 0;
    for (const d of desired.values()) if (d.kind === kind) n++;
    return n;
}

function hasQuestionPoint(points) {
    for (const point of points.values()) {
        if (point.kind === 'tag_question') return true;
    }
    return false;
}

function countTagsWithCurrentQuestionPoints(desired, existingPoints) {
    const desiredQuestionsByTag = new Map();
    for (const [pointId, desc] of desired) {
        if (desc.kind !== 'tag_question') continue;
        if (!desiredQuestionsByTag.has(desc.tagId)) desiredQuestionsByTag.set(desc.tagId, new Set());
        desiredQuestionsByTag.get(desc.tagId).add(String(pointId));
    }

    if (!desiredQuestionsByTag.size) return 0;

    const desiredById = new Map(desired);
    const currentQuestionsByTag = new Map();
    for (const point of existingPoints) {
        const pointId = String(point.id);
        const desc = desiredById.get(pointId);
        if (!desc || desc.kind !== 'tag_question') continue;
        if (!payloadMatches(point.payload || {}, buildPayload(desc))) continue;
        if (!currentQuestionsByTag.has(desc.tagId)) currentQuestionsByTag.set(desc.tagId, new Set());
        currentQuestionsByTag.get(desc.tagId).add(pointId);
    }

    let current = 0;
    for (const [tagId, desiredIds] of desiredQuestionsByTag) {
        const currentIds = currentQuestionsByTag.get(tagId);
        if (!currentIds) continue;
        let allCurrent = true;
        for (const pointId of desiredIds) {
            if (!currentIds.has(pointId)) {
                allCurrent = false;
                break;
            }
        }
        if (allCurrent) current += 1;
    }
    return current;
}

// Diff desired tag points against existing Qdrant points. existingPoints is only
// the set we should consider for deletion — for full syncs it's the whole
// collection, for single-tag syncs it's one tag's points.
function computeDiff(desired, existingPoints) {
    const existingById = new Map(existingPoints.map((p) => [String(p.id), p]));
    const toEmbed = [];
    const toUpdateMeta = [];
    const toDelete = [];

    for (const [pointId, desc] of desired) {
        const prev = existingById.get(String(pointId));
        if (!prev) {
            toEmbed.push({ ...desc, op: 'add' });
            continue;
        }

        const previousPayload = prev.payload || {};
        const desiredPayload = buildPayload(desc);
        if (previousPayload.kind !== desc.kind || previousPayload.tag_id !== desc.tagId) {
            toEmbed.push({ ...desc, op: 'vector' });
        } else if (!payloadMatches(previousPayload, desiredPayload)) {
            toUpdateMeta.push(desc);
        }
    }

    for (const pointId of existingById.keys()) {
        if (!desired.has(pointId)) toDelete.push(pointId);
    }

    return { toEmbed, toUpdateMeta, toDelete };
}

function payloadMatches(previousPayload, desiredPayload) {
    for (const [key, value] of Object.entries(desiredPayload)) {
        if (previousPayload[key] !== value) return false;
    }
    return true;
}

function buildPayload(item) {
    const payload = {
        tag_id: item.tagId,
        kind: item.kind,
        data_hash: item.dataHash,
    };
    if (item.kind === 'tag_question') {
        payload.question = item.text;
        payload.question_hash = item.questionHash;
    }
    return payload;
}

function groupHitsByTag(hits) {
    const groups = new Map();
    for (const hit of hits) {
        const tagId = hit.payload?.tag_id;
        if (!tagId) continue;
        const key = String(tagId);
        if (!groups.has(key)) {
            groups.set(key, {
                tagId: key,
                topScore: hit.score,
                hits: [],
                matchedKinds: [],
                matchedQuestions: [],
            });
        }
        const group = groups.get(key);
        group.hits.push(hit);
        if (hit.score > group.topScore) group.topScore = hit.score;
        const kind = hit.payload?.kind;
        if (kind && !group.matchedKinds.includes(kind)) group.matchedKinds.push(kind);
        if (
            kind === 'tag_question' &&
            hit.payload?.question &&
            !group.matchedQuestions.includes(hit.payload.question)
        ) {
            group.matchedQuestions.push(hit.payload.question);
        }
    }
    return Array.from(groups.values());
}

async function leanQuery(query) {
    if (!query) return [];
    if (typeof query.lean === 'function') return query.lean();
    return query;
}

function buildAskFeedbackComponents(selectedId) {
    return [
        {
            type: 1,
            components: [
                {
                    type: 2,
                    custom_id: ASK_FEEDBACK_HELPFUL_ID,
                    style: selectedId === ASK_FEEDBACK_HELPFUL_ID ? 3 : 2,
                    label: selectedId === ASK_FEEDBACK_HELPFUL_ID ? 'Helpful ✓' : 'Helpful',
                    disabled: Boolean(selectedId),
                },
                {
                    type: 2,
                    custom_id: ASK_FEEDBACK_NEEDS_FIX_ID,
                    style: selectedId === ASK_FEEDBACK_NEEDS_FIX_ID ? 4 : 2,
                    label: selectedId === ASK_FEEDBACK_NEEDS_FIX_ID ? 'Needs Fix ✓' : 'Needs Fix',
                    disabled: Boolean(selectedId),
                },
            ],
        },
    ];
}

function getAskFeedbackRating(customId) {
    switch (customId) {
        case ASK_FEEDBACK_HELPFUL_ID:
            return { id: ASK_FEEDBACK_HELPFUL_ID, label: 'Helpful', color: 10412190 };
        case ASK_FEEDBACK_NEEDS_FIX_ID:
            return { id: ASK_FEEDBACK_NEEDS_FIX_ID, label: 'Needs Fix', color: 16737891 };
    }
}

function disableComponents(components) {
    return components.map((row) => ({
        ...row,
        components: row.components.map((component) => ({ ...component, disabled: true })),
    }));
}

function buildDiscordMessageLink(message) {
    const guildId = message.guildID || message.channel?.guild?.id;
    if (!guildId || !message.channel?.id || !message.id) return;
    return `https://discord.com/channels/${guildId}/${message.channel.id}/${message.id}`;
}

function truncateEmbedField(text) {
    const value = String(text ?? '').trim() || '—';
    return value.length > EMBED_FIELD_VALUE_LIMIT ? `${value.slice(0, EMBED_FIELD_VALUE_LIMIT - 1)}…` : value;
}

function previewText(text, max) {
    const normalized = String(text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function selectRerankedGroups(groups, rankings, topK) {
    const selected = [];
    const selectedIndexes = new Set();

    for (const ranking of rankings) {
        const group = groups[ranking.index];
        if (!group || selectedIndexes.has(ranking.index)) continue;
        selected.push({ ...group, rerankScore: ranking.relevanceScore });
        selectedIndexes.add(ranking.index);
        if (selected.length >= topK) return selected;
    }

    for (let i = 0; i < groups.length && selected.length < topK; i++) {
        if (!selectedIndexes.has(i)) selected.push(groups[i]);
    }

    return selected;
}

function formatRerankTagDocument(group) {
    return `[Tag: ${group.tagId}]\n${normalizedTagData(group)}`;
}

function formatTagAnswerContext(group) {
    const data = normalizedTagData(group);
    return `[Tag: ${group.tagId}]\n${data}`;
}

function normalizedTagData(group) {
    return String(group.tag?.data ?? '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function isThreadChannel(channel) {
    return Boolean(channel?.threadMetadata || (channel?.parentID && !channel?.createThreadWithMessage));
}

function buildPlainAnswerContent(answer, sources) {
    let content = `> -# ⚠️ Snail may be incorrect. This feature is still a work in progress!\n\n`
    content += String(answer ?? '');
    const publicSources = (sources ?? []).filter((source) => source?.visibility !== 'kb_only');

    if (!publicSources.length) return content;
    return `${content}\n\n> -# Tags: ${publicSources.slice(0, 5).map(formatSource).join(', ')}`;
}

function buildAskThreadName(question) {
    const prefix = 'snail ask';
    const normalized = String(question ?? '')
        .replace(/[\r\n]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const title = normalized ? `${prefix}: ${normalized}` : prefix;

    return title.length > 100 ? `${title.slice(0, 99)}…` : title;
}

function formatSource(source) {
    return `\`${source.tagId}\``;
}
