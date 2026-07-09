import { ApplicationCommandType } from 'discord-api-types/v10';
import { expect, test, vi } from 'vitest';
import moduleCommand, {
    buildModuleOverview,
    buildModulePanel,
    getModulePageActionID,
    ModulePanelIDs,
    ModuleRuntimePageID
} from '../src/commands/module.js';
import { LogLevels, Module, ModuleRegistry } from '../src/modules/index.js';
import { textDisplay } from '../src/systems/discord/components.js';
import { createDiscordEventRouter } from '../src/systems/discord/event-router.js';
import { createLogging } from '../src/systems/logger/index.js';

test('persisted disabled modules skip startup activation and activate when enabled', async () => {
    const databases = createDatabases({ test_module_enabled: false });
    const module = new TestModule({ databases });
    const modules = new ModuleRegistry([module]);

    await modules.init();

    expect(module.state()).toMatchObject({
        enabled: false
    });
    expect(module.enableCalls).toBe(0);

    await modules.enable(module, createContext());

    expect(databases.snail.mongo.values.get('test_module_enabled')).toBe(true);
    expect(module.state()).toMatchObject({
        enabled: true
    });
    expect(module.enableCalls).toBe(1);
});

test('non-toggleable modules stay enabled and show as always on', async () => {
    const databases = createDatabases({ always_on_enabled: false });
    const module = new TestModule({ databases, id: 'always_on', toggleable: false });
    const modules = new ModuleRegistry([module]);

    await modules.init();
    await modules.disable(module);

    const panel = buildModulePanel(createContext({ modules }), module);
    const statusSection = findSectionByContent(panel, '**Status**');

    expect(module.state()).toMatchObject({
        enabled: true,
        toggleable: false
    });
    expect(statusSection.components[0].content).toContain('Always on');
    expect(statusSection.accessory).toMatchObject({
        disabled: true,
        label: 'Always On'
    });
});

test('module panel shows log usage as size over limit', async () => {
    const module = new TestModule({ logsLimit: 3 });
    const modules = new ModuleRegistry([module]);

    module.logger.info('first');
    module.logger.info('second');

    const panel = buildModulePanel(createContext({ modules }), module);
    const logsSection = findSectionByContent(panel, '**Logs**');

    expect(logsSection.components[0].content).toContain('2/3 entries');
});

test('module log level filters retained logs and persists updates', async () => {
    const databases = createDatabases({ test_module_log_level: 'warn' });
    const module = new TestModule({ databases });
    const modules = new ModuleRegistry([module]);

    await modules.init();
    module.logger.info('test.info');
    module.logger.warn('test.warn');

    expect(module.logLevel).toBe('warn');
    expect(module.getLogs().map((entry) => entry.type)).toEqual(['test.warn']);

    await module.setLogLevel(LogLevels.Debug);

    expect(databases.snail.mongo.values.get('test_module_log_level')).toBe('debug');
    expect(module.logLevel).toBe('debug');
});

test('module config persistence logs storage operations without values', async () => {
    const module = new TestModule();

    module.logger.setLevel(LogLevels.Debug);
    await module.setConfig('sample_key', 'stored value');
    await module.setConfig('sample_key', null);

    expect(module.getLogs()).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                level: LogLevels.Debug,
                type: 'module.config.updated',
                data: {
                    key: 'sample_key',
                    duration: expect.any(Number)
                }
            }),
            expect.objectContaining({
                level: LogLevels.Debug,
                type: 'module.config.deleted',
                data: {
                    key: 'sample_key',
                    duration: expect.any(Number)
                }
            })
        ])
    );
    expect(JSON.stringify(module.getLogs())).not.toContain('stored value');
});

test('module creates per-module log IDs', () => {
    const module = new TestModule({ id: 'log_test' });

    expect(module.createLogID('action')).toBe('log_test.action.1');
    expect(module.createLogID('action')).toBe('log_test.action.2');
});

test('module getLogs returns only that module from shared logging', () => {
    const logging = createLogging({ limit: 10 });
    const left = new TestModule({ id: 'left_module', logging });
    const right = new TestModule({ id: 'right_module', logging });

    left.logger.info('left.event');
    right.logger.info('right.event');

    expect(left.getLogs().map((entry) => entry.type)).toEqual(['left.event']);
    expect(right.getLogs().map((entry) => entry.type)).toEqual(['right.event']);
});

test('module overview shows module sections with open buttons', () => {
    const module = new TestModule({ description: 'Useful test module.' });
    const modules = new ModuleRegistry([module]);
    const overview = buildModuleOverview(createContext({ modules }));
    const moduleSection = findSectionByContent(overview, 'Useful test module.');

    expect(moduleSection.components[0].content).toContain('Useful test module.');
    expect(moduleSection.accessory).toMatchObject({
        custom_id: `${ModulePanelIDs.OpenPrefix}${module.id}`,
        label: 'Open'
    });
});

