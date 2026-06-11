const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v5: uuidv5 } = require('uuid');

const { Qdrant, embed, chat } = require('../utils/kb.js');

const KB_FILE = path.join(__dirname, '..', 'data', 'kb.json');

const SYSTEM_PROMPT =
    'You are Snail, a helpful assistant in the OwO Discord bot support server. ' +
    "Answer the user's question using ONLY the provided knowledge base entries. " +
    "If the entries do not contain the answer, say you don't know and suggest asking a helper. " +
    'Be concise and friendly. Do not invent commands, items, or behavior that is not in the entries. ' +
    'Do not include source links in your answer text — they will be appended separately.';

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
        this.maxTokens = kbConfig.maxTokens ?? 500;
        this.temperature = kbConfig.temperature ?? 0.2;

        this.qdrant = null;
        this.syncing = false;
        this.lastSync = null;
        this.lastSyncSummary = null;

        this.addEvent('messageCreate', this.onMessage);
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

    formatQuery(question) {
        return `Instruct: ${this.queryInstruction}\nQuery: ${question}`;
    }

    async ask(question) {
        if (!this.qdrant) {
            await this.initQdrant();
        }
        if (!this.openrouterApiKey) {
            throw new Error('Missing OPENROUTER_API_KEY');
        }

        const [vector] = await embed({
            apiKey: this.openrouterApiKey,
            model: this.embeddingModel,
            inputs: [this.formatQuery(question)],
        });

        // Fetch more than topK so dedupe by entry still leaves us enough unique entries
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
        if (!this.openrouterApiKey) throw new Error('Missing OPENROUTER_API_KEY');

        const [vector] = await embed({
            apiKey: this.openrouterApiKey,
            model: this.embeddingModel,
            inputs: [this.formatQuery(question)],
        });

        // Fetch wider than the requested entry-limit so we can group multiple variants
        // of the same entry together and still surface enough unique entries.
        const wantEntries = limit ?? this.topK;
        const hits = await this.qdrant.search(this.collection, {
            vector,
            limit: wantEntries * 5,
            scoreThreshold: includeBelowThreshold ? undefined : this.scoreThreshold,
        });

        return { hits, threshold: this.scoreThreshold };
    }

    async sync({ dryRun = false } = {}) {
        if (this.syncing) throw new Error('A sync is already in progress');
        if (!this.qdrant) await this.initQdrant();
        if (!dryRun && !this.openrouterApiKey) throw new Error('Missing OPENROUTER_API_KEY');

        this.syncing = true;
        const log = (msg) => console.log(`[KB] sync${dryRun ? ' (dry)' : ''}: ${msg}`);
        try {
            const entries = loadAndValidate(KB_FILE);

            // Flatten entries into points:
            //  - one Q point per variant (kind='q'), text = variant
            //  - one A point per entry   (kind='a'), text = answer
            const desired = new Map();
            let qCount = 0;
            let aCount = 0;
            for (const entry of entries) {
                const metaHash = sha1(stableStringify(metaOf(entry)));
                const aHash = sha1(entry.a);

                for (const qVariant of entry.q) {
                    const qHash = sha1(qVariant);
                    const pointId = toPointId(this.namespace, qHash);
                    desired.set(pointId, {
                        pointId,
                        kind: 'q',
                        text: qVariant,
                        entry,
                        qHash,
                        aHash,
                        metaHash,
                    });
                    qCount++;
                }

                const aPointId = toPointId(this.namespace, `a:${aHash}`);
                desired.set(aPointId, {
                    pointId: aPointId,
                    kind: 'a',
                    text: entry.a,
                    entry,
                    qHash: null,
                    aHash,
                    metaHash,
                });
                aCount++;
            }
            log(`loaded ${entries.length} entries → ${qCount} q points + ${aCount} a points = ${desired.size} total`);

            const existing = await this.qdrant.scrollAll(this.collection, ['q_hash', 'meta_hash']);
            const existingById = new Map(existing.map((p) => [String(p.id), p]));
            log(`scrolled ${existing.length} existing points in '${this.collection}'`);

            const toEmbed = [];
            const toUpdateMeta = [];
            const toDelete = [];

            for (const [pointId, desc] of desired) {
                const prev = existingById.get(String(pointId));
                if (!prev) {
                    toEmbed.push({ ...desc, op: 'add' });
                } else if (desc.kind === 'q' && prev.payload?.q_hash !== desc.qHash) {
                    // Defensive: Q point IDs are derived from q_hash, so this shouldn't trigger
                    toEmbed.push({ ...desc, op: 'vector' });
                } else if (prev.payload?.meta_hash !== desc.metaHash) {
                    toUpdateMeta.push(desc);
                }
            }

            for (const pointId of existingById.keys()) {
                if (!desired.has(pointId)) toDelete.push(pointId);
            }

            const summary = {
                added: toEmbed.filter((x) => x.op === 'add').length,
                vectorUpdated: toEmbed.filter((x) => x.op === 'vector').length,
                metaUpdated: toUpdateMeta.length,
                deleted: toDelete.length,
                unchanged: desired.size - toEmbed.length - toUpdateMeta.length,
                totalVariants: qCount,
                totalAnswers: aCount,
                totalPoints: desired.size,
                totalEntries: entries.length,
                dryRun,
            };
            log(
                `diff: +${summary.added} add, ~${summary.vectorUpdated} vector, ` +
                    `~${summary.metaUpdated} meta, -${summary.deleted} delete, =${summary.unchanged} unchanged`
            );

            if (dryRun) return summary;

            if (toDelete.length) {
                await this.qdrant.deletePoints(this.collection, toDelete);
                log(`deleted ${toDelete.length}`);
            }

            if (toEmbed.length) {
                const batchSize = 64;
                for (let i = 0; i < toEmbed.length; i += batchSize) {
                    const batch = toEmbed.slice(i, i + batchSize);
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
                    log(`embedded ${Math.min(i + batchSize, toEmbed.length)}/${toEmbed.length}`);
                }
            }

            for (let i = 0; i < toUpdateMeta.length; i++) {
                const x = toUpdateMeta[i];
                await this.qdrant.setPayload(this.collection, x.pointId, buildPayload(x));
                if ((i + 1) % 50 === 0 || i + 1 === toUpdateMeta.length) {
                    log(`payload updated ${i + 1}/${toUpdateMeta.length}`);
                }
            }

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

    async setChatModel(model) {
        this.chatModel = model;
        await this.bot.setConfiguration(`${this.id}_chat_model`, model);
    }

    getConfigurationOverview() {
        return (
            `${super.getConfigurationOverview()}\n` +
            `- Qdrant URL: ${this.qdrantUrl}\n` +
            `- Collection: ${this.collection}\n` +
            `- Embedding Model: ${this.embeddingModel} (${this.embeddingSize}d)\n` +
            `- Chat Model: ${this.chatModel}\n` +
            `- Top K: ${this.topK}\n` +
            `- Score Threshold: ${this.scoreThreshold}\n` +
            `- Last Sync: ${this.syncing ? 'in progress' : this.lastSync ? this.lastSync.toISOString() : 'never'}`
        );
    }
};

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

function metaOf(entry) {
    return {
        a: entry.a,
        source: entry.source ?? null,
        category: Array.isArray(entry.category) ? [...entry.category].sort() : entry.category ?? null,
    };
}

function buildPayload(item) {
    const { kind, entry, qHash, aHash, metaHash } = item;
    const payload = {
        kind,
        a: entry.a,
        a_hash: aHash,
        meta_hash: metaHash,
        updated_at: Math.floor(Date.now() / 1000),
    };
    if (kind === 'q') {
        payload.q = item.text;
        payload.q_hash = qHash;
    }
    if (entry.source != null) payload.source = entry.source;
    if (entry.category != null) payload.category = entry.category;
    return payload;
}

function dedupeByEntry(hits) {
    const seen = new Set();
    const out = [];
    for (const hit of hits) {
        const key = hit.payload?.a_hash || hit.payload?.a;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(hit);
    }
    return out;
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

function loadAndValidate(file) {
    const raw = fs.readFileSync(file, 'utf8');
    const entries = JSON.parse(raw);

    if (!Array.isArray(entries)) {
        throw new Error('kb.json must be an array');
    }

    const seenQuestions = new Map();
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (!entry || typeof entry !== 'object') {
            throw new Error(`Entry #${i} must be an object`);
        }
        if (!Array.isArray(entry.q) || entry.q.length === 0) {
            throw new Error(`Entry #${i} "q" must be a non-empty array of question strings`);
        }
        for (const variant of entry.q) {
            if (typeof variant !== 'string' || !variant.trim()) {
                throw new Error(`Entry #${i} has an empty or non-string question variant`);
            }
            const norm = variant.trim().toLowerCase();
            if (seenQuestions.has(norm)) {
                throw new Error(
                    `Duplicate question variant "${variant}" in entry #${i} ` +
                        `(also in entry #${seenQuestions.get(norm)})`
                );
            }
            seenQuestions.set(norm, i);
        }
        if (typeof entry.a !== 'string' || !entry.a) {
            throw new Error(`Entry #${i} (first q: "${entry.q[0]}") missing string "a"`);
        }
    }

    return entries;
}
