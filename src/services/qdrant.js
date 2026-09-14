import { QdrantClient, QdrantClientResourceExhaustedError } from '@qdrant/js-client-rest';

export async function connectQdrant(url, apiKey) {
    const client = new QdrantClient({
        url,
        apiKey,
        // The SDK's global timer overrides per-request signals. Own HTTP deadlines
        // here; Qdrant's `timeout` body/query field is a different, server-side limit.
        timeout: Infinity,
        checkCompatibility: false,
    });
    const api = client.api();
    await requestWithRetry((signal) => api.root({}, { signal }));

    return {
        query: (collection_name, body, options) => result(api.queryPoints, { collection_name, ...body }, options),
        scroll: (collection_name, body) => result(api.scrollPoints, { collection_name, ...body }),
        count: (collection_name) => result(api.countPoints, { collection_name, exact: true }),
        delete: (collection_name, body) => result(api.deletePoints, { collection_name, ...body }),
        upsert: (collection_name, body) => result(api.upsertPoints, { collection_name, ...body }),
        batchUpdate: (collection_name, body) => result(api.batchUpdate, { collection_name, ...body }),
        collectionExists: (collection_name) => result(api.collectionExists, { collection_name }),
        createCollection: (collection_name, body) => result(api.createCollection, { collection_name, ...body }),
        deleteCollection: (collection_name) => result(api.deleteCollection, { collection_name }),
        createPayloadIndex: (collection_name, body) => result(api.createFieldIndex, { collection_name, ...body }),
    };
}

async function result(method, body, options) {
    const response = await requestWithRetry((signal) => method(body, { signal }), options);
    if (response.data.result == null) throw new Error('Result came uninitialized');
    return response.data.result;
}

async function requestWithRetry(request, { timeout = 15_000, attempts = 3 } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try {
            return await request(controller.signal);
        } catch (error) {
            const retryable =
                controller.signal.aborted ||
                [408, 425, 429, 500, 502, 503, 504].includes(error.status) ||
                error instanceof QdrantClientResourceExhaustedError ||
                ['EPIPE', 'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED'].includes(error.code ?? error.cause?.code);
            if (attempt === attempts || !retryable) throw error;
        } finally {
            clearTimeout(timer);
        }
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
}
