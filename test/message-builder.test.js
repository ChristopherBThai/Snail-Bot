import { expect, test } from 'vitest';
import { createLogging, LogLevels } from '../src/systems/logger/index.js';
import { BlockKinds, BuilderActions, BuilderIDs, OpenModes } from '../src/systems/message-builder/constants.js';
import { createMessageBuilderRoutes } from '../src/systems/message-builder/routes.js';
import { createContext, createDatabases } from './helpers/tagsMessageBuilder.js';

function actionRoute(routes) {
    return routes.components.find((route) => route.prefix === `${BuilderIDs.Action}:`);
}

function blockSelectRoute(routes) {
    return routes.components.find((route) => route.prefix === `${BuilderIDs.SelectBlock}:`);
}

function modalRoute(routes, id) {
    return routes.modals.find((route) => route.prefix === `${id}:`);
}

function createBuilderLogging() {
    const logging = createLogging({ limit: 100 });

    logging.setLevel('message_builder', LogLevels.Trace);

    return logging;
}

function createRoutes({ databases, logging = createBuilderLogging(), saveHandlers = {} }) {
    return createMessageBuilderRoutes({
        databases,
        logging,
        saveHandlers
    });
}

function actionSelect(message) {
    return message.components
        .flatMap((component) => component.components ?? [])
        .find((component) => component.custom_id?.startsWith(BuilderIDs.Action));
}

function blockSelect(message) {
    return message.components
        .flatMap((component) => component.components ?? [])
        .find((component) => component.custom_id?.startsWith(BuilderIDs.SelectBlock));
}

test('message builder previews suppress mentions', async () => {
    const databases = createDatabases();
    const routes = createRoutes({ databases });
    const context = createContext({ userID: 'builder-mentions' });

    await routes.start(context, {
        blocks: [{ kind: BlockKinds.Text, content: 'Hello <@123456789012345678> <@&123456789012345678>' }],
        mode: OpenModes.ReplaceFromBlocks,
        target: { type: 'tag_create', name: 'mentions' }
    });

    expect(context.response.allowed_mentions).toEqual({ parse: [] });
});

test('message builder persists and resumes a user current draft', async () => {
    const databases = createDatabases();
    const routes = createRoutes({ databases });
    const firstContext = createContext({ userID: 'builder-user' });

    await routes.start(firstContext, {
        blocks: [{ kind: BlockKinds.Text, content: 'saved draft' }],
        mode: OpenModes.ReplaceFromBlocks,
        target: { type: 'tag_create', name: 'draft' }
    });

    const secondContext = createContext({ userID: 'builder-user' });
    await routes.start(secondContext, {
        mode: OpenModes.Resume,
        target: { type: 'tag_create', name: 'next' }
    });

    expect(databases.builderDrafts.get('builder-user').blocks).toEqual([
        { kind: BlockKinds.Text, content: 'saved draft' }
    ]);
    expect(JSON.stringify(secondContext.response.components)).toContain('saved draft');
    expect(JSON.stringify(secondContext.response.components)).toContain('Create tag next');
});

test('message builder rejects a superseded panel', async () => {
    const databases = createDatabases();
    const routes = createRoutes({ databases });
    const firstContext = createContext({ userID: 'builder-user-2' });
    await routes.start(firstContext, {
        mode: OpenModes.ReplaceFromBlocks,
        target: { type: 'tag_create', name: 'first' }
    });
    const staleCustomID = actionSelect(firstContext.response).custom_id;

    const secondContext = createContext({ userID: 'builder-user-2' });
    await routes.start(secondContext, {
        mode: OpenModes.ReplaceFromBlocks,
        target: { type: 'tag_create', name: 'second' }
    });

    const staleAction = createContext({
        customID: staleCustomID,
        data: { values: [BuilderActions.AddText] },
        userID: 'builder-user-2'
    });
    await actionRoute(routes).handle(staleAction);

    expect(staleAction.response.components[0].content).toBe('A newer Message Builder is active.');
});

