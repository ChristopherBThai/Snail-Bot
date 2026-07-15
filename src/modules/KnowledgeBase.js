const crypto = require('crypto');
const { v5: uuidv5 } = require('uuid');

const { Qdrant, embed, chat } = require('../utils/kb.js');

const SYSTEM_PROMPT =
    'You are Snail, a helpful assistant in the OwO Discord bot support server. ' +
    "Answer the user's question using ONLY the provided knowledge base entries. " +
    "If the entries do not contain the answer, say you don't know and suggest asking a helper. " +
    'Be concise and friendly. Do not invent commands, items, or behavior that is not in the entries. ' +
    'Do not include source links in your answer text — they will be appended separately.';

const EMBED_BATCH = 64;
const META_LOG_EVERY = 50;
const TAG_QUESTION_PROMPT_VERSION = 'tag-question-v1';
const TAG_QUESTION_SYSTEM_PROMPT =
    'You generate retrieval scaffolding questions for OwO Discord bot support tags. ' +
    'Return only a JSON array of strings. Do not include explanations, markdown, or answer facts.';
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
        this.lastSync = null;
        this.lastSyncSummary = null;

        this.addEvent('messageCreate', this.onMessage);
    }

    get Knowledge() {
        return this.bot.snail_db.Knowledge;
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
            embed.fields = [
                {
                    name: 'Sources',
                    value: sources.slice(0, 5).map(formatSource).join('\n').slice(0, 1024),
                },
            ];
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

    async embedQuery(question) {
        if (!this.openrouterApiKey) throw new Error('Missing OPENROUTER_API_KEY');
        const [vector] = await embed({
            apiKey: this.openrouterApiKey,
            model: this.embeddingModel,
            inputs: [this.formatQuery(question)],
        });
        return vector;
    }

    async ask(question) {
        if (!this.qdrant) await this.initQdrant();

        const vector = await this.embedQuery(question);
        const rawHits = await this.qdrant.search(this.collection, {
            vector,
            limit: this.topK * 3,
            scoreThreshold: this.scoreThreshold,
        });

        const hits = dedupeByEntry(rawHits).slice(0, this.topK);

        if (!hits.length) {
            return {
                answer:
                    "I don't have anything in my knowledge base about that. " +
                    'Try asking a helper or rephrasing your question!',
                sources: [],
                hits: [],
            };
        }

        const context = hits.map((hit, i) => formatContextEntry(hit, i + 1)).join('\n\n');

        const { content } = await chat({
            apiKey: this.openrouterApiKey,
            model: this.chatModel,
            maxTokens: this.maxTokens,
            temperature: this.temperature,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: `Knowledge base entries:\n${context}\n\nQuestion: ${question}` },
            ],
        });

        const sources = [...new Set(hits.map((h) => h.payload?.source).filter(Boolean))];
        return { answer: content, sources, hits };
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

        return { hits, threshold: this.scoreThreshold };
    }

    // Find entries semantically similar to a question. Used by the moderator
    // "find" and "add" flows to surface possible duplicates. Returns dedup'd
    // hits grouped by entry, with each entry's Mongo doc materialized.
    async findSimilar(question, { limit = 5 } = {}) {
        if (!this.qdrant) await this.initQdrant();
        const vector = await this.embedQuery(question);

        const rawHits = await this.qdrant.search(this.collection, {
            vector,
            limit: limit * 5,
        });

        const groups = groupHitsByEntry(rawHits).slice(0, limit);

        // Resolve each group's Mongo doc. Points indexed before entry_id was
        // added to payloads have entryId=null; fall back to matching by aHash.
        const idSet = new Set(groups.map((g) => g.entryId).filter(Boolean));
        const aHashSet = new Set(
            groups
                .filter((g) => !g.entryId)
                .map((g) => g.aHash)
                .filter(Boolean)
        );

        const orClauses = [];
        if (idSet.size) orClauses.push({ _id: { $in: [...idSet] } });
        if (aHashSet.size) orClauses.push({ aHash: { $in: [...aHashSet] } });

        const docs = orClauses.length ? await this.Knowledge.find({ $or: orClauses }).lean() : [];
        const docById = new Map(docs.map((d) => [String(d._id), d]));
        const docByAHash = new Map(docs.map((d) => [d.aHash, d]));

        return groups
            .map((g) => {
                const doc = (g.entryId && docById.get(g.entryId)) || (g.aHash && docByAHash.get(g.aHash)) || null;
                return { ...g, doc, entryId: doc ? String(doc._id) : g.entryId };
            })
            .filter((g) => g.doc);
    }

    // ─── CRUD ───────────────────────────────────────────────────────────

    async getEntry(id) {
        return this.Knowledge.findById(id);
    }

    // Throws if any q variant in `variants` collides with an existing entry's
    // q (case-insensitive). Pass `exceptId` to ignore that entry's own variants.
    async assertNoVariantCollision(variants, exceptId = null) {
        const norm = variants.map((v) => v.trim().toLowerCase());
        const query = { q: { $in: variants } };
        if (exceptId) query._id = { $ne: exceptId };
        const candidates = await this.Knowledge.find(query, { q: 1 }).lean();

        for (const cand of candidates) {
            for (const v of cand.q) {
                if (norm.includes(v.trim().toLowerCase())) {
                    throw new Error(`question variant "${v}" already exists on another entry`);
                }
            }
        }
    }

    async createEntry({ q, a, category = [], source = null, userId = null }) {
        const variants = normalizeVariants(q);
        if (!variants.length) throw new Error('at least one q variant is required');
        if (typeof a !== 'string' || !a.trim()) throw new Error('answer is required');

        await this.assertNoVariantCollision(variants);

        const doc = await this.Knowledge.create({
            q: variants,
            a: a.trim(),
            category: normalizeCategory(category),
            source: source || null,
            createdBy: userId,
            updatedBy: userId,
        });
        this.applyHashes(doc);
        await doc.save();
        await this.syncEntry(doc);
        return doc;
    }

    async updateEntry(id, patch, userId = null) {
        const doc = await this.Knowledge.findById(id);
        if (!doc) throw new Error(`entry ${id} not found`);

        if (patch.q !== undefined) {
            const variants = normalizeVariants(patch.q);
            if (!variants.length) throw new Error('at least one q variant is required');
            await this.assertNoVariantCollision(variants, doc._id);
            doc.q = variants;
        }
        if (patch.a !== undefined) {
            if (typeof patch.a !== 'string' || !patch.a.trim()) throw new Error('answer is required');
            doc.a = patch.a.trim();
        }
        if (patch.category !== undefined) doc.category = normalizeCategory(patch.category);
        if (patch.source !== undefined) doc.source = patch.source || null;
        if (userId) doc.updatedBy = userId;

        this.applyHashes(doc);
        await doc.save();
        await this.syncEntry(doc);
        return doc;
    }

    async deleteEntry(id) {
        const doc = await this.Knowledge.findById(id);
        if (!doc) return null;

        if (!this.qdrant) await this.initQdrant();
        await this.qdrant.deleteByFilter(this.collection, entryFilter(String(doc._id)));
        await doc.deleteOne();
        return doc;
    }

    applyHashes(doc) {
        doc.qHashes = doc.q.map(sha1);
        doc.aHash = sha1(doc.a);
        doc.metaHash = sha1(stableStringify(metaOf(doc)));
    }

    // ─── Sync ───────────────────────────────────────────────────────────

    async sync({ dryRun = false } = {}) {
        if (this.syncing) throw new Error('A sync is already in progress');
        if (!this.qdrant) await this.initQdrant();
        if (!dryRun && !this.openrouterApiKey) throw new Error('Missing OPENROUTER_API_KEY');

        this.syncing = true;
        const log = (msg) => console.log(`[KB] sync${dryRun ? ' (dry)' : ''}: ${msg}`);
        try {
            const tags = await this.Tag.find();
            log(`loaded ${tags.length} tags from Mongo`);

            const desired = new Map();
            for (const tag of tags) {
                if (!dryRun) await this.ensureTagKbCache(tag);
                for (const [pointId, point] of this.buildDesiredTagPoints(tag)) desired.set(pointId, point);
            }

            const questionCount = countByKind(desired, 'tag_question');
            const answerCount = countByKind(desired, 'tag_answer');
            log(`built ${answerCount} tag_answer points + ${questionCount} tag_question points = ${desired.size} total`);

            const existing = await this.qdrant.scrollAll(this.collection, tagPayloadFields());
            log(`scrolled ${existing.length} existing points in '${this.collection}'`);

            const diff = computeDiff(desired, existing);
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

            if (dryRun) return summary;

            await this.applyDiff(diff, log);

            this.lastSync = new Date();
            this.lastSyncSummary = summary;
            log('complete');
            return summary;
        } catch (err) {
            log(`failed: ${err.message}`);
            throw err;
        } finally {
            this.syncing = false;
        }
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

        if (!this.openrouterApiKey) throw new Error('Missing OPENROUTER_API_KEY');

        const { content } = await chat({
            apiKey: this.openrouterApiKey,
            model: this.chatModel,
            maxTokens: 500,
            temperature: 0.2,
            messages: buildTagQuestionMessages(tag),
        });

        const questions = normalizeGeneratedQuestions(parseGeneratedQuestionArray(content)).map((text) => ({
            text,
            hash: sha1(text),
        }));

        const kb = {
            dataHash,
            promptVersion: TAG_QUESTION_PROMPT_VERSION,
            generationHash,
            questions,
            generatedAt: new Date(),
        };

        tag.kb = kb;
        if (typeof tag.set === 'function') tag.set('kb', kb);
        if (typeof tag.save === 'function') {
            await tag.save();
        } else {
            await this.Tag.updateOne({ _id: String(tag._id) }, { $set: { kb } });
        }
        return tag.kb;
    }

    tagFilter(tagId) {
        return tagFilter(tagId);
    }

    async syncTagById(tagId) {
        if (!this.qdrant) await this.initQdrant();

        const normalizedTagId = String(tagId);
        const tag = await this.Tag.findById(normalizedTagId);
        if (!tag) {
            await this.deleteTagById(normalizedTagId);
            return { deleted: true, tagId: normalizedTagId };
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
        if (!this.qdrant) await this.initQdrant();
        await this.qdrant.deleteByFilter(this.collection, tagFilter(tagId));
    }

    // Sync a single entry. Cheap path used after CRUD mutations.
    async syncEntry(doc) {
        if (!this.qdrant) await this.initQdrant();
        if (!this.openrouterApiKey) throw new Error('Missing OPENROUTER_API_KEY');

        const desired = buildDesiredPoints([doc.toObject ? doc.toObject() : doc], this.namespace);
        const existing = await this.qdrant.scrollAll(
            this.collection,
            ['q_hash', 'meta_hash', 'entry_id'],
            entryFilter(String(doc._id))
        );

        const diff = computeDiff(desired, existing);
        await this.applyDiff(diff, () => {});
    }

    async applyDiff({ toEmbed, toUpdateMeta, toDelete }, log) {
        if (toDelete.length) {
            await this.qdrant.deletePoints(this.collection, toDelete);
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
            log(`embedded ${Math.min(i + EMBED_BATCH, toEmbed.length)}/${toEmbed.length}`);
        }

        for (let i = 0; i < toUpdateMeta.length; i++) {
            const x = toUpdateMeta[i];
            await this.qdrant.setPayload(this.collection, x.pointId, buildPayload(x));
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

function entryFilter(entryId) {
    return { must: [{ key: 'entry_id', match: { value: entryId } }] };
}

function tagFilter(tagId) {
    return { must: [{ key: 'tag_id', match: { value: String(tagId) } }] };
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
        kb?.dataHash === dataHash &&
        kb?.promptVersion === TAG_QUESTION_PROMPT_VERSION &&
        kb?.generationHash === generationHash &&
        hasValidGeneratedQuestionCache(kb.questions)
    );
}

function hasValidGeneratedQuestionCache(questions) {
    if (!Array.isArray(questions) || questions.length < 5 || questions.length > 8) return false;
    return questions.every((question) => {
        if (typeof question?.text !== 'string' || typeof question?.hash !== 'string') return false;
        const text = question.text.replace(/\s+/g, ' ').trim();
        return Boolean(text) && question.text === text && question.hash === sha1(text);
    });
}

function buildTagQuestionMessages(tag) {
    const tagId = String(tag._id);
    const data = String(tag.data ?? '').trim();
    return [
        { role: 'system', content: TAG_QUESTION_SYSTEM_PROMPT },
        {
            role: 'user',
            content:
                'Generate 5 to 8 concise user questions that this support tag would help retrieve.\n' +
                'The questions are retrieval scaffolding only and must not add facts beyond the tag data.\n' +
                `Tag id: ${tagId}\n` +
                `Tag data:\n${data}`,
        },
    ];
}

function parseGeneratedQuestionArray(content) {
    let parsed;
    try {
        parsed = JSON.parse(String(content ?? '').trim());
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

function metaOf(doc) {
    return {
        a: doc.a,
        source: doc.source ?? null,
        category: Array.isArray(doc.category) ? [...doc.category].sort() : doc.category ?? null,
    };
}

function normalizeVariants(q) {
    if (!Array.isArray(q)) throw new Error('q must be an array');
    return q.map((v) => String(v).trim()).filter(Boolean);
}

function normalizeCategory(category) {
    if (category == null) return [];
    return Array.isArray(category) ? category.filter(Boolean) : [String(category).trim()].filter(Boolean);
}

// Flatten docs into the point-descriptor map used for sync diffing.
// Each entry yields: one point per q variant + one point for the answer text.
function buildDesiredPoints(docs, namespace) {
    const desired = new Map();
    for (const doc of docs) {
        const entryId = String(doc._id);
        const metaHash = sha1(stableStringify(metaOf(doc)));
        const aHash = sha1(doc.a);

        for (const variant of doc.q) {
            const qHash = sha1(variant);
            const pointId = toPointId(namespace, qHash);
            desired.set(pointId, { pointId, kind: 'q', text: variant, doc, entryId, qHash, aHash, metaHash });
        }

        const aPointId = toPointId(namespace, `a:${aHash}`);
        desired.set(aPointId, {
            pointId: aPointId,
            kind: 'a',
            text: doc.a,
            doc,
            entryId,
            qHash: null,
            aHash,
            metaHash,
        });
    }
    return desired;
}

function buildDesiredTagPoints(tag, namespace) {
    const tagId = String(tag._id);
    const data = String(tag.data ?? '').trim();
    const dataHash = tag.kb?.dataHash || sha1(data);
    const questions = Array.isArray(tag.kb?.questions) ? tag.kb.questions : [];
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

// Diff desired against existing Qdrant points. existingPoints is only the
// set we should consider for deletion — for full syncs it's the whole
// collection, for syncEntry it's just one entry's points.
function computeDiff(desired, existingPoints) {
    const existingById = new Map(existingPoints.map((p) => [String(p.id), p]));
    const toEmbed = [];
    const toUpdateMeta = [];
    const toDelete = [];

    for (const [pointId, desc] of desired) {
        const prev = existingById.get(String(pointId));
        if (!prev) {
            toEmbed.push({ ...desc, op: 'add' });
        } else if (isTagPoint(desc)) {
            const previousPayload = prev.payload || {};
            const desiredPayload = buildPayload(desc);
            if (previousPayload.kind !== desc.kind || previousPayload.tag_id !== desc.tagId) {
                toEmbed.push({ ...desc, op: 'vector' });
            } else if (!payloadMatches(previousPayload, desiredPayload)) {
                toUpdateMeta.push(desc);
            }
        } else if (desc.kind === 'q' && prev.payload?.q_hash !== desc.qHash) {
            // Defensive: Q point IDs derive from q_hash so this shouldn't fire
            toEmbed.push({ ...desc, op: 'vector' });
        } else if (prev.payload?.meta_hash !== desc.metaHash || !prev.payload?.entry_id) {
            // Force a payload refresh on points missing entry_id (one-time
            // backfill for points indexed before that field existed).
            toUpdateMeta.push(desc);
        }
    }

    for (const pointId of existingById.keys()) {
        if (!desired.has(pointId)) toDelete.push(pointId);
    }

    return { toEmbed, toUpdateMeta, toDelete };
}

function isTagPoint(desc) {
    return desc.kind === 'tag_answer' || desc.kind === 'tag_question';
}

function payloadMatches(previousPayload, desiredPayload) {
    for (const [key, value] of Object.entries(desiredPayload)) {
        if (previousPayload[key] !== value) return false;
    }
    return true;
}

function buildPayload(item) {
    if (item.kind === 'tag_answer' || item.kind === 'tag_question') {
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

    const { kind, doc, entryId, qHash, aHash, metaHash } = item;
    const payload = {
        kind,
        entry_id: entryId,
        a: doc.a,
        a_hash: aHash,
        meta_hash: metaHash,
        updated_at: Math.floor(Date.now() / 1000),
    };
    if (kind === 'q') {
        payload.q = item.text;
        payload.q_hash = qHash;
    }
    if (doc.source != null) payload.source = doc.source;
    if (doc.category != null && (!Array.isArray(doc.category) || doc.category.length)) {
        payload.category = doc.category;
    }
    return payload;
}

function dedupeByEntry(hits) {
    const seen = new Set();
    const out = [];
    for (const hit of hits) {
        const key = hit.payload?.entry_id || hit.payload?.a_hash || hit.payload?.a;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(hit);
    }
    return out;
}

// Group Qdrant hits by entry_id, preserving Qdrant's score-desc order.
// Returns [{ entryId, topScore, hits: [...] }] with the top-scoring hit first
// in each group.
function groupHitsByEntry(hits) {
    const groups = new Map();
    for (const hit of hits) {
        const key = hit.payload?.entry_id || hit.payload?.a_hash || hit.payload?.a;
        if (!key) continue;
        if (!groups.has(key)) {
            groups.set(key, {
                entryId: hit.payload?.entry_id || null,
                aHash: hit.payload?.a_hash || null,
                topScore: hit.score,
                hits: [hit],
            });
        } else {
            groups.get(key).hits.push(hit);
        }
    }
    return Array.from(groups.values());
}

function formatContextEntry(hit, index) {
    const p = hit.payload || {};
    const cats = Array.isArray(p.category) ? p.category.join(', ') : p.category || 'uncategorized';
    const answer = (p.a || '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    const sourceLine = p.source ? `\nSource: ${p.source}` : '';
    const qLine = p.q ? `\nQ: ${p.q}` : '';
    return `[Entry ${index}] (categories: ${cats})${qLine}\nA: ${answer}${sourceLine}`;
}

function formatSource(source) {
    if (typeof source === 'string' && /^https?:\/\//.test(source)) {
        return `<${source}>`;
    }
    return `\`${source}\``;
}
