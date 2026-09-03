import { createClient } from 'redis';

export async function connectOwORedis(url, log) {
    const client = createClient({
        url,
        socket: { reconnectStrategy: false },
    });
    client.on('error', (error) => log.error('OwO Redis client error', { error }));

    try {
        await client.connect();
    } catch (error) {
        client.destroy();
        throw error;
    }

    return client;
}
