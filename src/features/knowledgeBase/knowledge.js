import { createHash } from 'node:crypto';
import { requestQdrant } from '../../services/qdrant.js';
import { matchTerms } from './terms.js';

const EMBED_BATCH_SIZE = 64;
const QUESTION_CACHE_WRITE_BATCH_SIZE = 100;
const UPDATE_POINT_BATCH_SIZE = 256;
const PAYLOAD_FIELDS = Object.freeze(['tag_id', 'kind', 'text_hash', 'question']);
const POINT_ID_PREFIX = 'snail-knowledge-base:';
const QUESTION_PROMPT_VERSION = 'tag-question-v3';
const QUESTION_SYSTEM_PROMPT = 'You generate retrieval scaffolding questions for OwO Discord bot support tags.';
const QUESTION_PROMPT_SOURCE = `${QUESTION_PROMPT_VERSION}:${QUESTION_SYSTEM_PROMPT}`;
const FALLBACK_ANSWER = "I don't know that one yet — please ask a helper or rephrase your question.";
const RETRIEVAL_HISTORY_MAX_CHARS = 1_200;

const ANSWER_SYSTEM_PROMPT =
    'You are Snail, a friendly helper in the OwO Discord bot support server. ' +
    "Answer the user's question directly using ONLY the provided support notes. " +
    'Prior conversation may clarify what the user means, but it is not a source of truth. ' +
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

