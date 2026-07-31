const axios = require('axios');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const EMBED_TIMEOUT = 30000;
const CHAT_TIMEOUT = 60000;
const RESPONSES_TIMEOUT = 60000;
const RERANK_TIMEOUT = 30000;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

module.exports = class OpenRouter extends require('./Module') {
    constructor(bot) {
        super(bot, {
            id: 'openrouter',
            name: 'OpenRouter',
            description: 'Shared OpenRouter API client.',
            toggleable: false,
        });

        const config = bot.config.openrouter ?? {};

        this.apiKey = process.env.OPENROUTER_API_KEY;
        this.embeddingModel = config.embeddingModel || 'openai/text-embedding-3-small';
        this.chatModel = config.chatModel || 'deepseek/deepseek-chat-v3.1';
        this.rerankModel = config.rerankModel || 'cohere/rerank-4-fast';
        this.maxTokens = config.maxTokens ?? 500;
        this.temperature = config.temperature ?? 0.2;
        this.excludedProviders = normalizeExcludedProviders(config.excludedProviders);
        this.loadedPersistedConfiguration = false;
    }

    async onceReady() {
        await super.onceReady();
        await this.loadPersistedConfiguration();
    }

    async loadPersistedConfiguration() {
        if (this.loadedPersistedConfiguration) return;

        const persisted = await this.bot.getConfiguration(`${this.id}_chat_model`);
        if (persisted) this.chatModel = persisted;
        this.loadedPersistedConfiguration = true;
    }

    get elasticapm() {
        return this.bot.modules.elasticapm;
    }

    assertConfigured() {
        if (!this.apiKey) throw new Error('Missing OPENROUTER_API_KEY');
    }

    async embed(inputs) {
        this.assertConfigured();
        if (!inputs.length) return [];

        const res = await this.#requestOpenRouter('embed', () =>
            axios.post(`${OPENROUTER_BASE}/embeddings`, this.buildBody({ model: this.embeddingModel, input: inputs }), {
                headers: this.headers(),
                timeout: EMBED_TIMEOUT,
            })
        );
        return res.data.data.map((d) => d.embedding);
    }

    async chat(systemPrompt, userPrompt) {
        this.assertConfigured();

        const res = await this.#requestOpenRouter('chat', () =>
            axios.post(
                `${OPENROUTER_BASE}/chat/completions`,
                this.buildBody({
                    model: this.chatModel,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    max_tokens: this.maxTokens,
                    temperature: this.temperature,
                }),
                {
                    headers: this.headers(),
                    timeout: CHAT_TIMEOUT,
                }
            )
        );
        return {
            content: String(res.data?.choices?.[0]?.message?.content ?? '').trim(),
            usage: res.data.usage,
        };
    }

    async responses(systemPrompt, userPrompt, history = []) {
        this.assertConfigured();

        const res = await this.#requestOpenRouter('responses', () =>
            axios.post(
                `${OPENROUTER_BASE}/responses`,
                this.buildBody({
                    model: this.chatModel,
                    instructions: systemPrompt,
                    input: buildResponsesInput(history, userPrompt),
                    max_output_tokens: this.maxTokens,
                    temperature: this.temperature,
                }),
                {
                    headers: this.headers(),
                    timeout: RESPONSES_TIMEOUT,
                }
            )
        );
        return {
            content: parseResponsesOutputText(res.data).trim(),
            usage: normalizeUsage(res.data.usage),
        };
    }

    async rerank(query, documents, { topN } = {}) {
        this.assertConfigured();
        if (!documents.length) return [];

        const top_n = Math.min(topN ?? documents.length, documents.length);
        const res = await this.#requestOpenRouter('rerank', () =>
            axios.post(
                `${OPENROUTER_BASE}/rerank`,
                this.buildBody({
                    model: this.rerankModel,
                    query,
                    documents,
                    top_n,
                }),
                {
                    headers: this.headers(),
                    timeout: RERANK_TIMEOUT,
                }
            )
        );
        return parseRerankResults(res.data?.results, documents.length);
    }

    async setChatModel(model) {
        this.chatModel = model;
        await this.bot.setConfiguration(`${this.id}_chat_model`, model);
    }

    buildBody(body) {
        if (!this.excludedProviders.length) return body;
        return {
            ...body,
            provider: {
                ignore: this.excludedProviders,
            },
        };
    }

    headers() {
        return {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
        };
    }

    getConfigurationOverview() {
        return (
            `${super.getConfigurationOverview()}\n` +
            `- Embedding Model: ${this.embeddingModel}\n` +
            `- Chat Model: ${this.chatModel}\n` +
            `- Rerank Model: ${this.rerankModel}\n` +
            `- Excluded Providers: ${this.excludedProviders.length ? this.excludedProviders.join(', ') : 'none'}`
        );
    }

    #requestOpenRouter(type, fn) {
        const transaction = this.elasticapm.currentTransaction;
        const span = this.elasticapm.startSpan(`openrouter.${type}`, 'external.openrouter');

        return requestWithRetry(fn)
            .then((res) => {
                this.#addOpenRouterApmLabels(transaction, span, res, type);
                span?.setOutcome('success');
                return res;
            })
            .catch((err) => {
                span?.setOutcome('failure');
                throw err;
            })
            .finally(() => {
                span?.end();
            });
    }

    #addOpenRouterApmLabels(transaction, span, res, type) {
        const data = res.data ?? {};

        if (data.model) {
            transaction?.setLabel(`openrouter.${type}.model`, data.model);
            span?.setLabel('openrouter_model', data.model);
        }
        if (data.provider) {
            transaction?.setLabel(`openrouter.${type}.provider`, data.provider);
            span?.setLabel('openrouter_provider', data.provider);
        }
        const usage = normalizeUsage(data.usage);
        if (!usage) return;

        const customContext = {};
        customContext[type] = usage;
        this.elasticapm.apm?.setCustomContext(customContext);
    }
};

