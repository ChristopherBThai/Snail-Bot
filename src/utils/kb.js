const axios = require('axios');

const QDRANT_TIMEOUT = 15000;
const EMBED_TIMEOUT = 30000;
const CHAT_TIMEOUT = 60000;
const SCROLL_BATCH = 256;
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

class Qdrant {
    constructor({ url, apiKey }) {
        this.client = axios.create({
            baseURL: url,
            timeout: QDRANT_TIMEOUT,
            headers: apiKey ? { 'api-key': apiKey } : {},
        });
    }

    async ensureCollection(name, vectorSize) {
        try {
            await this.client.get(`/collections/${name}`);
        } catch (err) {
            if (err.response?.status !== 404) throw err;
            await this.client.put(`/collections/${name}`, {
                vectors: { size: vectorSize, distance: 'Cosine' },
            });
        }

        // Payload indexes — safe to retry; Qdrant errors on duplicate which we ignore
        for (const field of ['tag_id', 'kind']) {
            try {
                await this.client.put(`/collections/${name}/index`, {
                    field_name: field,
                    field_schema: 'keyword',
                });
            } catch (err) {
                // Index may already exist
                if (err.response?.status !== 400 && err.response?.status !== 409) throw err;
            }
        }
    }

    async resetCollection(name, vectorSize) {
        try {
            await this.client.delete(`/collections/${name}`);
        } catch (err) {
            if (err.response?.status !== 404) throw err;
        }
        await this.ensureCollection(name, vectorSize);
    }

    async search(name, { vector, limit, scoreThreshold, filter }) {
        const body = {
            vector,
            limit,
            with_payload: true,
        };
        if (scoreThreshold != null) body.score_threshold = scoreThreshold;
        if (filter) body.filter = filter;

        const res = await this.client.post(`/collections/${name}/points/search`, body);
        return res.data.result;
    }

    async upsert(name, points) {
        await this.client.put(`/collections/${name}/points?wait=true`, { points });
    }

    async setPayload(name, pointId, payload) {
        await this.client.post(`/collections/${name}/points/payload?wait=true`, {
            payload,
            points: [pointId],
        });
    }

    async deletePoints(name, ids) {
        await this.client.post(`/collections/${name}/points/delete?wait=true`, {
            points: ids,
        });
    }

    async scrollAll(name, payloadFields, filter) {
        const results = [];
        let offset = undefined;
        let done = false;
        while (!done) {
            const body = {
                limit: SCROLL_BATCH,
                with_payload: payloadFields ?? true,
                with_vector: false,
            };
            if (offset != null) body.offset = offset;
            if (filter) body.filter = filter;

            const res = await this.client.post(`/collections/${name}/points/scroll`, body);
            const data = res.data.result;
            results.push(...data.points);
            offset = data.next_page_offset;
            if (offset == null) done = true;
        }
        return results;
    }

    async deleteByFilter(name, filter) {
        await this.client.post(`/collections/${name}/points/delete?wait=true`, { filter });
    }

    async count(name) {
        const res = await this.client.post(`/collections/${name}/points/count`, { exact: true });
        return res.data.result.count;
    }
}

async function embed({ apiKey, model, inputs }) {
    if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY');
    if (!inputs.length) return [];

    const res = await axios.post(
        `${OPENROUTER_BASE}/embeddings`,
        { model, input: inputs },
        {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: EMBED_TIMEOUT,
        }
    );
    return res.data.data.map((d) => d.embedding);
}

async function chat({ apiKey, model, messages, maxTokens, temperature }) {
    if (!apiKey) throw new Error('Missing OPENROUTER_API_KEY');

    const res = await axios.post(
        `${OPENROUTER_BASE}/chat/completions`,
        {
            model,
            messages,
            max_tokens: maxTokens,
            temperature,
        },
        {
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: CHAT_TIMEOUT,
        }
    );
    return {
        content: String(res.data?.choices?.[0]?.message?.content ?? '').trim(),
        usage: res.data.usage,
    };
}

module.exports = { Qdrant, embed, chat };