export function createKnowledgeBase({ config, Tag, tags, terms, qdrant, openRouter, elasticApm, log }) {
    const state = {
        syncing: false,
        progress: undefined,
        lastSync: undefined,
        lastSummary: undefined,
    };
    let syncQueue = Promise.resolve();
    let resetOperation;

    return {
        state,
        initialize: ensureCollection,
        activate() {
            void enqueue(() => syncAll()).catch((error) =>
                log.error('Knowledge Base startup synchronization failed', { error }),
            );
        },
        sync(options = {}) {
            return enqueue(() => syncAll(options));
        },
        reset() {
            const operation = enqueue(async () => {
                state.syncing = true;
                setProgress('deletingCollection', 0, 1);
                try {
                    await qdrant.deleteCollection(config.collection);
                    setProgress('deletingCollection', 1, 1);
                    setProgress('creatingCollection', 0, 1);
                    await ensureCollection();
                    setProgress('creatingCollection', 1, 1);
                    return syncAll();
                } catch (error) {
                    setProgress('failed', state.progress?.processed ?? 0, state.progress?.total ?? 0);
                    state.syncing = false;
                    throw error;
                }
            });
            resetOperation = operation;
            const clear = () => {
                if (resetOperation === operation) resetOperation = undefined;
            };
            void operation.then(clear, clear);
            return operation;
        },
        syncTags(tags_) {
            return enqueue(() => synchronizeTags(tags_));
        },
        deleteTags(tagIds) {
            return enqueue(() =>
                requestQdrant(() => qdrant.delete(config.collection, { filter: tagFilter(tagIds), wait: true })),
            );
        },
        getQuestionEditor(tagId) {
            const tag = tags.get(tagId);
            return tag ? createQuestionEditor(tag) : undefined;
        },
        updateQuestions(tagId, input) {
            return enqueue(async () => {
                const stored = tags.get(tagId);
                if (!stored) return undefined;
                const tag = copyTag(stored);
                const hashes = getCacheHashes(tag);
                tag.knowledgeBase = createCache(
                    tag,
                    normalizeQuestions(input.split('\n')),
                    hashes,
                    tag.knowledgeBase?.generatedAt,
                );
                await saveQuestionCache(tag);
                const current = rememberQuestionCache(tag);
                if (!current) return undefined;
                if (!current.knowledgeBase.excluded) {
                    await synchronizeTags([current]).catch((error) =>
                        log.error('Saved retrieval questions but could not synchronize search points', {
                            error,
                            tagId,
                        }),
                    );
                }
                return createQuestionEditor(current);
            });
        },
        regenerateQuestions(tagId) {
            return enqueue(async () => {
                const stored = tags.get(tagId);
                if (!stored) return undefined;
                const tag = copyTag(stored);
                const current = await regenerateQuestions(tag);
                if (!current) return undefined;
                if (!current.knowledgeBase.excluded) {
                    await synchronizeTags([current]).catch((error) =>
                        log.error('Regenerated retrieval questions but could not synchronize search points', {
                            error,
                            tagId,
                        }),
                    );
                }
                return createQuestionEditor(current);
            });
        },
        find(question) {
            return find(question, true);
        },
        ask(question, history = []) {
            const transaction = elasticApm.startTransaction('snail.ask.fetch', 'bot');
            transaction?.setLabel('question_length', question.length);

            return ask(question, history)
                .then((result) => {
                    transaction?.setOutcome('success');
                    return result;
                })
                .catch((error) => {
                    transaction?.setOutcome('failure');
                    elasticApm.captureError(error);
                    throw error;
                })
                .finally(() => transaction?.end());
        },
        async getOverview() {
            const rebuilding = ['deletingCollection', 'creatingCollection'].includes(state.progress?.phase);
            const count = rebuilding ? undefined : await qdrant.count(config.collection);
            const storedTags = [...tags.values()];
            return {
                collection: config.collection,
                embeddingSize: config.embeddingSize,
                topK: config.topK,
                candidateLimit: config.rerankCandidateLimit,
                scoreThreshold: config.scoreThreshold,
                points: count?.count,
                publicTags: storedTags.filter((tag) => tag.public).length,
                privateTags: storedTags.filter((tag) => !tag.public).length,
                excludedTags: storedTags.filter((tag) => tag.knowledgeBase?.excluded).length,
                terms: terms.size,
                syncing: state.syncing,
                progress: state.progress,
                lastSync: state.lastSync,
                lastSummary: state.lastSummary,
            };
        },
    };

    function enqueue(operation) {
        const run = syncQueue.catch(() => {}).then(operation);
        syncQueue = run.catch(() => {});
        return run;
    }

    function setProgress(phase, processed, total) {
        state.progress = { phase, processed, total };
    }

    async function syncAll({ dryRun = false, regenerateQuestions: regenerate = false } = {}) {
        state.syncing = true;
        const timer = log.time();

        try {
            const storedTags = [...tags.values()];
            setProgress('preparingTags', 0, storedTags.length);
            const desired = new Map();
            const failedTagIds = new Set();
            const pendingQuestionCaches = [];

            for (const storedTag of storedTags) {
                const tag = copyTag(storedTag);
                if (!tag.knowledgeBase?.excluded && tag.text) {
                    try {
                        if (!dryRun && (regenerate || !validQuestions(tag.knowledgeBase?.questions))) {
                            await generateQuestions(tag);
                            pendingQuestionCaches.push(tag);
                        } else if (!dryRun && !isCurrentCache(tag.knowledgeBase, getCacheHashes(tag))) {
                            tag.knowledgeBase = { ...tag.knowledgeBase, ...getCacheHashes(tag) };
                            pendingQuestionCaches.push(tag);
                        } else {
                            addDesiredPoints(desired, tag);
                        }
                        if (pendingQuestionCaches.length === QUESTION_CACHE_WRITE_BATCH_SIZE) {
                            await flushQuestionCaches(pendingQuestionCaches, desired, failedTagIds);
                        }
                    } catch (error) {
                        failedTagIds.add(tag._id);
                        log.warn('Skipped tag during Knowledge Base synchronization', {
                            error,
                            tagId: tag._id,
                        });
                    }
                }
                const processedTags = state.progress.processed + 1;
                setProgress('preparingTags', processedTags, storedTags.length);
                if (processedTags % 25 === 0 || processedTags === storedTags.length) {
                    log.trace('Prepared Knowledge Base synchronization tags', {
                        processed: processedTags,
                        total: storedTags.length,
                        desiredPoints: desired.size,
                        failedTags: failedTagIds.size,
                        pendingQuestionCaches: pendingQuestionCaches.length,
                    });
                }
            }
            await flushQuestionCaches(pendingQuestionCaches, desired, failedTagIds);
            timer.checkpoint('prepare');

            setProgress('readingPoints', 0, 0);
            const { count: existingCount } = await requestQdrant(() => qdrant.count(config.collection));
            setProgress('readingPoints', 0, existingCount);
            const existing = await scrollAll(undefined, (processed) =>
                setProgress('readingPoints', processed, existingCount),
            );
            timer.checkpoint('qdrant');
            const existingForDiff = failedTagIds.size
                ? existing.filter((point) => !failedTagIds.has(point.payload?.tag_id))
                : existing;
            setProgress('comparingPoints', 0, existingForDiff.length);
            const diff = computeDiff(desired, existingForDiff);
            setProgress('comparingPoints', existingForDiff.length, existingForDiff.length);
            if (!dryRun) await applyDiff(diff);
            timer.checkpoint('apply');

            const totalQuestions = [...desired.values()].filter(
                (point) => point.payload.kind === 'tag_question',
            ).length;
            const totalAnswers = desired.size - totalQuestions;

            const summary = {
                tags: storedTags.length,
                desiredPoints: desired.size,
                added: diff.embed.filter((point) => point.operation === 'add').length,
                vectorUpdated: diff.embed.filter((point) => point.operation === 'vector').length,
                metaUpdated: diff.metadata.length,
                deleted: diff.deleted.length,
                unchanged: desired.size - diff.embed.length - diff.metadata.length,
                totalAnswers,
                totalQuestions,
                failedTags: failedTagIds.size,
                dryRun,
                regeneratedQuestions: regenerate,
            };
            state.lastSummary = summary;
            if (!dryRun) state.lastSync = new Date();
            setProgress('complete', desired.size, desired.size);
            timer.info('Synchronized Knowledge Base', summary);
            return summary;
        } catch (error) {
            setProgress('failed', state.progress?.processed ?? 0, state.progress?.total ?? 0);
            timer.error('Knowledge Base synchronization failed', { error, dryRun, regenerateQuestions: regenerate });
            throw error;
        } finally {
            state.syncing = false;
        }
    }

    async function synchronizeTags(storedTags) {
        const desired = new Map();
        const tagIds = [];

        for (const storedTag of storedTags) {
            if (tags.get(storedTag._id) !== storedTag) continue;

            let tag = copyTag(storedTag);
            if (tag.knowledgeBase?.excluded || !tag.text) {
                tagIds.push(tag._id);
                continue;
            }

            try {
                tag = await ensureCache(tag);
                if (!tag) continue;
                tagIds.push(tag._id);
                if (!tag.knowledgeBase?.excluded && tag.text) addDesiredPoints(desired, tag);
            } catch (error) {
                log.error('Knowledge Base tag synchronization failed', { error, tagId: tag._id });
            }
        }

        if (!tagIds.length) return;
        const existing = await scrollAll(tagFilter(tagIds));
        const diff = computeDiff(desired, existing);
        await applyDiff(diff);
        log.debug('Synchronized Knowledge Base tags', {
            tagIds,
            added: diff.embed.filter((point) => point.operation === 'add').length,
            vectorUpdated: diff.embed.filter((point) => point.operation === 'vector').length,
            metaUpdated: diff.metadata.length,
            deleted: diff.deleted.length,
            points: desired.size,
        });
    }

    async function ensureCache(tag) {
        if (validQuestions(tag.knowledgeBase?.questions)) {
            const hashes = getCacheHashes(tag);
            if (isCurrentCache(tag.knowledgeBase, hashes)) return tag;

            tag.knowledgeBase = { ...tag.knowledgeBase, ...hashes };
            await saveQuestionCache(tag);
            return rememberQuestionCache(tag);
        }

        return regenerateQuestions(tag);
    }

    async function regenerateQuestions(tag) {
        await generateQuestions(tag);
        await saveQuestionCache(tag);
        return rememberQuestionCache(tag);
    }

    async function generateQuestions(tag) {
        const content = await openRouter.chat(QUESTION_SYSTEM_PROMPT, questionPrompt(tag));
        let questions;
        try {
            questions = parseQuestionResponse(content);
        } catch (error) {
            log.error('Knowledge Base question generation returned an invalid response', {
                error,
                tagId: tag._id,
                response: content.slice(0, 4000),
            });
            throw error;
        }
        tag.knowledgeBase = createCache(tag, questions, getCacheHashes(tag));
    }

    function saveQuestionCache(tag) {
        return Tag.updateOne({ _id: tag._id, text: tag.text }, { $set: questionCacheUpdate(tag.knowledgeBase) });
    }

    async function flushQuestionCaches(pending, desired, failedTagIds) {
        if (!pending.length) return;

        const batch = pending.splice(0);
        try {
            await Tag.bulkWrite(
                batch.map((tag) => ({
                    updateOne: {
                        filter: { _id: tag._id, text: tag.text },
                        update: { $set: questionCacheUpdate(tag.knowledgeBase) },
                    },
                })),
                { ordered: false },
            );
            for (const tag of batch) rememberPreparedTag(tag, desired, failedTagIds);
        } catch (error) {
            log.warn('Knowledge Base question-cache batch failed; saving tags individually', {
                error,
                tags: batch.length,
            });
            for (const tag of batch) {
                try {
                    await saveQuestionCache(tag);
                    rememberPreparedTag(tag, desired, failedTagIds);
                } catch (tagError) {
                    failedTagIds.add(tag._id);
                    log.warn('Skipped tag after its Knowledge Base question cache could not be saved', {
                        error: tagError,
                        tagId: tag._id,
                    });
                }
            }
        }
    }

    function rememberPreparedTag(tag, desired, failedTagIds) {
        const current = rememberQuestionCache(tag);
        if (!current || current.knowledgeBase?.excluded || !current.text) {
            failedTagIds.add(tag._id);
            return;
        }
        addDesiredPoints(desired, current);
    }

    function rememberQuestionCache(tag) {
        const current = tags.get(tag._id);
        if (!current || current.text !== tag.text || current.message !== tag.message || current.public !== tag.public) {
            return undefined;
        }

        const updated = copyTag(current);
        updated.knowledgeBase = {
            ...updated.knowledgeBase,
            ...questionCacheFields(tag.knowledgeBase),
        };
        tags.set(tag._id, updated);
        return updated;
    }

    function addDesiredPoints(desired, tag) {
        for (const point of buildDesiredPoints(tag)) desired.set(point.pointId, point);
    }

    async function applyDiff(diff) {
        if (state.syncing) setProgress('embeddingPoints', 0, diff.embed.length);
        for (let index = 0; index < diff.embed.length; index += EMBED_BATCH_SIZE) {
            const batch = diff.embed.slice(index, index + EMBED_BATCH_SIZE);
            const vectors = await openRouter.embed(batch.map((point) => point.text));
            await requestQdrant(() =>
                qdrant.upsert(config.collection, {
                    points: batch.map((point, offset) => ({
                        id: point.pointId,
                        vector: vectors[offset],
                        payload: point.payload,
                    })),
                    wait: true,
                }),
            );
            const processed = Math.min(index + EMBED_BATCH_SIZE, diff.embed.length);
            if (state.syncing) setProgress('embeddingPoints', processed, diff.embed.length);
            log.trace('Embedded Knowledge Base search points', {
                processed,
                total: diff.embed.length,
            });
        }

        let deletedIndex = 0;
        let metadataIndex = 0;
        const updateTotal = diff.deleted.length + diff.metadata.length;
        if (state.syncing) setProgress('updatingPoints', 0, updateTotal);
        while (deletedIndex < diff.deleted.length || metadataIndex < diff.metadata.length) {
            const operations = [];
            let remaining = UPDATE_POINT_BATCH_SIZE;
            if (deletedIndex < diff.deleted.length) {
                const points = diff.deleted.slice(deletedIndex, deletedIndex + remaining);
                operations.push({ delete: { points } });
                deletedIndex += points.length;
                remaining -= points.length;
            }
            while (remaining && metadataIndex < diff.metadata.length) {
                const point = diff.metadata[metadataIndex];
                operations.push({
                    overwrite_payload: {
                        points: [point.pointId],
                        payload: point.payload,
                    },
                });
                metadataIndex += 1;
                remaining -= 1;
            }
            await requestQdrant(() =>
                qdrant.batchUpdate(config.collection, {
                    operations,
                    wait: true,
                }),
            );
            if (state.syncing) setProgress('updatingPoints', deletedIndex + metadataIndex, updateTotal);
        }
        if (diff.deleted.length) log.trace('Deleted Knowledge Base search points', { points: diff.deleted.length });
        if (diff.metadata.length) {
            log.trace('Updated Knowledge Base search point payloads', { points: diff.metadata.length });
        }
    }

    async function find(question, includeBelowThreshold = false, history = []) {
        await resetOperation;
        const timer = log.time();
        const matchedTerms = matchTerms(question, terms);
        const expanded = formatExpandedQuery(question, matchedTerms);
        const retrievalQuestion = formatRetrievalQuestion(expanded, history);
        const [vector] = await openRouter.embed([formatQuery(retrievalQuestion, config.queryInstruction)]);
        timer.checkpoint('embedding');
        const result = await requestQdrant(
            () =>
                qdrant.query(config.collection, {
                    query: vector,
                    limit: config.rerankCandidateLimit,
                    with_payload: true,
                    ...(includeBelowThreshold ? {} : { score_threshold: config.scoreThreshold }),
                }),
            2,
        );
        const hits = result.points;
        timer.checkpoint('qdrant');
        const groups = materializeGroups(hits);
        timer.checkpoint('cache');
        const eligible = groups.filter((group) => group.score >= config.scoreThreshold);
        const ranked = await rerank(retrievalQuestion, eligible);
        timer.debug('Retrieved Knowledge Base candidates', {
            rawHits: hits.length,
            tags: groups.length,
            eligible: eligible.length,
            selected: ranked.length,
            terms: matchedTerms.length,
        });
        return {
            question,
            terms: matchedTerms,
            candidates: groups,
            groups: ranked,
            threshold: config.scoreThreshold,
        };
    }

    function materializeGroups(hits) {
        const grouped = new Map();
        for (const hit of hits) {
            const tagId = hit.payload?.tag_id;
            if (!tagId) continue;
            const group = grouped.get(tagId) ?? { tagId, hits: [], score: hit.score };
            group.hits.push(hit);
            group.score = Math.max(group.score, hit.score);
            grouped.set(tagId, group);
        }

        if (!grouped.size) return [];

        return [...grouped.values()]
            .map((group) => ({ ...group, tag: tags.get(group.tagId) }))
            .filter((group) => group.tag?.text && !group.tag.knowledgeBase?.excluded)
            .toSorted((left, right) => right.score - left.score);
    }

    async function rerank(question, groups) {
        if (groups.length <= 1) return groups.slice(0, config.topK);
        try {
            const results = await openRouter.rerank(
                question,
                groups.map((group) => `${group.tag._id}\n${group.tag.text}`),
                config.topK,
            );
            if (!results.length) return groups.slice(0, config.topK);
            return results.map((result) => ({ ...groups[result.index], rerankScore: result.score }));
        } catch (error) {
            log.warn('Knowledge Base reranking failed; using vector order', { error });
            return groups.slice(0, config.topK);
        }
    }

    async function ask(question, history) {
        const result = await find(question, false, history);
        if (!result.groups.length) return { answer: FALLBACK_ANSWER, sources: [] };

        const notes = result.groups.map((group) => `[Tag: ${group.tagId}]\n${group.tag.text}`).join('\n\n');
        const termLines = result.terms.map((term) => `${term.id} = ${term.meaning}`).join('\n');
        const prompt =
            `Support notes:\n${notes}\n\n` +
            (termLines ? `OwO bot terms:\n${termLines}\n\n` : '') +
            `User question:\n${question}`;
        const raw = await openRouter.chat(ANSWER_SYSTEM_PROMPT, prompt, history);
        const parsed = parseAnswer(raw);
        const groupsById = new Map(result.groups.map((group) => [group.tagId, group]));
        const sourceIds = parsed.failed ? [result.groups[0].tagId] : parsed.tagIds;
        const sources = [...new Set(sourceIds)]
            .map((tagId) => groupsById.get(tagId)?.tag)
            .filter(Boolean)
            .map(({ _id, public: public_ }) => ({ _id, public: public_ }));

        return { answer: parsed.answer || FALLBACK_ANSWER, sources };
    }

    async function ensureCollection() {
        const { exists } = await requestQdrant(() => qdrant.collectionExists(config.collection));
        if (!exists) {
            await requestQdrant(() =>
                qdrant.createCollection(config.collection, {
                    vectors: { size: config.embeddingSize, distance: 'Cosine' },
                }),
            );
        }

        await requestQdrant(() =>
            qdrant.createPayloadIndex(config.collection, {
                field_name: 'tag_id',
                field_schema: 'keyword',
                wait: true,
            }),
        );
    }

    async function scrollAll(filter, onProgress) {
        const points = [];
        let offset;

        do {
            const page = await requestQdrant(() =>
                qdrant.scroll(config.collection, {
                    limit: 256,
                    with_payload: PAYLOAD_FIELDS,
                    with_vector: false,
                    ...(offset === undefined ? {} : { offset }),
                    ...(filter ? { filter } : {}),
                }),
            );
            points.push(...page.points);
            onProgress?.(points.length);
            offset = page.next_page_offset ?? undefined;
        } while (offset !== undefined);

        return points;
    }
}

