import { expect, test, vi } from 'vitest';
import moduleCommand, { buildModuleOverview, buildModulePanel, ModulePanelIDs } from '../src/commands/module.js';
import { Module, ModuleRegistry } from '../src/modules/index.js';
import { createInteractionRouter } from '../src/systems/discord/router.js';

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

    module.log('first');
    module.log('second');

    const panel = buildModulePanel(createContext({ modules }), module);
    const logsSection = findSectionByContent(panel, '**Logs**');

    expect(logsSection.components[0].content).toContain('2/3 entries');
});

test('module log level filters retained logs and persists updates', async () => {
    const databases = createDatabases({ test_module_log_level: 'warn' });
    const module = new TestModule({ databases });
    const modules = new ModuleRegistry([module]);

    await modules.init();
    module.log({ level: module.LogLevels.Info, type: 'test.info' });
    module.log({ level: module.LogLevels.Warn, type: 'test.warn' });

    expect(module.logLevel).toBe('warn');
    expect(module.getLogs().map((entry) => entry.type)).toEqual(['test.warn']);

    await module.setLogLevel(module.LogLevels.Debug);

    expect(databases.snail.mongo.values.get('test_module_log_level')).toBe('debug');
    expect(module.logLevel).toBe('debug');
});

test('module overview shows module sections with open buttons', () => {
    const module = new TestModule({ description: 'Useful test module.' });
    const modules = new ModuleRegistry([module]);
    const overview = buildModuleOverview(createContext({ modules }));
    const moduleSection = overview.components[0].components[2];

    expect(moduleSection.components[0].content).toContain('Useful test module.');
    expect(moduleSection.accessory).toMatchObject({
        custom_id: `${ModulePanelIDs.OpenPrefix}${module.id}`,
        label: 'Open'
    });
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
    for (const level of Object.values(module.LogLevels)) {
        expect(content).toContain(level);
    }
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
    const router = createInteractionRouter({
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
    const router = createInteractionRouter({
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
    const router = createInteractionRouter({
        commands: [command],
        config: testConfig(),
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
            name: 'Test Module',
            logsLimit: 50_000,
            ...options
        });
    }

    async onEnable() {
        this.enableCalls++;
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