test('message builder previews empty containers without sending an invalid empty container', async () => {
    const databases = createDatabases();
    const routes = createRoutes({ databases });
    const context = createContext({ userID: 'builder-user-3' });
    await routes.start(context, {
        mode: OpenModes.ReplaceFromBlocks,
        target: { type: 'tag_create', name: 'container' }
    });

    const addContainerContext = createContext({
        customID: actionSelect(context.response).custom_id,
        data: { values: [BuilderActions.AddContainer] },
        userID: 'builder-user-3'
    });
    await actionRoute(routes).handle(addContainerContext);

    expect(addContainerContext.deferUpdateCalled).toBe(false);
    expect(JSON.stringify(addContainerContext.editMessage.components)).toContain('*Empty container*');
    expect(JSON.stringify(addContainerContext.editMessage.components)).not.toContain('"components":[]');
});

test('message builder saves directly and deactivates the session', async () => {
    const databases = createDatabases();
    const calls = [];
    const routes = createRoutes({
        databases,
        saveHandlers: {
            tag_create: async (context) => {
                calls.push({ deferred: context.deferred });
                return { ok: true, message: 'Saved.' };
            }
        }
    });
    const context = createContext({ userID: 'builder-user-save-defer' });
    await routes.start(context, {
        blocks: [{ kind: BlockKinds.Text, content: 'save me' }],
        mode: OpenModes.ReplaceFromBlocks,
        target: { type: 'tag_create', name: 'save' }
    });

    const saveContext = createContext({
        customID: actionSelect(context.response).custom_id,
        data: { values: [BuilderActions.Save] },
        userID: 'builder-user-save-defer'
    });
    await actionRoute(routes).handle(saveContext);

    expect(saveContext.deferUpdateCalled).toBe(false);
    expect(calls).toEqual([{ deferred: false }]);
    expect(saveContext.editMessage.components[0].content).toBe('Saved.');

    const staleContext = createContext({
        customID: actionSelect(context.response).custom_id,
        data: { values: [BuilderActions.AddText] },
        userID: 'builder-user-save-defer'
    });
    await actionRoute(routes).handle(staleContext);

    expect(staleContext.response.components[0].content).toBe('That Message Builder session has expired.');
});

test('message builder filters invalid add and move actions', async () => {
    const databases = createDatabases();
    const routes = createRoutes({ databases });
    const leafContext = createContext({ userID: 'builder-user-leaf' });
    await routes.start(leafContext, {
        blocks: [
            { kind: BlockKinds.Text, content: 'first' },
            { kind: BlockKinds.Text, content: 'second' }
        ],
        mode: OpenModes.ReplaceFromBlocks,
        selectedBlockPath: [0],
        target: { type: 'tag_create', name: 'leaf' }
    });

    const leafOptions = actionSelect(leafContext.response).options.map((option) => option.value);
    expect(leafOptions).not.toContain(BuilderActions.AddText);
    expect(leafOptions).not.toContain(BuilderActions.MoveUp);
    expect(leafOptions).toContain(BuilderActions.MoveDown);
    expect(leafOptions).toContain(BuilderActions.EditBlock);

    const staleAddContext = createContext({
        customID: actionSelect(leafContext.response).custom_id,
        modalValues: { [BuilderIDs.TextInput]: 'nested?' },
        userID: 'builder-user-leaf'
    });
    await modalRoute(routes, BuilderIDs.TextModal).handle(staleAddContext);

    expect(staleAddContext.response.components[0].content).toBe('That builder action could not be completed.');
});

test('message builder does not offer or allow nested containers', async () => {
    const databases = createDatabases();
    const routes = createRoutes({ databases });
    const context = createContext({ userID: 'builder-user-5' });
    await routes.start(context, {
        blocks: [{ kind: BlockKinds.Container, children: [{ kind: BlockKinds.Text, content: 'inside' }] }],
        mode: OpenModes.ReplaceFromBlocks,
        selectedBlockPath: [0],
        target: { type: 'tag_create', name: 'nested' }
    });

    expect(actionSelect(context.response).options.map((option) => option.value)).not.toContain(
        BuilderActions.AddContainer
    );

    const addContainerContext = createContext({
        customID: actionSelect(context.response).custom_id,
        data: { values: [BuilderActions.AddContainer] },
        userID: 'builder-user-5'
    });
    await actionRoute(routes).handle(addContainerContext);

    expect(addContainerContext.response.components[0].content).toBe('That builder action could not be completed.');
});