function copyTag(tag) {
    const plain = typeof tag.toObject === 'function' ? tag.toObject() : tag;
    return {
        ...plain,
        _id: tag._id,
        text: tag.text,
        message: tag.message,
        public: tag.public,
        knowledgeBase: { ...plain.knowledgeBase },
    };
}

function createQuestionEditor(tag) {
    return {
        tag,
        current: isCurrentCache(tag.knowledgeBase, getCacheHashes(tag)),
        questions: tag.knowledgeBase?.questions ?? [],
    };
}

function formatQuery(question, instruction) {
    return `Instruct: ${instruction}\nQuery: ${question}`;
}

function formatExpandedQuery(question, terms) {
    if (!terms.length) return question;
    return `${question}\n\nKnown terms:\n${terms.map((term) => `${term.id}: ${term.meaning}`).join('\n')}`;
}

function formatRetrievalQuestion(question, history) {
    const lines = [];
    let chars = 0;
    for (const message of [...(history ?? [])].toReversed()) {
        const content = String(message?.content ?? '').trim();
        if (!content) continue;
        const line = `${message.role === 'assistant' ? 'Snail' : 'User'}: ${content}`;
        if (lines.length && chars + line.length > RETRIEVAL_HISTORY_MAX_CHARS) break;
        const value = line.slice(0, RETRIEVAL_HISTORY_MAX_CHARS);
        lines.unshift(value);
        chars += value.length;
    }
    if (!lines.length) return question;
    return `Previous ask conversation:\n${lines.join('\n')}\n\nCurrent user question:\n${question}`;
}

