import { QdrantClient } from '@qdrant/js-client-rest';

// Retry individual Qdrant requests, never the surrounding embedding or sync work.
export async function requestQdrant(operation, attempts = 3) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await operation();
        } catch (error) {
            if (attempt >= attempts || !isTransientQdrantError(error)) throw error;
            await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
    }
}

function isTransientQdrantError(error) {
    if ([408, 425, 429, 500, 502, 503, 504].includes(error?.status)) return true;
    if (['QdrantClientTimeoutError', 'QdrantClientResourceExhaustedError'].includes(error?.name)) return true;
    return [
        'EPIPE',
        'ECONNRESET',
        'ETIMEDOUT',
        'ECONNABORTED',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_BODY_TIMEOUT',
        'UND_ERR_SOCKET',
    ].includes(error?.cause?.code ?? error?.code);
}

export async function connectQdrant(url, apiKey) {
    const client = new QdrantClient({
        url,
        apiKey,
        timeout: 15_000,
        checkCompatibility: false,
    });
    await client.versionInfo();
    return client;
}