test('message builder orders add actions for root and containers', async () => {
    const databases = createDatabases();
    const routes = createRoutes({ databases });
    const rootContext = createContext({ userID: 'builder-user-root' });
    await routes.start(rootContext, {
        mode: OpenModes.ReplaceFromBlocks,
        selectedBlockPath: [],
        target: { type: 'tag_create', name: 'root' }
    });

    expect(
        actionSelect(rootContext.response)
            .options.slice(0, 6)
            .map((option) => option.label)
    ).toEqual(['Add text', 'Add container', 'Add separator', 'Add image gallery', 'Add section', 'Add link row']);

    const containerContext = createContext({ userID: 'builder-user-container' });
    await routes.start(containerContext, {
        blocks: [{ kind: BlockKinds.Container, children: [{ kind: BlockKinds.Text, content: 'inside' }] }],
        mode: OpenModes.ReplaceFromBlocks,
        selectedBlockPath: [0],
        target: { type: 'tag_create', name: 'container' }
    });

    expect(
        actionSelect(containerContext.response)
            .options.slice(0, 5)
            .map((option) => option.label)
    ).toEqual(['Add text', 'Add separator', 'Add image gallery', 'Add section', 'Add link row']);
});

test('message builder persists container spoiler edits', async () => {
    const databases = createDatabases();
    const routes = createRoutes({ databases });
    const context = createContext({ userID: 'builder-user-container-spoiler' });
    await routes.start(context, {
        blocks: [{ kind: BlockKinds.Container, children: [{ kind: BlockKinds.Text, content: 'inside' }] }],
        mode: OpenModes.ReplaceFromBlocks,
        selectedBlockPath: [0],
        target: { type: 'tag_create', name: 'container' }
    });

    const openModalContext = createContext({
        customID: actionSelect(context.response).custom_id,
        data: { values: [BuilderActions.EditBlock] },
        userID: 'builder-user-container-spoiler'
    });
    await actionRoute(routes).handle(openModalContext);

    const editContext = createContext({
        customID: openModalContext.openedModal.custom_id,
        modalValues: {
            [BuilderIDs.ContainerColorInput]: '#5865f2',
            [BuilderIDs.ContainerSpoilerInput]: true
        },
        userID: 'builder-user-container-spoiler'
    });
    await modalRoute(routes, BuilderIDs.EditContainerModal).handle(editContext);

    expect(databases.builderDrafts.get('builder-user-container-spoiler').blocks[0]).toMatchObject({
        accentColor: 0x5865f2,
        spoiler: true
    });
    expect(editContext.editMessage.components.find((component) => component.type === 17)).toMatchObject({
        accent_color: 0x5865f2,
        spoiler: true
    });
});

test('message builder appends and removes links from selected link rows', async () => {
    const databases = createDatabases();
    const routes = createRoutes({ databases });
    const context = createContext({ userID: 'builder-user-link-append' });
    await routes.start(context, {
        blocks: [{ kind: BlockKinds.LinkButtons, buttons: [{ label: 'One', url: 'https://one.example' }] }],
        mode: OpenModes.ReplaceFromBlocks,
        selectedBlockPath: [0],
        target: { type: 'tag_create', name: 'links' }
    });

    expect(actionSelect(context.response).options).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: 'Add link' })])
    );

    const addLinkContext = createContext({
        customID: actionSelect(context.response).custom_id,
        modalValues: {
            [BuilderIDs.LinkLabelInput]: 'Two',
            [BuilderIDs.LinkURLInput]: 'two.example'
        },
        userID: 'builder-user-link-append'
    });
    await modalRoute(routes, BuilderIDs.LinkModal).handle(addLinkContext);

    expect(databases.builderDrafts.get('builder-user-link-append').blocks[0].buttons).toEqual([
        { label: 'One', url: 'https://one.example' },
        { label: 'Two', url: 'https://two.example/' }
    ]);
    expect(actionSelect(addLinkContext.editMessage).options).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: 'Remove link: One' })])
    );

    const badLinkContext = createContext({
        customID: actionSelect(addLinkContext.editMessage).custom_id,
        modalValues: {
            [BuilderIDs.LinkLabelInput]: 'Bad',
            [BuilderIDs.LinkURLInput]: 'notalink'
        },
        userID: 'builder-user-link-append'
    });
    await modalRoute(routes, BuilderIDs.LinkModal).handle(badLinkContext);

    expect(badLinkContext.response.components[0].content).toBe('Provide a label and a valid URL.');

    const removeFirstContext = createContext({
        customID: actionSelect(addLinkContext.editMessage).custom_id,
        data: { values: [`${BuilderActions.RemoveLinkFromRow}:0`] },
        userID: 'builder-user-link-append'
    });
    await actionRoute(routes).handle(removeFirstContext);

    expect(databases.builderDrafts.get('builder-user-link-append').blocks[0].buttons).toEqual([
        { label: 'Two', url: 'https://two.example/' }
    ]);
    expect(JSON.stringify(removeFirstContext.editMessage.components)).not.toContain('https://one.example');

    const removeLastContext = createContext({
        customID: actionSelect(removeFirstContext.editMessage).custom_id,
        data: { values: [`${BuilderActions.RemoveLinkFromRow}:0`] },
        userID: 'builder-user-link-append'
    });
    await actionRoute(routes).handle(removeLastContext);

    expect(databases.builderDrafts.get('builder-user-link-append').blocks).toEqual([]);
    expect(JSON.stringify(removeLastContext.editMessage.components)).not.toContain('https://two.example/');
});

