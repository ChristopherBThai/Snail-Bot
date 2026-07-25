const crypto = require('crypto');
const { v5: uuidv5 } = require('uuid');

const { Qdrant, embed, chat } = require('../utils/kb.js');

const SYSTEM_PROMPT =
    'You are Snail, a friendly helper in the OwO Discord bot support server. ' +
    "Answer the user's question directly using ONLY the provided support notes. " +
    'Only answer questions related to the OwO bot or this support server. ' +
    'Do not guess, infer missing details, or use outside knowledge. ' +
    'If the notes only contain related info but not the exact answer, say the exact answer is not specified. ' +
    "If the notes do not contain the answer, say you don't know and suggest asking a helper. " +
    'If the question is unrelated to the OwO bot or this support server, say you can only help with OwO bot or server questions. ' +
    'Keep the answer concise and natural. ' +
    'Do not mention the knowledge base, support notes, entries, context, sources, or phrases like "based on". ' +
    'Do not include source tags or links in your answer text — they will be appended separately.';

const EMBED_BATCH = 64;
const META_LOG_EVERY = 50;
const ASK_DEADLINE_MS = 90000;
const ASK_EMBED_TIMEOUT = 15000;
const ASK_CHAT_TIMEOUT = 30000;
const ASK_RETRY_ATTEMPTS = 2;
const ASK_RETRY_DELAY_MS = 500;
const ASK_SLOW_STAGE_MS = 3000;
const TAG_SYNC_LOG_EVERY = 25;
const RAW_GENERATION_RESPONSE_LOG_CHARS = 4000;
const TAG_QUESTION_PROMPT_VERSION = 'tag-question-v2';
const TAG_QUESTION_SYSTEM_PROMPT =
    'You generate retrieval scaffolding questions for OwO Discord bot support tags. ' +
    'Return only a raw JSON array of English strings. Do not include explanations, markdown, code fences, or answer facts. ' +
    'Write the questions the way a user would ask them; do not prefix every question with the bot name.';
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
        this.openrouterApiKey = process.env.OPENROUTER_API_KEY;

        this.collection = kbConfig.collection || 'owo_knowledge';
        this.namespace = kbConfig.namespace || '1b671a64-40d5-491e-99b0-da01ff1f3341';
        this.embeddingModel = kbConfig.embeddingModel || 'openai/text-embedding-3-small';
        this.embeddingSize = kbConfig.embeddingSize || 1536;
        this.chatModel = kbConfig.chatModel || 'deepseek/deepseek-chat-v3.1';
        this.queryInstruction =
            kbConfig.queryInstruction ||
            'Given a user question about the OwO Discord bot, retrieve a matching knowledge base entry that answers it.';
        this.topK = kbConfig.topK ?? 6;
        this.scoreThreshold = kbConfig.scoreThreshold ?? 0.3;
        this.dupeThreshold = kbConfig.dupeThreshold ?? 0.75;
        this.maxTokens = kbConfig.maxTokens ?? 500;
        this.temperature = kbConfig.temperature ?? 0.2;

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

    async onceReady() {
        await super.onceReady();

        const persisted = await this.bot.getConfiguration(`${this.id}_chat_model`);
        if (persisted) this.chatModel = persisted;

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

        const stripped = message.content.replace(new RegExp(`<@!?${this.bot.user.id}>`, 'g'), '').trim();

        if (!stripped) return;
        if (stripped.length > 500) return;

        await message.channel.sendTyping().catch(() => {});

        try {
            const result = await this.ask(stripped);
            await this.sendAnswer(message, result);
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

    async sendAnswer(message, { answer, sources }) {
        const embed = {
            color: this.bot.config.embedcolor,
            description: answer,
        };

        if (sources.length) {
            embed.footer = { text: `Tags: ${sources.slice(0, 5).map(formatSource).join(', ')}` };
        }

        await message.channel.createMessage({
            embed,
            messageReference: { messageID: message.id },
            allowedMentions: { repliedUser: false, everyone: false, roles: false, users: false },
        });
    }

    // ─── Retrieval ──────────────────────────────────────────────────────

    formatQuery(question) {
        return `Instruct: ${this.queryInstruction}\nQuery: ${question}`;
    }

    async embedQuery(question, options = {}) {
        if (!this.openrouterApiKey) throw new Error('Missing OPENROUTER_API_KEY');
        const [vector] = await embed({
            apiKey: this.openrouterApiKey,
            model: this.embeddingModel,
            inputs: [this.formatQuery(question)],
            ...options,
        });
        return vector;
    }

    async ask(question) {
        if (!this.qdrant) await this.initQdrant();

        const askStartedAt = Date.now();
        let stageStartedAt = askStartedAt;
        const vector = await this.embedQuery(question, {
            ...remainingAskRequestOptions(askStartedAt, ASK_EMBED_TIMEOUT, ASK_RETRY_ATTEMPTS),
        });
        logAskStage('embed', stageStartedAt, question);

        assertAskBudget(askStartedAt);
        stageStartedAt = Date.now();
        const rawHits = await this.qdrant.search(this.collection, {
            vector,
            limit: this.topK * 3,
            scoreThreshold: this.scoreThreshold,
            ...remainingAskRequestOptions(askStartedAt, ASK_EMBED_TIMEOUT, ASK_RETRY_ATTEMPTS),
        });
        logAskStage('qdrant_search', stageStartedAt, question);

        assertAskBudget(askStartedAt);
        stageStartedAt = Date.now();
        const groups = (await this.materializeTagGroups(groupHitsByTag(rawHits))).slice(0, this.topK);
        logAskStage('mongo_tags', stageStartedAt, question);
        const hits = groups.flatMap((group) => group.hits);

        if (!groups.length) {
            logAskStage('total_no_hits', askStartedAt, question);
            return {
                answer: "I don't know that one yet — please ask a helper or rephrase your question.",
                sources: [],
                hits: [],
            };
        }

        assertAskBudget(askStartedAt);
        const context = groups.map(formatTagAnswerContext).join('\n\n');

        stageStartedAt = Date.now();
        const { content } = await chat({
            apiKey: this.openrouterApiKey,
            model: this.chatModel,
            maxTokens: this.maxTokens,
            temperature: this.temperature,
            ...remainingAskRequestOptions(askStartedAt, ASK_CHAT_TIMEOUT, ASK_RETRY_ATTEMPTS),
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `Support notes:\n${context}\n\nUser question:\n${question}` },
            ],
        });
        logAskStage('chat', stageStartedAt, question);
        logAskStage('total', askStartedAt, question);

        const sources = groups.map((group) => group.tagId);
        return {
            answer: content || "I don't know that one yet — please ask a helper or rephrase your question.",
            sources,
            hits,
        };
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
            limit: limit * 5,
        });

        return (await this.materializeTagGroups(groupHitsByTag(rawHits))).slice(0, limit);
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
                return { ...group, tag, doc: tag, dataPreview };
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

    async sync({ dryRun = false } = {}) {
        return this.enqueueSyncOperation(() => this.syncUnlocked({ dryRun }));
    }

    async syncUnlocked({ dryRun = false } = {}) {
        if (this.syncing) throw new Error('A sync is already in progress');
        if (!this.qdrant) await this.initQdrant();
        if (!dryRun && !this.openrouterApiKey) throw new Error('Missing OPENROUTER_API_KEY');

        this.syncing = true;
        this.startSyncProgress(dryRun);
        const log = (msg) => console.log(`[KB] sync${dryRun ? ' (dry)' : ''}: ${msg}`);
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
                        if (!dryRun) await this.ensureTagKbCache(tag);
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

        if (!this.openrouterApiKey) throw new Error('Missing OPENROUTER_API_KEY');

        const questions = await this.generateTagQuestions(tag);
        const kb = buildTagKbCache(tag, questions, dataHash, generationHash);

        await this.persistTagKb(tag, kb);
        return tag.kb;
    }

    async generateTagQuestions(tag) {
        if (!this.openrouterApiKey) throw new Error('Missing OPENROUTER_API_KEY');

        const { content } = await chat({
            apiKey: this.openrouterApiKey,
            model: this.chatModel,
            maxTokens: 500,
            temperature: 0.2,
            messages: buildTagQuestionMessages(tag),
        });

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
        const summary = isTagKbExcluded(tag)
            ? await this.deleteTagByIdUnlocked(normalizedTagId).then(() => ({
                tagId: normalizedTagId,
                excluded: true,
                deleted: true,
            }))
            : await this.syncTagByIdUnlocked(normalizedTagId);

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
        if (!this.openrouterApiKey) throw new Error('Missing OPENROUTER_API_KEY');

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
            const vectors = await embed({
                apiKey: this.openrouterApiKey,
                model: this.embeddingModel,
                inputs: batch.map((x) => x.text),
            });
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

    async setChatModel(model) {
        this.chatModel = model;
        await this.bot.setConfiguration(`${this.id}_chat_model`, model);
    }

    getConfigurationOverview() {
        const last = this.syncing ? 'in progress' : this.lastSync ? this.lastSync.toISOString() : 'never';
        return (
            `${super.getConfigurationOverview()}\n` +
            `- Qdrant URL: ${this.qdrantUrl}\n` +
            `- Collection: ${this.collection}\n` +
            `- Embedding Model: ${this.embeddingModel} (${this.embeddingSize}d)\n` +
            `- Chat Model: ${this.chatModel}\n` +
            `- Top K: ${this.topK}\n` +
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

function logAskStage(stage, startedAt, question) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs < ASK_SLOW_STAGE_MS) return;
    console.warn(`[KB] ask slow: stage=${stage} ms=${elapsedMs} questionLength=${String(question ?? '').length}`);
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
    if (!Array.isArray(questions) || questions.length > 8) return false;
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

function buildTagQuestionMessages(tag) {
    const tagId = String(tag._id);
    const data = String(tag.data ?? '').trim();
    return [
        { role: 'system', content: TAG_QUESTION_SYSTEM_PROMPT },
        {
            role: 'user',
            content:
                'Generate 5 to 8 concise English user questions that this support tag would help retrieve.\n' +
                'Use natural user wording and vary the phrasing. Do not start every question with "OwO bot" or the tag name.\n' +
                'The questions are retrieval scaffolding only and must not add facts beyond the tag data.\n' +
                `Tag id: ${tagId}\n` +
                `Tag data:\n${data}`,
        },
    ];
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
        if (out.length === 8) break;
    }
    if (out.length < 5) throw new Error('Tag question generation returned fewer than 5 usable questions');
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
        if (out.length > 8) throw new Error('Please keep retrieval questions to 8 lines or fewer.');
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
        if (out.length === 8) break;
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

function previewText(text, max) {
    const normalized = String(text ?? '')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function formatTagAnswerContext(group) {
    const data = String(group.tag?.data ?? '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return `[Tag: ${group.tagId}]\n${data}`;
}

function formatSource(source) {
    if (typeof source === 'string' && /^https?:\/\//.test(source)) {
        return `<${source}>`;
    }
    return `\`${source}\``;
}
