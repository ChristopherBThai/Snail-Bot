import { expect, test } from 'vitest';
import { createTagCommands, getTagBlocks } from '../src/commands/tag/index.js';
import { createLogging, LogLevels } from '../src/systems/logger/index.js';
import { BlockKinds, BuilderActions, BuilderIDs } from '../src/systems/message-builder/constants.js';
import { createContext, createDatabases, subcommand } from './helpers/tagsMessageBuilder.js';

function createCommands(options) {
    const logging = createLogging({ limit: 100 });

    logging.setLevel('message_builder', LogLevels.Trace);

    return createTagCommands({
        config: { colors: { yellow: 0xf1c40f } },
        ...options,
        logging
    });
}

test('legacy tag data renders as a text block without writing the old field', async () => {
    const databases = createDatabases({
        tags: [{ _id: 'legacy', data: 'legacy text', publicChannelIDs: [] }]
    });
    const tagCommand = createCommands({ databases }).find((command) => command.definition.name === 'tag');
    const context = createContext({
        channelID: '111111111111111111',
        data: subcommand('get', [{ name: 'name', value: 'legacy' }])
    });

    await tagCommand.handle(context);

    expect(getTagBlocks(databases.tags.get('legacy'))).toEqual([{ kind: 'text', content: 'legacy text' }]);
    expect(context.deferOptions).toBeUndefined();
    expect(context.response.allowed_mentions).toEqual({ parse: [] });
    expect(JSON.stringify(context.response.components)).toContain('legacy text');
    expect(context.response.flags & 64).toBe(64);
});

test('public tags are not ephemeral but still suppress mentions', async () => {
    const databases = createDatabases({
        tags: [
            {
                _id: 'rules',
                blocks: [{ kind: 'text', content: 'Read <@&123456789012345678>' }],
                publicChannelIDs: ['111111111111111111']
            }
        ]
    });
    const tagCommand = createCommands({ databases }).find((command) => command.definition.name === 'tag');
    const context = createContext({
        channelID: '111111111111111111',
        data: subcommand('get', [{ name: 'name', value: 'rules' }])
    });

    await tagCommand.handle(context);

    expect(context.deferOptions).toBeUndefined();
    expect(context.response.allowed_mentions).toEqual({ parse: [] });
    expect(context.response.flags & 64).toBe(0);
});

test('tag list renders names in a yellow container', async () => {
    const databases = createDatabases({
        tags: [
            { _id: 'alpha', blocks: [{ kind: BlockKinds.Text, content: 'alpha' }] },
            { _id: 'beta', blocks: [{ kind: BlockKinds.Text, content: 'beta' }] }
        ]
    });
    const tagCommand = createCommands({
        config: { colors: { yellow: 0xf1c40f } },
        databases
    }).find((command) => command.definition.name === 'tag');
    const context = createContext({ data: subcommand('list') });

    await tagCommand.handle(context);

    expect(context.response.components[0].accent_color).toBe(0xf1c40f);
    expect(context.response.components[0].components[0].content).toContain('## Tags (2)');
    expect(context.response.components[0].components[0].content).toContain('`alpha` `beta`');
});

