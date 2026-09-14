const BASE_URL = 'https://openrouter.ai/api/v1';
const EMBED_TIMEOUT = 30_000;
const CHAT_TIMEOUT = 60_000;
const RERANK_TIMEOUT = 30_000;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 500;
const RETRYABLE_STATUS_CODES = Object.freeze([408, 425, 429, 500, 502, 503, 504]);

export function createOpenRouter(config, apiKey, elasticApm) {
    return {
        embeddingModel: config.embeddingModel,
        chatModel: config.chatModel,
        rerankModel: config.rerankModel,
        async embed(inputs) {
            if (!inputs.length) return [];
            const data = await request(
                'embed',
                '/embeddings',
                {
                    model: config.embeddingModel,
                    input: inputs,
                },
                EMBED_TIMEOUT,
            );
            return data.data.map((entry) => entry.embedding);
        },
        async chat(systemPrompt, userPrompt, history = []) {
            const data = await request(
                'chat',
                '/chat/completions',
                {
                    model: config.chatModel,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...history.map((message) => ({
                            role: message?.role === 'assistant' ? 'assistant' : 'user',
                            content: String(message?.content ?? ''),
                        })),
                        { role: 'user', content: userPrompt },
                    ],
                    max_tokens: config.maxTokens,
                    temperature: config.temperature,
                },
                CHAT_TIMEOUT,
            );
            return String(data.choices?.[0]?.message?.content ?? '').trim();
        },
        async rerank(query, documents, topN = documents.length) {
            if (!documents.length) return [];
            const data = await request(
                'rerank',
                '/rerank',
                {
                    model: config.rerankModel,
                    query,
                    documents,
                    top_n: Math.min(topN, documents.length),
                },
                RERANK_TIMEOUT,
            );
            return (data.results ?? [])
                .map((result) => ({
                    index: Number(result.index),
                    score: Number(result.relevance_score ?? result.score),
                }))
                .filter(
                    (result) =>
                        Number.isInteger(result.index) &&
                        result.index >= 0 &&
                        result.index < documents.length &&
                        Number.isFinite(result.score),
                )
                .toSorted((left, right) => right.score - left.score);
        },
    };

    async function request(type, path, body, timeout) {
        const span = elasticApm.startSpan(`openrouter.${type}`, 'external.openrouter');

        try {
            const data = await requestWithRetry(path, body, timeout);
            const transaction = elasticApm.currentTransaction;
            span?.setOutcome('success');
            if (data.model) {
                transaction?.setLabel(`openrouter.${type}.model`, data.model);
                span?.setLabel('openrouter_model', data.model);
            }
            if (data.provider) {
                transaction?.setLabel(`openrouter.${type}.provider`, data.provider);
                span?.setLabel('openrouter_provider', data.provider);
            }
            if (data.usage) {
                elasticApm.setCustomContext({
                    [type]: {
                        prompt_tokens: data.usage.prompt_tokens,
                        completion_tokens: data.usage.completion_tokens,
                        total_tokens: data.usage.total_tokens,
                        cost: data.usage.cost,
                    },
                });
            }
            return data;
        } catch (error) {
            span?.setOutcome('failure');
            throw error;
        } finally {
            span?.end();
        }
    }

    async function requestWithRetry(path, body, timeout) {
        for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt += 1) {
            try {
                const response = await fetch(`${BASE_URL}${path}`, {
                    method: 'POST',
                    headers: {
                        authorization: `Bearer ${apiKey}`,
                        'content-type': 'application/json',
                    },
                    body: JSON.stringify({
                        ...body,
                        provider: { ignore: config.excludedProviders },
                    }),
                    signal: AbortSignal.timeout(timeout),
                });

                if (!response.ok) {
                    const error = new Error(`OpenRouter request failed (${response.status}): ${await response.text()}`);
                    error.status = response.status;
                    throw error;
                }

                return response.json();
            } catch (error) {
                if (attempt === RETRY_ATTEMPTS || !isRetryable(error)) throw error;
                await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY * attempt));
            }
        }
    }
}

function isRetryable(error) {
    return !error.status || RETRYABLE_STATUS_CODES.includes(error.status);
}