function tagFilter(tagIds) {
    const match = tagIds.length === 1 ? { value: tagIds[0] } : { any: tagIds };
    return { must: [{ key: 'tag_id', match }] };
}

function buildDesiredPoints(tag) {
    const points = [
        point(`${tag._id}:answer`, tag.text, {
            tag_id: tag._id,
            kind: 'tag_answer',
            text_hash: hash(tag.text),
        }),
    ];

    for (const question of tag.knowledgeBase?.questions ?? []) {
        points.push(
            point(`${tag._id}:question:${question.hash}`, question.text, {
                tag_id: tag._id,
                kind: 'tag_question',
                text_hash: question.hash,
                question: question.text,
            }),
        );
    }
    return points;
}

function point(key, text, payload) {
    return { pointId: pointId(key), text, payload };
}

// The prefix and derivation scheme are persistent point identity. Changing
// either intentionally changes every point ID and requires a full reindex.
function pointId(key) {
    const bytes = createHash('sha256').update(`${POINT_ID_PREFIX}${key}`).digest().subarray(0, 16);
    bytes[6] = (bytes[6] & 0x0f) | 0x80;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Every existing point absent from desired is deleted, so existing must already
// be scoped to the full collection or the single tag being synchronized.
function computeDiff(desired, existing) {
    const current = new Map(existing.map((point) => [point.id, point]));
    const embed = [];
    const metadata = [];

    for (const [id, point] of desired) {
        const old = current.get(id);
        current.delete(id);
        if (!old) embed.push({ ...point, operation: 'add' });
        else if (old.payload?.text_hash !== point.payload.text_hash) embed.push({ ...point, operation: 'vector' });
        else if (PAYLOAD_FIELDS.some((field) => old.payload?.[field] !== point.payload[field])) metadata.push(point);
    }

    return { embed, metadata, deleted: [...current.keys()] };
}

function getCacheHashes(tag) {
    const textHash = hash(tag.text);
    return {
        textHash,
        generationHash: hash(
            JSON.stringify({
                tagId: tag._id,
                textHash,
                promptSource: QUESTION_PROMPT_SOURCE,
            }),
        ),
    };
}

function createCache(tag, questions, hashes, generatedAt = new Date()) {
    return {
        excluded: tag.knowledgeBase?.excluded === true,
        questions: questions.map((text) => ({ text, hash: hash(text) })),
        textHash: hashes.textHash,
        generationHash: hashes.generationHash,
        generatedAt,
    };
}

function questionCacheFields(knowledgeBase) {
    const { questions, textHash, generationHash, generatedAt } = knowledgeBase;
    return { questions, textHash, generationHash, generatedAt };
}

function questionCacheUpdate(knowledgeBase) {
    const fields = questionCacheFields(knowledgeBase);
    return Object.fromEntries(Object.entries(fields).map(([key, value]) => [`knowledgeBase.${key}`, value]));
}

function isCurrentCache(cache, hashes) {
    return (
        cache?.textHash === hashes.textHash &&
        cache.generationHash === hashes.generationHash &&
        validQuestions(cache.questions)
    );
}

function validQuestions(questions) {
    return (
        Array.isArray(questions) &&
        questions.every(
            (question) => question.text === normalizeQuestion(question.text) && question.hash === hash(question.text),
        )
    );
}

function normalizeQuestions(questions) {
    const unique = new Map();
    for (const question of questions) {
        const text = normalizeQuestion(question);
        if (text) unique.set(text.toLowerCase(), text);
    }
    return [...unique.values()];
}

function normalizeQuestion(question) {
    return String(question ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 180);
}

function questionPrompt(tag) {
    return (
        'Generate concise English user questions that this support tag can answer.\n' +
        'Use only the tag text as the source of truth.\n' +
        'Every question must be fully answerable from the tag text alone.\n' +
        'Cover the important facts explicitly stated in the tag text.\n' +
        'Do not add questions that require information outside the tag text.\n' +
        'Use natural user wording and vary phrasing when useful.\n' +
        'Do not start every question with "OwO bot" or the tag name.\n' +
        'Return only a raw JSON array of English strings.\n' +
        'Do not include explanations, markdown, code fences, or answer facts.\n' +
        `Tag id: ${tag._id}\n` +
        `Tag text:\n${tag.text}`
    );
}

function parseQuestionResponse(content) {
    const parsed = JSON.parse(unwrapJson(content));
    if (!Array.isArray(parsed) || parsed.some((question) => typeof question !== 'string')) {
        throw new Error('Question generation did not return an array of strings');
    }
    return normalizeQuestions(parsed);
}

function parseAnswer(content) {
    const raw = String(content ?? '').trim();
    const json = unwrapJson(raw);
    let parsed;
    try {
        parsed = JSON.parse(json);
    } catch {
        try {
            parsed = JSON.parse(
                json.replace(/"(?:\\.|[^"\\])*"/g, (value) =>
                    value.replace(
                        /\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4})|\\([!#$%&'()*+,\-.:;<=>?@[\]^_`{|}~])/g,
                        (match, markdown) => markdown ?? match,
                    ),
                ),
            );
        } catch {
            return { answer: raw, tagIds: [], failed: true };
        }
    }

    if (!parsed || typeof parsed.answer !== 'string') return { answer: '', tagIds: [], failed: true };
    return {
        answer: parsed.answer.trim(),
        tagIds: Array.isArray(parsed.tagIds) ? parsed.tagIds.filter((id) => typeof id === 'string') : [],
        failed: false,
    };
}

function unwrapJson(content) {
    const text = String(content ?? '').trim();
    return text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1].trim() ?? text;
}

function hash(value) {
    return createHash('sha1')
        .update(String(value ?? '').trim())
        .digest('hex');
}