test('message builder creates, appends, and removes URL image gallery items', async () => {
    const databases = createDatabases();
    const routes = createRoutes({ databases });
    const context = createContext({ userID: 'builder-user-gallery-url' });
    await routes.start(context, {
        mode: OpenModes.ReplaceFromBlocks,
        target: { type: 'tag_create', name: 'galleryurl' }
    });

    const addGalleryContext = createContext({
        customID: actionSelect(context.response).custom_id,
        data: { values: [BuilderActions.AddMediaGallery] },
        userID: 'builder-user-gallery-url'
    });
    await actionRoute(routes).handle(addGalleryContext);

    expect(addGalleryContext.openedModal.title).toBe('Add Image Gallery');

    const createGalleryContext = createContext({
        customID: addGalleryContext.openedModal.custom_id,
        modalValues: { [BuilderIDs.MediaURLInput]: 'https://images.example/one.png' },
        userID: 'builder-user-gallery-url'
    });
    await modalRoute(routes, BuilderIDs.MediaGalleryModal).handle(createGalleryContext);

    expect(databases.builderDrafts.get('builder-user-gallery-url').blocks[0]).toMatchObject({
        kind: BlockKinds.MediaGallery,
        items: [{ url: 'https://images.example/one.png' }]
    });
    expect(JSON.stringify(createGalleryContext.editMessage.components)).toContain('https://images.example/one.png');

    const appendContext = createContext({
        customID: actionSelect(createGalleryContext.editMessage).custom_id,
        modalValues: { [BuilderIDs.MediaURLInput]: 'https://images.example/two.png' },
        userID: 'builder-user-gallery-url'
    });
    await modalRoute(routes, BuilderIDs.MediaGalleryModal).handle(appendContext);

    expect(databases.builderDrafts.get('builder-user-gallery-url').blocks[0].items).toHaveLength(2);
    expect(actionSelect(appendContext.editMessage).options).toEqual(
        expect.arrayContaining([expect.objectContaining({ label: 'Remove image: https://images.example/one.png' })])
    );

    const removeContext = createContext({
        customID: actionSelect(appendContext.editMessage).custom_id,
        data: { values: [`${BuilderActions.RemoveImageFromGallery}:0`] },
        userID: 'builder-user-gallery-url'
    });
    await actionRoute(routes).handle(removeContext);

    expect(databases.builderDrafts.get('builder-user-gallery-url').blocks[0].items).toEqual([
        { url: 'https://images.example/two.png' }
    ]);
    expect(JSON.stringify(removeContext.editMessage.components)).not.toContain('https://images.example/one.png');
});

test('message builder rejects invalid image gallery URLs', async () => {
    const databases = createDatabases();
    const routes = createRoutes({ databases });
    const context = createContext({ userID: 'builder-user-invalid-image' });
    await routes.start(context, {
        mode: OpenModes.ReplaceFromBlocks,
        target: { type: 'tag_create', name: 'galleryurl' }
    });

    const badGalleryContext = createContext({
        customID: actionSelect(context.response).custom_id,
        modalValues: { [BuilderIDs.MediaURLInput]: 'notalink' },
        userID: 'builder-user-invalid-image'
    });
    await modalRoute(routes, BuilderIDs.MediaGalleryModal).handle(badGalleryContext);

    expect(badGalleryContext.response.components[0].content).toBe('Provide a valid image URL.');
});

