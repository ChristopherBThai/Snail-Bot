import { QdrantClient } from '@qdrant/js-client-rest';

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
