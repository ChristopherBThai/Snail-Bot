import { expect, test, vi } from 'vitest';
import { loadLogLevels, saveLogLevel } from '../src/systems/logger/data.js';
import { createLogging, LogLevels } from '../src/systems/logger/index.js';

test('logging keeps bounded structured entries', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const logging = createLogging({ limit: 2 });
    const logger = logging.createLogger({
        console: true,
        sourceID: 'runtime'
    });

    logger.info('first', { value: 1 });
    logger.warn('second', { value: 2 });
    logger.error('third', { value: 3 });

    expect(info).toHaveBeenCalledWith('[info] first', { value: 1 });
    expect(warn).toHaveBeenCalledWith('[warn] second', { value: 2 });
    expect(error).toHaveBeenCalledWith('[error] third', { value: 3 });
    expect(logger.getEntries()).toMatchObject([
        { sourceID: 'runtime', level: 'warn', type: 'second', data: { value: 2 } },
        { sourceID: 'runtime', level: 'error', type: 'third', data: { value: 3 } }
    ]);

    info.mockRestore();
    warn.mockRestore();
    error.mockRestore();
});

test('logging filters by source', () => {
    const logging = createLogging({ limit: 10 });
    const system = logging.createLogger({ level: LogLevels.Trace, sourceID: 'runtime' });
    const module = logging.createLogger({ sourceID: 'quest_list' });

    system.trace('startup.trace');
    system.info('startup.begin');
    module.warn('quest_list.warning');

    expect(logging.getEntries({ sourceID: 'runtime' }).map((entry) => entry.type)).toEqual([
        'startup.trace',
        'startup.begin'
    ]);
    expect(logging.getEntries({ sourceID: 'quest_list' }).map((entry) => entry.type)).toEqual(['quest_list.warning']);
    expect(logging.getEntries().map((entry) => entry.type)).toEqual([
        'startup.trace',
        'startup.begin',
        'quest_list.warning'
    ]);
});

test('loggers read only their own source entries', () => {
    const logging = createLogging({ limit: 10 });
    const system = logging.createLogger({ sourceID: 'runtime' });
    const module = logging.createLogger({ sourceID: 'quest_list' });

    system.info('startup.begin');
    module.info('quest_list.started');

    expect(system.getEntries().map((entry) => entry.type)).toEqual(['startup.begin']);
    expect(module.getEntries().map((entry) => entry.type)).toEqual(['quest_list.started']);
});

test('filtered source logs are retained separately from the global timeline', () => {
    const logging = createLogging({ limit: 2 });
    const system = logging.createLogger({ sourceID: 'runtime' });
    const module = logging.createLogger({ sourceID: 'quest_list' });

    system.info('startup.begin');
    system.warn('startup.warning');
    module.info('quest_list.first');
    module.info('quest_list.second');

    expect(logging.getEntries().map((entry) => entry.type)).toEqual(['quest_list.first', 'quest_list.second']);
    expect(logging.getEntries({ sourceID: 'runtime' }).map((entry) => entry.type)).toEqual([
        'startup.begin',
        'startup.warning'
    ]);
    expect(logging.getEntries({ sourceID: 'quest_list' }).map((entry) => entry.type)).toEqual([
        'quest_list.first',
        'quest_list.second'
    ]);
});

test('logger exposes level methods without a generic public log method', () => {
    const logging = createLogging({ limit: 10 });
    const logger = logging.createLogger({ level: LogLevels.Trace, sourceID: 'runtime' });

    expect(logger.log).toBeUndefined();
    expect(logger.trace('startup.trace')).toMatchObject({ level: 'trace', type: 'startup.trace' });
});

test('child loggers bind context to entries', () => {
    const logging = createLogging({ limit: 10 });
    const logger = logging.createLogger({
        context: { interactionID: 'interaction-1', userID: 'user-1' },
        sourceID: 'runtime'
    });

    logger.child({ commandName: 'tag get' }).info('tag.get.started', { tagName: 'orange' });

    expect(logger.getEntries()[0]).toMatchObject({
        type: 'tag.get.started',
        data: {
            commandName: 'tag get',
            interactionID: 'interaction-1',
            tagName: 'orange',
            userID: 'user-1'
        }
    });
});

