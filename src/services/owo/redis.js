import { createClient } from 'redis';

export async function connectOwORedis(url) {
    const client = createClient({
        url,
        socket: { reconnectStrategy: false },
    });
    client.on('error', () => {});

    try {
        await client.connect();
    } catch (error) {
        client.destroy();
        throw error;
    }

    return client;
}
