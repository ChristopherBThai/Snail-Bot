import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { loadConfig } from './index.js';

const discordIdPattern = /^\d{17,20}$/;

beforeEach(() => {
    vi.stubEnv('DEBUG', 'false');
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('loadConfig', () => {
    test('keeps Discord application and guild ids in source config', async () => {
        const config = await loadConfig();

        expect(config.debug).toBe(false);
        expect(config.discord.applicationId).toMatch(discordIdPattern);
        expect(config.discord.guildId).toMatch(discordIdPattern);
    });

    test('keeps staff auth ids in source config', async () => {
        const config = await loadConfig();

        expect(config.users.owner).toMatch(discordIdPattern);
        expect(config.roles.admin.length).toBeGreaterThan(0);
        expect(config.roles.manager.length).toBeGreaterThan(0);

        for (const roleId of [...config.roles.admin, ...config.roles.manager]) {
            expect(roleId).toMatch(discordIdPattern);
        }
    });

    test.each([
        ['missing token', undefined, null],
        ['blank token', '   ', null],
        ['raw token', 'test-token', 'test-token'],
        ['Bot-prefixed token', 'Bot test-token', 'test-token']
    ])('maps Discord bot token from the environment: %s', async (_name, envValue, expectedToken) => {
        vi.stubEnv('BOT_TOKEN', envValue);

        const config = await loadConfig();

        expect(config.discord.token).toBe(expectedToken);
    });

    test('maps database connection environment values', async () => {
        vi.stubEnv('SNAIL_MONGO_URI', 'snail-mongo');
        vi.stubEnv('OWO_MONGO_URI', 'owo-mongo');
        vi.stubEnv('OWO_REDIS_URL', 'owo-redis');
        vi.stubEnv('OWO_MYSQL_URI', 'owo-mysql');

        const config = await loadConfig();

        expect(config.databases).toEqual({
            snailMongoUri: 'snail-mongo',
            owoMongoUri: 'owo-mongo',
            owoRedisUrl: 'owo-redis',
            owoMysqlUri: 'owo-mysql'
        });
    });
});