test('tag autocomplete caches names and updates after create', async () => {
    const databases = createDatabases({
        tags: [
            { _id: 'alpha', blocks: [{ kind: BlockKinds.Text, content: 'alpha' }] },
            { _id: 'beta', blocks: [{ kind: BlockKinds.Text, content: 'beta' }] }
        ]
    });
    const commands = createCommands({ databases });
    const tagCommand = commands.find((command) => command.definition.name === 'tag');
    const manageCommand = commands.find((command) => command.definition.name === 'tag-manage');

    const first = await tagCommand.autocomplete(
        createContext({ data: subcommand('get', [{ name: 'name', value: 'al', focused: true }]) })
    );
    const second = await tagCommand.autocomplete(
        createContext({ data: subcommand('get', [{ name: 'name', value: 'be', focused: true }]) })
    );

    expect(first).toEqual([{ name: 'alpha', value: 'alpha' }]);
    expect(second).toEqual([{ name: 'beta', value: 'beta' }]);
    expect(databases.tags.findCount).toBe(1);

    await manageCommand.handle(
        createContext({
            data: subcommand('create', [
                { name: 'name', value: 'gamma' },
                { name: 'message', value: 'Gamma' }
            ])
        })
    );
    expect(databases.tags.findCount).toBe(1);

    const third = await tagCommand.autocomplete(
        createContext({ data: subcommand('get', [{ name: 'name', value: 'g', focused: true }]) })
    );

    expect(third).toEqual([{ name: 'gamma', value: 'gamma' }]);
    expect(databases.tags.findCount).toBe(1);
});

test('plain tag create writes blocks instead of legacy data', async () => {
    const databases = createDatabases();
    const manageCommand = createCommands({ databases }).find((command) => command.definition.name === 'tag-manage');
    const context = createContext({
        data: subcommand('create', [
            { name: 'name', value: 'hello' },
            { name: 'message', value: 'Hello world' }
        ])
    });

    await manageCommand.handle(context);

    expect(databases.tags.get('hello')).toMatchObject({
        _id: 'hello',
        blocks: [{ kind: 'text', content: 'Hello world' }]
    });
    expect(databases.tags.get('hello')).not.toHaveProperty('data');
    expect(context.response.components[0].content).toContain('Created the tag `hello`.');
});

test('tag-managed builder routes require manager auth', () => {
    const databases = createDatabases();
    const manageCommand = createCommands({ databases }).find((command) => command.definition.name === 'tag-manage');

    expect(manageCommand.components.every((route) => route.auth)).toBe(true);
    expect(manageCommand.modals.every((route) => route.auth)).toBe(true);
});

test('blank tag create builder carries the user current draft', async () => {
    const databases = createDatabases();
    const commands = createCommands({ databases });
    const manageCommand = commands.find((command) => command.definition.name === 'tag-manage');
    const firstContext = createContext({
        data: subcommand('create', [{ name: 'name', value: 'firstdraft' }]),
        userID: 'builder-user-carry'
    });

    await manageCommand.handle(firstContext);
    const addTextContext = createContext({
        customID: firstContext.response.components[1].components[0].custom_id,
        modalValues: { [BuilderIDs.TextInput]: 'carried text' },
        userID: 'builder-user-carry'
    });
    await manageCommand.modals.find((route) => route.prefix === `${BuilderIDs.TextModal}:`).handle(addTextContext);

    const secondContext = createContext({
        data: subcommand('create', [{ name: 'name', value: 'seconddraft' }]),
        userID: 'builder-user-carry'
    });
    await manageCommand.handle(secondContext);

    expect(JSON.stringify(secondContext.response.components)).toContain('carried text');
    expect(JSON.stringify(secondContext.response.components)).toContain('Create tag seconddraft');
});

test('message builder refuses to save tags with empty containers', async () => {
    const databases = createDatabases();
    const commands = createCommands({ databases });
    const manageCommand = commands.find((command) => command.definition.name === 'tag-manage');
    const context = createContext({
        data: subcommand('create', [{ name: 'name', value: 'emptycontainer' }]),
        userID: 'builder-user-4'
    });

    await manageCommand.handle(context);
    const actionCustomID = context.response.components[1].components[0].custom_id;
    const addContainerContext = createContext({
        customID: actionCustomID,
        data: { values: [BuilderActions.AddContainer] },
        userID: 'builder-user-4'
    });
    await manageCommand.components
        .find((route) => route.prefix === `${BuilderIDs.Action}:`)
        .handle(addContainerContext);
    const saveContext = createContext({
        customID: addContainerContext.editMessage.components[1].components[0].custom_id,
        data: { values: [BuilderActions.Save] },
        userID: 'builder-user-4'
    });

    await manageCommand.components.find((route) => route.prefix === `${BuilderIDs.Action}:`).handle(saveContext);

    expect(saveContext.deferUpdateCalled).toBe(false);
    expect(saveContext.response.components[0].content).toBe(
        'Remove empty containers or add content inside them before saving.'
    );
    expect(saveContext.editMessage).toBeUndefined();
    expect(databases.tags.has('emptycontainer')).toBe(false);
});