test('errors are serialized consistently', () => {
    const logging = createLogging({ limit: 10 });
    const logger = logging.createLogger({ level: LogLevels.Debug, sourceID: 'runtime' });
    const error = new Error('Discord exploded', { cause: new Error('Unknown interaction') });

    error.status = 404;
    logger.error('discord.interaction.failed', { error });

    expect(logger.getEntries()[0].data.error).toMatchObject({
        name: 'Error',
        message: 'Discord exploded',
        status: 404,
        cause: {
            name: 'Error',
            message: 'Unknown interaction'
        }
    });
    expect(logger.getEntries()[0].data.error.stack).toEqual(expect.any(String));
});

test('timers log duration data', () => {
    const logging = createLogging({ limit: 10 });
    const logger = logging.createLogger({ level: LogLevels.Debug, sourceID: 'runtime' });
    const timer = logger.time('message_builder.panel_update', { blockCount: 3 });

    timer.end({ fileCount: 0 });

    expect(logger.getEntries()[0]).toMatchObject({
        level: 'debug',
        type: 'message_builder.panel_update',
        data: {
            blockCount: 3,
            duration: expect.any(Number),
            fileCount: 0
        }
    });
});

test('module logs do not print to console by default', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const logging = createLogging({ limit: 10 });
    const module = logging.createLogger({ sourceID: 'quest_list' });

    module.info('quest_list.quiet');

    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
});

test('source levels are shared by all loggers for the same source', () => {
    const logging = createLogging({ limit: 10 });
    const first = logging.createLogger({ level: LogLevels.Info, sourceID: 'discord' });
    const second = logging.createLogger({ sourceID: 'discord' });

    second.debug('discord.filtered');
    logging.setLevel('discord', LogLevels.Debug);
    first.debug('discord.visible');

    expect(first.level).toBe(LogLevels.Debug);
    expect(second.level).toBe(LogLevels.Debug);
    expect(logging.getEntries({ sourceID: 'discord' }).map((entry) => entry.type)).toEqual(['discord.visible']);
});

test('logging exposes registered sources with live levels and sizes', () => {
    const logging = createLogging({ limit: 10, levels: { discord: LogLevels.Warn } });
    const runtime = logging.createLogger({ sourceID: 'runtime' });
    const discord = logging.createLogger({ sourceID: 'discord' });

    runtime.info('startup.begin');
    discord.info('discord.filtered');
    discord.error('discord.failed');

    expect(logging.getSources()).toEqual([
        { sourceID: 'discord', level: LogLevels.Warn, logsLimit: 10, logsSize: 1 },
        { sourceID: 'runtime', level: LogLevels.Info, logsLimit: 10, logsSize: 1 }
    ]);
});

test('unknown source levels default to info', () => {
    const logging = createLogging({ limit: 10 });

    expect(logging.getLevel('runtime')).toBe(LogLevels.Info);
});

test('log levels load and save through snail config', async () => {
    const updates = [];
    const databases = {
        snail: {
            mongo: {
                Config: {
                    find(query) {
                        expect(query).toEqual({ _id: { $regex: '^logging_level_' } });
                        return {
                            lean: async () => [
                                { _id: 'logging_level_runtime', value: LogLevels.Warn },
                                { _id: 'logging_level_discord', value: LogLevels.Debug }
                            ]
                        };
                    },
                    async updateOne(filter, update, options) {
                        updates.push({ filter, options, update });
                    }
                }
            }
        }
    };

    await expect(loadLogLevels(databases)).resolves.toEqual({
        discord: LogLevels.Debug,
        runtime: LogLevels.Warn
    });

    await saveLogLevel(databases, 'runtime', LogLevels.Error);

    expect(updates).toEqual([
        {
            filter: { _id: 'logging_level_runtime' },
            update: { $set: { value: LogLevels.Error } },
            options: { upsert: true }
        }
    ]);
});