async function requestWithRetry(fn, { attempts = RETRY_ATTEMPTS, retryDelayMs = RETRY_DELAY_MS } = {}) {
    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt === attempts || !isRetryableError(err)) throw err;
            await delay(retryDelayMs * attempt);
        }
    }
    throw lastErr;
}

function isRetryableError(err) {
    const status = err.response?.status;
    if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
    return ['EPIPE', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(err.code);
}

function normalizeExcludedProviders(providers) {
    if (!Array.isArray(providers)) return [];
    return providers.map((provider) => String(provider).trim()).filter(Boolean);
}

function parseRerankResults(results, documentCount) {
    if (!Array.isArray(results)) return [];
    return results
        .map((result) => ({
            index: Number(result?.index),
            relevanceScore: Number(result?.relevance_score ?? result?.score),
        }))
        .filter(
            (result) =>
                Number.isInteger(result.index) &&
                result.index >= 0 &&
                result.index < documentCount &&
                Number.isFinite(result.relevanceScore)
        )
        .sort((a, b) => b.relevanceScore - a.relevanceScore);
}

function buildResponsesInput(history, userPrompt) {
    const input = [];
    for (let i = 0; i < (history || []).length; i++) {
        const item = history[i];
        const role = item?.role === 'assistant' ? 'assistant' : 'user';
        input.push(toResponsesMessage(role, item?.content, item?.id || `history_${i}`));
    }
    input.push(toResponsesMessage('user', userPrompt));
    return input;
}

function toResponsesMessage(role, text, id) {
    const contentType = role === 'assistant' ? 'output_text' : 'input_text';
    const message = {
        type: 'message',
        role,
        content: [
            {
                type: contentType,
                text: String(text ?? ''),
            },
        ],
    };
    if (role === 'assistant') {
        message.id = toResponsesMessageId(id);
        message.status = 'completed';
        message.content[0].annotations = [];
    }
    return message;
}

function toResponsesMessageId(id) {
    return `msg_${String(id ?? 'history').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

function parseResponsesOutputText(data) {
    if (typeof data?.output_text === 'string') return data.output_text;

    const parts = [];
    for (const item of data?.output || []) {
        for (const content of item?.content || []) {
            if (typeof content?.text === 'string') parts.push(content.text);
        }
    }
    return parts.join('');
}

function normalizeUsage(usage) {
    if (!usage) return;
    return {
        prompt_tokens: usage.prompt_tokens ?? usage.input_tokens,
        completion_tokens: usage.completion_tokens ?? usage.output_tokens,
        total_tokens: usage.total_tokens,
        cost: usage.cost,
    };
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