test('module overview does not include all logs export', () => {
    const modules = new ModuleRegistry([]);
    const overview = buildModuleOverview(createContext({ modules }));
    const content = JSON.stringify(overview);

    expect(content).not.toContain('Export All Logs');
    expect(moduleCommand.components.some((component) => component.customID === 'module_panel:all_logs')).toBe(false);
});

test('module panel exports module logs', async () => {
    const module = new TestModule();
    const modules = new ModuleRegistry([module]);
    const rest = createRestMock();

    module.logger.error('module.failed');

    const router = createTestRouter({
        commands: [moduleCommand],
        config: testConfig(),
        modules,
        rest
    });

    await router.route(componentInteraction(`${ModulePanelIDs.LogsPrefix}${module.id}`));

    expect(rest.responses[0].message.files[0]).toMatchObject({
        name: expect.stringMatching(/^test_module-logs-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/),
        blob: expect.any(Blob)
    });
    await expect(readJsonFile(rest.responses[0].message.files[0])).resolves.toMatchObject([
        { sourceID: 'test_module', type: 'module.failed' }
    ]);
    expect(rest.edits).toHaveLength(0);
});

test('module panel uses configured UI colors', () => {
    const module = new TestModule();
    const modules = new ModuleRegistry([module]);
    const panel = buildModulePanel(
        createContext({
            config: {
                colors: {
                    success: 0x123456
                }
            },
            modules
        }),
        module
    );

    expect(panel.components[0].accent_color).toBe(0x123456);
});

test('module panel exposes state export and log level controls', () => {
    const module = new TestModule();
    const modules = new ModuleRegistry([module]);
    const panel = buildModulePanel(createContext({ modules }), module);
    const container = panel.components[0];
    const content = JSON.stringify(container);

    expect(content).toContain(`${ModulePanelIDs.StatePrefix}${module.id}`);
    expect(content).toContain(`${ModulePanelIDs.LogLevelPrefix}${module.id}`);
    expect(content).toContain('**State Export**');
    expect(content).toContain('Export Logs');
    expect(content).toContain('**Log Level**');
    for (const level of Object.values(LogLevels)) {
        expect(content).toContain(level);
    }
});

test('module panel renders feature pages with shared navigation', async () => {
    const module = new PagedTestModule();
    const modules = new ModuleRegistry([module]);
    const overview = buildModulePanel(createContext({ modules }), module);
    const runtime = buildModulePanel(createContext({ modules }), module, { pageID: ModuleRuntimePageID });
    const rest = createRestMock();
    const router = createTestRouter({
        commands: [moduleCommand],
        modules,
        rest
    });

    expect(JSON.stringify(overview)).toContain('Feature overview');
    expect(JSON.stringify(overview)).toContain(getModulePageActionID(module.id, ModuleRuntimePageID));
    expect(JSON.stringify(runtime)).toContain('**Status**');

    await router.route(componentInteraction(getModulePageActionID(module.id, 'details')));

    expect(JSON.stringify(rest.edits[0].message)).toContain('Feature details');
});

test('module command autocompletes module names and IDs', () => {
    const modules = new ModuleRegistry([
        new TestModule({ id: 'quest_list', name: 'Quest List' }),
        new TestModule({ id: 'logger', name: 'Logger' })
    ]);
    const choices = moduleCommand.autocomplete(
        createContext({
            modules,
            data: {
                options: [{ name: 'module', value: 'quest', focused: true }]
            }
        })
    );

    expect(choices).toEqual([{ name: 'Quest List (quest_list)', value: 'quest_list' }]);
});

test('module logs limit is provided at construction', () => {
    const module = new TestModule({ logsLimit: 7 });

    expect(module.logsLimit).toBe(7);
});

test('module constructor throws when logs limit is missing', () => {
    expect(() => new TestModule({ logsLimit: undefined })).toThrow('Module logsLimit must be a positive integer.');
});

test('router supports command-owned modal prefix routes', async () => {
    let handled;
    const command = {
        definition: {
            name: 'test',
            description: 'Test command.'
        },
        handle() {},
        modals: [
            {
                prefix: 'test_modal:',
                handle(context, route) {
                    handled = {
                        customID: context.customID,
                        modalValues: context.modalValues,
                        prefix: route.prefix
                    };
                }
            }
        ]
    };
    const router = createTestRouter({
        commands: [command],
        config: testConfig(),
        modules: new ModuleRegistry([]),
        rest: {}
    });

    await router.route(modalInteraction('test_modal:alpha', textInputComponent('name', 'Snail')));

    expect(handled).toEqual({
        customID: 'test_modal:alpha',
        modalValues: { name: 'Snail' },
        prefix: 'test_modal:'
    });
});

