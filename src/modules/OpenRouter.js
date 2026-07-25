const axios = require('axios');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const EMBED_TIMEOUT = 30000;
const CHAT_TIMEOUT = 60000;
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

    assertConfigured() {
        if (!this.apiKey) throw new Error('Missing OPENROUTER_API_KEY');
    }

    async embed(inputs) {
        this.assertConfigured();
        if (!inputs.length) return [];

        const res = await requestWithRetry(() =>
            axios.post(`${OPENROUTER_BASE}/embeddings`, this.buildBody({ model: this.embeddingModel, input: inputs }), {
                headers: this.headers(),
                timeout: EMBED_TIMEOUT,
            })
        );
        return res.data.data.map((d) => d.embedding);
    }

    async chat(systemPrompt, userPrompt) {
        this.assertConfigured();

        const res = await requestWithRetry(() =>
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
            `- Excluded Providers: ${this.excludedProviders.length ? this.excludedProviders.join(', ') : 'none'}`
        );
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

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