test('public false defaults to current channel and warns when all tags are public', async () => {
    const databases = createDatabases({
        channels: [{ _id: '111111111111111111', tagsPublicByDefault: true }],
        tags: [
            {
                _id: 'rules',
                blocks: [{ kind: BlockKinds.Text, content: 'rules' }],
                publicChannelIDs: ['111111111111111111']
            }
        ]
    });
    const manageCommand = createCommands({ databases }).find((command) => command.definition.name === 'tag-manage');
    const context = createContext({
        data: subcommand('public', [
            { name: 'name', value: 'rules' },
            { name: 'public', value: false }
        ])
    });

    await manageCommand.handle(context);

    expect(databases.tags.get('rules').publicChannelIDs).toEqual([]);
    expect(context.response.components[0].content).toContain('all tags are still public by default');
    expect(context.response.components[0].content).toContain('/tag-manage public name:all public:false');
});

test('public true defaults to the current channel', async () => {
    const databases = createDatabases({
        tags: [{ _id: 'rules', blocks: [{ kind: BlockKinds.Text, content: 'rules' }], publicChannelIDs: [] }]
    });
    const manageCommand = createCommands({ databases }).find((command) => command.definition.name === 'tag-manage');
    const context = createContext({
        channelID: '222222222222222222',
        data: subcommand('public', [
            { name: 'name', value: 'rules' },
            { name: 'public', value: true }
        ])
    });

    await manageCommand.handle(context);

    expect(databases.tags.get('rules').publicChannelIDs).toEqual(['222222222222222222']);
    expect(context.response.components[0].content).toContain('<#222222222222222222>');
});

test('public-list all shows tag-specific public settings in the current channel', async () => {
    const databases = createDatabases({
        tags: [
            { _id: 'alpha', blocks: [{ kind: BlockKinds.Text, content: 'alpha' }], publicChannelIDs: [] },
            {
                _id: 'beta',
                blocks: [{ kind: BlockKinds.Text, content: 'beta' }],
                publicChannelIDs: ['111111111111111111']
            }
        ]
    });
    const manageCommand = createCommands({ databases }).find((command) => command.definition.name === 'tag-manage');
    const context = createContext({
        data: subcommand('public-list', [{ name: 'name', value: 'all' }])
    });

    await manageCommand.handle(context);

    expect(context.response.components[0].content).toContain('All tags are not public by default');
    expect(context.response.components[0].content).toContain('Tag-specific public settings: `beta`');
    expect(context.response.components[0].content).not.toContain('`alpha`');
});

test('public-list all explains tag-specific settings are redundant when the channel default is public', async () => {
    const databases = createDatabases({
        channels: [{ _id: '111111111111111111', tagsPublicByDefault: true }],
        tags: [
            {
                _id: 'beta',
                blocks: [{ kind: BlockKinds.Text, content: 'beta' }],
                publicChannelIDs: ['111111111111111111']
            }
        ]
    });
    const manageCommand = createCommands({ databases }).find((command) => command.definition.name === 'tag-manage');
    const context = createContext({
        data: subcommand('public-list', [{ name: 'name', value: 'all' }])
    });

    await manageCommand.handle(context);

    expect(context.response.components[0].content).toContain('All tags are public by default');
    expect(context.response.components[0].content).toContain('already makes every tag public');
    expect(context.response.components[0].content).toContain('Tag-specific public settings: `beta`');
});