test('router supports top-level component and modal routes', async () => {
    const handled = [];
    const router = createTestRouter({
        commands: [],
        components: [
            {
                prefix: 'global_component:',
                handle(context, route) {
                    handled.push({ customID: context.customID, prefix: route.prefix, type: 'component' });
                }
            }
        ],
        config: testConfig(),
        modals: [
            {
                prefix: 'global_modal:',
                handle(context, route) {
                    handled.push({
                        customID: context.customID,
                        modalValues: context.modalValues,
                        prefix: route.prefix,
                        type: 'modal'
                    });
                }
            }
        ],
        modules: new ModuleRegistry([]),
        rest: {}
    });

    await router.route(componentInteraction('global_component:alpha'));
    await router.route(modalInteraction('global_modal:beta', textInputComponent('name', 'Snail')));

    expect(handled).toEqual([
        { customID: 'global_component:alpha', prefix: 'global_component:', type: 'component' },
        {
            customID: 'global_modal:beta',
            modalValues: { name: 'Snail' },
            prefix: 'global_modal:',
            type: 'modal'
        }
    ]);
});

test('router exposes message context command targets', async () => {
    let handled;
    const command = {
        definition: {
            name: 'edit',
            type: ApplicationCommandType.Message
        },
        handle(context) {
            handled = {
                applicationID: context.applicationID,
                target: context.target,
                targetID: context.targetID
            };
        }
    };
    const router = createTestRouter({
        commands: [command],
        config: testConfig(),
        modules: new ModuleRegistry([]),
        rest: {}
    });
    const target = { id: 'message-1', content: 'hello' };

    await router.route({
        t: 'INTERACTION_CREATE',
        d: {
            id: 'interaction-edit',
            token: 'token',
            type: 2,
            data: {
                name: 'edit',
                target_id: 'message-1',
                type: ApplicationCommandType.Message,
                resolved: {
                    messages: {
                        'message-1': target
                    }
                }
            },
            member: { user: { id: 'manager-1' }, roles: [] }
        }
    });

    expect(handled).toEqual({
        applicationID: 'bot-application',
        target,
        targetID: 'message-1'
    });
});

test('router rejects duplicate top-level and command route prefixes', () => {
    expect(() =>
        createTestRouter({
            commands: [
                {
                    components: [{ prefix: 'duplicate:', handle() {} }],
                    definition: {
                        name: 'test',
                        description: 'Test command.'
                    },
                    handle() {}
                }
            ],
            components: [{ prefix: 'duplicate:', handle() {} }],
            config: testConfig(),
            modules: new ModuleRegistry([]),
            rest: {}
        })
    ).toThrow('Duplicate component route prefix: duplicate:');
});

test('router applies command cooldowns per user', async () => {
    const handle = vi.fn();
    const respond = vi.fn();
    const command = {
        cooldown: 5_000,
        definition: {
            name: 'cooldown_test',
            description: 'Test command cooldowns.'
        },
        handle
    };
    const router = createTestRouter({
        commands: [command],
        config: testConfig(),
        modules: new ModuleRegistry([]),
        rest: { respond }
    });

    await router.route(commandInteraction('cooldown_test', { userID: 'user-1' }));
    await router.route(commandInteraction('cooldown_test', { userID: 'user-1' }));
    await router.route(commandInteraction('cooldown_test', { userID: 'user-2' }));

    expect(handle).toHaveBeenCalledTimes(2);
    expect(respond).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(respond.mock.calls[0][1])).toMatch(/Try that again <t:\d+:R>\./);
});

test('router edits deferred replies when handlers throw after defer', async () => {
    const defer = vi.fn();
    const editReply = vi.fn();
    const respond = vi.fn();
    const logging = createLogging({ limit: 100 });
    const logger = logging.createLogger({ sourceID: 'runtime' });
    const command = {
        definition: {
            name: 'deferred_error_test',
            description: 'Test deferred error handling.'
        },
        async handle(context) {
            await context.defer({ ephemeral: true });
            throw new Error('after defer');
        }
    };
    const router = createTestRouter({
        commands: [command],
        config: testConfig(),
        logger,
        logging,
        modules: new ModuleRegistry([]),
        rest: { defer, editReply, respond }
    });

    await router.route(commandInteraction('deferred_error_test'));

    expect(defer).toHaveBeenCalledTimes(1);
    expect(editReply).toHaveBeenCalledTimes(1);
    expect(respond).not.toHaveBeenCalled();
    expect(JSON.stringify(editReply.mock.calls[0][1])).toContain(
        'Something went wrong while handling that interaction.'
    );
    expect(logger.getEntries()).toContainEqual(
        expect.objectContaining({
            level: LogLevels.Error,
            type: 'discord.interaction.handler_error',
            data: expect.objectContaining({
                error: expect.objectContaining({ message: 'after defer' })
            })
        })
    );
});