test('message builder logs session starts, actions, and validation failures', async () => {
    const databases = createDatabases();
    const logging = createBuilderLogging();
    const routes = createRoutes({ databases, logging });
    const context = createContext({ userID: 'builder-user-logs' });

    await routes.start(context, {
        mode: OpenModes.ReplaceFromBlocks,
        target: { type: 'tag_create', name: 'logs' }
    });

    const actionContext = createContext({
        customID: actionSelect(context.response).custom_id,
        data: { values: [BuilderActions.AddLinkRow] },
        userID: 'builder-user-logs'
    });
    await actionRoute(routes).handle(actionContext);

    const invalidLinkContext = createContext({
        customID: actionContext.openedModal.custom_id,
        modalValues: {
            [BuilderIDs.LinkLabelInput]: 'Bad',
            [BuilderIDs.LinkURLInput]: 'notalink'
        },
        userID: 'builder-user-logs'
    });
    await modalRoute(routes, BuilderIDs.LinkModal).handle(invalidLinkContext);

    expect(logging.getEntries({ sourceID: 'message_builder' })).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                type: 'message_builder.started',
                data: expect.objectContaining({ blockCount: 0, targetType: 'tag_create' })
            }),
            expect.objectContaining({
                type: 'message_builder.action',
                data: expect.objectContaining({ action: BuilderActions.AddLinkRow, targetType: 'tag_create' })
            }),
            expect.objectContaining({
                type: 'message_builder.validation_failed',
                data: expect.objectContaining({ reason: 'invalid_link_url', targetType: 'tag_create' })
            })
        ])
    );
});

test('message builder supports section thumbnail URLs and rejects invalid thumbnail URLs', async () => {
    const databases = createDatabases();
    const routes = createRoutes({ databases });
    const context = createContext({ userID: 'builder-user-section' });
    await routes.start(context, {
        mode: OpenModes.ReplaceFromBlocks,
        target: { type: 'tag_create', name: 'section' }
    });

    const sectionContext = createContext({
        customID: actionSelect(context.response).custom_id,
        modalValues: {
            [BuilderIDs.SectionTextInput]: 'One\n\nTwo',
            [BuilderIDs.SectionThumbnailInput]: 'https://images.example/thumb.png'
        },
        userID: 'builder-user-section'
    });
    await modalRoute(routes, BuilderIDs.SectionModal).handle(sectionContext);

    expect(databases.builderDrafts.get('builder-user-section').blocks[0]).toMatchObject({
        kind: BlockKinds.Section,
        texts: ['One', 'Two'],
        thumbnailURL: 'https://images.example/thumb.png'
    });
    expect(JSON.stringify(sectionContext.editMessage.components)).toContain('https://images.example/thumb.png');

    const badSectionContext = createContext({
        customID: actionSelect(sectionContext.editMessage).custom_id,
        modalValues: {
            [BuilderIDs.SectionTextInput]: 'Text',
            [BuilderIDs.SectionThumbnailInput]: 'notalink'
        },
        userID: 'builder-user-section'
    });
    await modalRoute(routes, BuilderIDs.SectionModal).handle(badSectionContext);

    expect(badSectionContext.response.components[0].content).toBe('Provide a valid thumbnail URL.');
});

test('message builder selecting blocks keeps URL previews link-only', async () => {
    const databases = createDatabases();
    const routes = createRoutes({ databases });
    const context = createContext({ userID: 'builder-user-select-url' });
    await routes.start(context, {
        blocks: [
            { kind: BlockKinds.MediaGallery, items: [{ url: 'https://images.example/one.png' }] },
            {
                kind: BlockKinds.LinkButtons,
                buttons: [{ label: 'Guide', url: 'https://files.example/guide.pdf' }]
            }
        ],
        mode: OpenModes.ReplaceFromBlocks,
        selectedBlockPath: [0],
        target: { type: 'tag_create', name: 'links' }
    });

    const selectContext = createContext({
        customID: blockSelect(context.response).custom_id,
        data: { values: ['root'] },
        userID: 'builder-user-select-url'
    });
    await blockSelectRoute(routes).handle(selectContext);

    expect(selectContext.deferUpdateCalled).toBe(false);
    expect(selectContext.editMessage.files).toBeUndefined();
    expect(selectContext.editMessage.attachments).toBeUndefined();
    expect(JSON.stringify(selectContext.editMessage.components)).toContain('https://images.example/one.png');
    expect(JSON.stringify(selectContext.editMessage.components)).toContain('https://files.example/guide.pdf');
});
