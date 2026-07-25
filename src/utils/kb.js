const axios = require('axios');

const QDRANT_TIMEOUT = 15000;
const SCROLL_BATCH = 256;
const RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 500;

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
            await requestWithRetry(() => this.client.get(`/collections/${name}`));
        } catch (err) {
            if (err.response?.status !== 404) throw err;
            try {
                await requestWithRetry(() =>
                    this.client.put(`/collections/${name}`, {
                        vectors: { size: vectorSize, distance: 'Cosine' },
                    })
                );
            } catch (createErr) {
                if (createErr.response?.status !== 409) throw createErr;
            }
        }

        // Payload indexes — safe to retry; Qdrant errors on duplicate which we ignore
        for (const field of ['tag_id', 'kind']) {
            try {
                await requestWithRetry(() =>
                    this.client.put(`/collections/${name}/index`, {
                        field_name: field,
                        field_schema: 'keyword',
                    })
                );
            } catch (err) {
                // Index may already exist
                if (err.response?.status !== 400 && err.response?.status !== 409) throw err;
            }
        }
    }

    async resetCollection(name, vectorSize) {
        try {
            await requestWithRetry(() => this.client.delete(`/collections/${name}`));
        } catch (err) {
            if (err.response?.status !== 404) throw err;
        }
        await this.ensureCollection(name, vectorSize);
    }

    async search(name, { vector, limit, scoreThreshold, filter, timeout = QDRANT_TIMEOUT, attempts = RETRY_ATTEMPTS }) {
        const body = {
            vector,
            limit,
            with_payload: true,
        };
        if (scoreThreshold != null) body.score_threshold = scoreThreshold;
        if (filter) body.filter = filter;

        const res = await requestWithRetry(
            () => this.client.post(`/collections/${name}/points/search`, body, { timeout }),
            { attempts }
        );
        return res.data.result;
    }

    async upsert(name, points) {
        await requestWithRetry(() => this.client.put(`/collections/${name}/points?wait=true`, { points }));
    }

    async setPayload(name, pointId, payload) {
        await requestWithRetry(() =>
            this.client.post(`/collections/${name}/points/payload?wait=true`, {
                payload,
                points: [pointId],
            })
        );
    }

    async deletePoints(name, ids) {
        await requestWithRetry(() =>
            this.client.post(`/collections/${name}/points/delete?wait=true`, {
                points: ids,
            })
        );
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

            const res = await requestWithRetry(() => this.client.post(`/collections/${name}/points/scroll`, body));
            const data = res.data.result;
            results.push(...data.points);
            offset = data.next_page_offset;
            if (offset == null) done = true;
        }
        return results;
    }

    async deleteByFilter(name, filter) {
        await requestWithRetry(() => this.client.post(`/collections/${name}/points/delete?wait=true`, { filter }));
    }

    async count(name) {
        const res = await requestWithRetry(() =>
            this.client.post(`/collections/${name}/points/count`, { exact: true })
        );
        return res.data.result.count;
    }
}

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

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { Qdrant };