test('module-owned commands preserve staff visibility and cooldown metadata', () => {
    const module = new TestModule();

    module.addCommand({
        staff: true,
        cooldown: 2_500,
        definition: {
            name: 'test_command',
            description: 'Test command.'
        },
        handle() {}
    });

    expect(module.interactionRoutes.commands[0]).toMatchObject({
        staff: true,
        cooldown: 2_500
    });
});

class TestModule extends Module {
    enableCalls = 0;

    constructor(options = {}) {
        super({
            id: 'test_module',
            databases: createDatabases(),
            logging: createLogging({ limit: options.logsLimit ?? 50_000 }),
            name: 'Test Module',
            logsLimit: 50_000,
            ...options
        });
    }

    async onEnable() {
        this.enableCalls++;
    }
}

class PagedTestModule extends TestModule {
    panelDefaultPageID() {
        return 'overview';
    }

    panelPages() {
        return [
            {
                id: 'overview',
                label: 'Overview',
                components: [textDisplay('Feature overview')]
            },
            {
                id: 'details',
                label: 'Details',
                components: [textDisplay('Feature details')]
            }
        ];
    }
}

function createDatabases(values = {}) {
    const configValues = new Map(Object.entries(values));

    return {
        snail: {
            mongo: {
                values: configValues,
                Config: {
                    findById(key) {
                        return {
                            lean: async () => {
                                if (!configValues.has(key)) {
                                    return undefined;
                                }

                                return { _id: key, value: configValues.get(key) };
                            }
                        };
                    },
                    async deleteOne({ _id: key }) {
                        configValues.delete(key);
                    },
                    async updateOne({ _id: key }, update) {
                        configValues.set(key, update.$set.value);
                    }
                }
            }
        }
    };
}

function createRestMock() {
    return {
        edits: [],
        responses: [],
        async edit(interaction, message) {
            this.edits.push({ interaction, message });
        },
        async respond(interaction, message) {
            this.responses.push({ interaction, message });
        }
    };
}

function createTestRouter({
    commands,
    components,
    config = testConfig(),
    logger,
    logging,
    modals,
    modules = new ModuleRegistry([]),
    rest
}) {
    const routerLogging = logging ?? createLogging({ limit: 100 });

    return createDiscordEventRouter({
        commands,
        components,
        config,
        logger: logger ?? routerLogging.createLogger({ sourceID: 'runtime' }),
        modals,
        modules,
        rest
    });
}

function createContext({ config = testConfig(), data = {}, modules = new ModuleRegistry([]) } = {}) {
    return { config, data, modules };
}

function testConfig() {
    return {
        colors: {
            primary: 0x5865f2,
            success: 0x2ecc71,
            warning: 0xf1c40f,
            danger: 0xe74c3c,
            neutral: 0x95a5a6
        },
        discord: {
            applicationId: 'bot-application'
        },
        roles: {
            admin: [],
            helper: [],
            manager: []
        },
        users: {
            owner: 'manager-1'
        }
    };
}

function findSectionByContent(panel, content) {
    return panel.components[0].components.find((component) =>
        component.components?.some((child) => child.content?.includes(content))
    );
}

function modalInteraction(customID, component) {
    return {
        t: 'INTERACTION_CREATE',
        d: {
            id: `interaction-${customID}`,
            token: 'token',
            type: 5,
            data: { custom_id: customID, components: [component] },
            member: { user: { id: 'manager-1' }, roles: [] }
        }
    };
}

function componentInteraction(customID, data = {}) {
    return {
        t: 'INTERACTION_CREATE',
        d: {
            id: `interaction-${customID}`,
            token: 'token',
            type: 3,
            data: { custom_id: customID, ...data },
            member: { user: { id: 'manager-1' }, roles: [] }
        }
    };
}

function commandInteraction(name, { userID = 'manager-1' } = {}) {
    return {
        t: 'INTERACTION_CREATE',
        d: {
            id: `interaction-${name}-${userID}`,
            token: 'token',
            type: 2,
            data: { name },
            member: { user: { id: userID }, roles: [] }
        }
    };
}

function textInputComponent(customID, value) {
    return {
        components: [
            {
                custom_id: customID,
                value
            }
        ]
    };
}

async function readJsonFile(file) {
    return JSON.parse(await file.blob.text());
}
