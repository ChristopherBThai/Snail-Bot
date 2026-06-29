import { expect, test } from 'vitest';
import logsCommand, { buildLogsPanel, LogsPanelIDs } from '../src/commands/logs.js';
import { createLogging, LogLevels } from '../src/systems/logger/index.js';

test('logs panel shows registered sources and controls', () => {
    const logging = createLogging({ limit: 5 });

    logging.createLogger({ sourceID: 'runtime' }).info('startup.begin');
    logging.createLogger({ level: LogLevels.Warn, sourceID: 'discord' }).error('discord.failed');
    logging.createLogger({ sourceID: 'quest_list' }).info('quest_list.started');

    const panel = buildLogsPanel(
        createContext({
            modules: new Map([['quest_list', {}]])
        }),
        logging,
        'discord'
    );
    const content = JSON.stringify(panel);

    expect(content).toContain('runtime');
    expect(content).toContain('discord');
    expect(content).not.toContain('quest_list');
    expect(content).toContain('Export Logs');
    expect(content).toContain(LogsPanelIDs.ExportAll);
    expect(content).not.toContain('View Source Logs');
    expect(content).toContain('Configure Log Level');
    expect(content).toContain('Choose source to configure');
    expect(content).toContain('Selected source: `discord`');
    expect(content).toContain('Set minimum level for selected source');
});

test('logs panel defaults configuration to the source placeholder', () => {
    const logging = createLogging({ limit: 5 });

    logging.createLogger({ sourceID: 'discord' }).info('discord.started');
    logging.createLogger({ sourceID: 'runtime' }).info('startup.begin');

    const panel = buildLogsPanel(createContext(), logging);
    const content = JSON.stringify(panel);

    expect(content).toContain('Choose a source to change its minimum retained log level.');
    expect(content).toContain('Choose source to configure');
    expect(content).not.toContain('Selected source:');
    expect(content).not.toContain('Set minimum level for selected source');
});

test('logs panel shows level controls only after a source is selected', () => {
    const logging = createLogging({ limit: 5 });

    logging.createLogger({ sourceID: 'discord' }).warn('discord.warning');
    logging.createLogger({ sourceID: 'runtime' }).info('startup.begin');

    const placeholderPanel = buildLogsPanel(createContext(), logging);
    const selectedPanel = buildLogsPanel(createContext(), logging, 'discord');

    expect(findStringSelect(placeholderPanel, LogsPanelIDs.SourceSelect)).toMatchObject({
        placeholder: 'Choose source to configure'
    });
    expect(findStringSelect(placeholderPanel, `${LogsPanelIDs.LevelPrefix}discord`)).toBeUndefined();
    expect(findStringSelect(selectedPanel, `${LogsPanelIDs.LevelPrefix}discord`)).toMatchObject({
        placeholder: 'Set minimum level for selected source'
    });
});

test('logs command persists non-module source log levels', async () => {
    const updates = [];
    const logging = createLogging({ limit: 10 });
    const logger = logging.createLogger({ sourceID: 'discord' });
    const command = logsCommand({
        databases: createDatabases(updates),
        logging
    });
    const context = createContext({
        customID: `${LogsPanelIDs.LevelPrefix}discord`,
        data: { values: [LogLevels.Warn] }
    });
    const route = command.components.find((component) => component.prefix === LogsPanelIDs.LevelPrefix);

    await route.handle(context, route);
    logger.info('discord.filtered');
    logger.error('discord.visible');

    expect(logging.getLevel('discord')).toBe(LogLevels.Warn);
    expect(logging.getEntries({ sourceID: 'discord' }).map((entry) => entry.type)).toEqual(['discord.visible']);
    expect(updates).toEqual([
        {
            filter: { _id: 'logging_level_discord' },
            update: { $set: { value: LogLevels.Warn } },
            options: { upsert: true }
        }
    ]);
    expect(context.edits).toHaveLength(1);
});

test('logs command rejects module sources', async () => {
    const updates = [];
    const logging = createLogging({ limit: 10 });
    const command = logsCommand({
        databases: createDatabases(updates),
        logging
    });
    const context = createContext({
        customID: `${LogsPanelIDs.LevelPrefix}quest_list`,
        data: { values: [LogLevels.Trace] },
        modules: new Map([['quest_list', {}]])
    });
    const route = command.components.find((component) => component.prefix === LogsPanelIDs.LevelPrefix);

    logging.createLogger({ sourceID: 'quest_list' });
    await route.handle(context, route);

    expect(context.responses[0]).toEqual(expect.objectContaining({ components: expect.any(Array) }));
    expect(JSON.stringify(context.responses[0])).toContain('Choose a valid log source.');
    expect(updates).toEqual([]);
});

test('logs command exports source logs as a file', async () => {
    const logging = createLogging({ limit: 10 });
    const logger = logging.createLogger({ sourceID: 'runtime' });
    const command = logsCommand({
        databases: createDatabases(),
        logging
    });

    logger.info('startup.begin', { commandCount: 3 });

    const exportContext = createContext({ customID: `${LogsPanelIDs.ExportSourcePrefix}runtime` });
    const exportRoute = command.components.find((component) => component.prefix === LogsPanelIDs.ExportSourcePrefix);
    await exportRoute.handle(exportContext, exportRoute);

    expect(exportContext.responses[0].files[0].name).toMatch(/^runtime-logs-/);
    await expect(readJsonFile(exportContext.responses[0].files[0])).resolves.toMatchObject([
        { sourceID: 'runtime', type: 'startup.begin' }
    ]);
});

test('logs command exports all sources in timeline order', async () => {
    const logging = createLogging({ limit: 10 });
    const command = logsCommand({
        databases: createDatabases(),
        logging
    });

    logging.createLogger({ sourceID: 'runtime' }).info('startup.begin');
    logging.createLogger({ sourceID: 'discord' }).warn('discord.warning');
    logging.createLogger({ sourceID: 'quest_list' }).error('quest_list.failed');

    const context = createContext({
        modules: new Map([['quest_list', {}]])
    });
    const route = command.components.find((component) => component.customID === LogsPanelIDs.ExportAll);

    await route.handle(context, route);

    await expect(readJsonFile(context.responses[0].files[0])).resolves.toMatchObject([
        { sourceID: 'runtime', type: 'startup.begin' },
        { sourceID: 'discord', type: 'discord.warning' },
        { sourceID: 'quest_list', type: 'quest_list.failed' }
    ]);
});

function createContext({
    config = testConfig(),
    customID = LogsPanelIDs.ExportAll,
    data = {},
    modules = new Map()
} = {}) {
    return {
        config,
        customID,
        data,
        edits: [],
        modules,
        responses: [],
        async edit(message) {
            this.edits.push(message);
        },
        async respond(message) {
            this.responses.push(message);
        }
    };
}

function createDatabases(updates = []) {
    return {
        snail: {
            mongo: {
                Config: {
                    async updateOne(filter, update, options) {
                        updates.push({ filter, options, update });
                    }
                }
            }
        }
    };
}

function testConfig() {
    return {
        colors: {
            primary: 0x5865f2
        }
    };
}

async function readJsonFile(file) {
    return JSON.parse(await file.blob.text());
}

function findStringSelect(message, customID) {
    return flattenComponents(message.components).find((component) => component.custom_id === customID);
}

function flattenComponents(components = []) {
    return components.flatMap((component) => [
        component,
        ...flattenComponents(component.components),
        ...flattenComponents(component.component ? [component.component] : [])
    ]);
}
