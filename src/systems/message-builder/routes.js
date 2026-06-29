import { ephemeralText, MessageFlags } from '../discord/components.js';
import { LogLevels } from '../logger/index.js';
import { BlockKinds, BuilderActions, BuilderIDs, OpenModes, OperationResults } from './constants.js';
import {
    addBlock,
    addItemToSelectedMediaGallery,
    addLinkToSelectedRow,
    clearDraft,
    createDraft,
    deleteSelectedBlock,
    editSelectedSection,
    editSelectedText,
    getSelectedBlock,
    moveSelectedBlock,
    parseBlockPath,
    removeItemFromSelectedMediaGallery,
    removeLinkFromSelectedRow,
    restoreDraft,
    selectBlock,
    serializeDraft
} from './model.js';
import {
    buildContainerModal,
    buildLinkModal,
    buildMediaGalleryModal,
    buildPanel,
    buildSectionModal,
    buildTextModal
} from './render.js';

const ActiveSessions = new Map();

export function createMessageBuilderRoutes({ databases, logging, saveHandlers }) {
    const logger = logging.createLogger({ sourceID: 'message_builder' });

    return {
        start: (context, options) => startBuilder({ context, databases, logger, options }),
        components: [
            {
                prefix: `${BuilderIDs.SelectBlock}:`,
                handle: (context) => selectBuilderBlock(context, databases, logger)
            },
            {
                prefix: `${BuilderIDs.Action}:`,
                handle: (context) => handleBuilderAction(context, databases, logger, saveHandlers)
            }
        ],
        modals: [
            { prefix: `${BuilderIDs.TextModal}:`, handle: (context) => addTextBlock(context, databases, logger) },
            { prefix: `${BuilderIDs.EditTextModal}:`, handle: (context) => editTextBlock(context, databases, logger) },
            { prefix: `${BuilderIDs.LinkModal}:`, handle: (context) => addLinkRow(context, databases, logger) },
            { prefix: `${BuilderIDs.SectionModal}:`, handle: (context) => addSectionBlock(context, databases, logger) },
            {
                prefix: `${BuilderIDs.EditSectionModal}:`,
                handle: (context) => editSectionBlock(context, databases, logger)
            },
            {
                prefix: `${BuilderIDs.MediaGalleryModal}:`,
                handle: (context) => addMediaGalleryBlock(context, databases, logger)
            },
            {
                prefix: `${BuilderIDs.EditContainerModal}:`,
                handle: (context) => editContainerBlock(context, databases, logger)
            }
        ]
    };
}

async function startBuilder({ context, databases, logger, options }) {
    const ownerID = context.userID;
    if (!ownerID) {
        await context.respond(ephemeralText('Could not identify the builder user.'));
        return;
    }

    const sessionID = crypto.randomUUID();
    const log = logger.child({ sessionID, targetType: options.target?.type, userID: ownerID });
    const timer = log.time('message_builder.start', { mode: options.mode });
    const carriedDraft = options.mode === OpenModes.Resume;
    const draft = carriedDraft
        ? restoreDraft(ownerID, await databases.snail.mongo.BuilderDraft.findById(ownerID).lean(), {
              sessionID,
              target: options.target
          })
        : createDraft({
              blocks: options.blocks ?? [],
              ownerID,
              selectedBlockPath: options.selectedBlockPath,
              sessionID,
              source: options.source,
              target: options.target
          });

    ActiveSessions.set(ownerID, draft);
    await saveCurrentDraft(databases, draft);
    log.info('message_builder.started', {
        blockCount: draft.blocks.length
    });
    const panel = buildPanel(draft);
    await context.respond({
        ...panel,
        flags: panel.flags | MessageFlags.Ephemeral
    });
    timer.end(
        {
            blockCount: draft.blocks.length,
            carriedDraft
        },
        { level: LogLevels.Info }
    );
}

async function selectBuilderBlock(context, databases, logger) {
    const draft = await getActiveDraft(context, logger);
    if (!draft) {
        return;
    }

    const result = selectBlock(draft, parseBlockPath(context.data.values?.[0]));
    if (result !== OperationResults.Ok) {
        logger.warn('message_builder.selection_rejected', {
            userID: context.userID,
            sessionID: draft.sessionID,
            path: context.data.values?.[0],
            result
        });
        await context.respond(ephemeralText('That block is no longer available.'));
        return;
    }

    logger.debug('message_builder.block_selected', {
        userID: context.userID,
        sessionID: draft.sessionID,
        path: context.data.values?.[0]
    });
    await saveAndEdit(context, databases, logger, draft, { source: 'select_block' });
}

async function handleBuilderAction(context, databases, logger, saveHandlers) {
    const draft = await getActiveDraft(context, logger);
    if (!draft) {
        return;
    }
    const action = context.data.values?.[0];
    logger.debug('message_builder.action', {
        userID: context.userID,
        sessionID: draft.sessionID,
        action,
        targetType: draft.target?.type
    });

    const imageIndex = parseIndexedAction(action, BuilderActions.RemoveImageFromGallery);
    if (imageIndex !== undefined) {
        await mutateAndEdit(context, databases, logger, draft, removeItemFromSelectedMediaGallery(draft, imageIndex), {
            action,
            imageIndex
        });
        return;
    }

    const linkIndex = parseIndexedAction(action, BuilderActions.RemoveLinkFromRow);
    if (linkIndex !== undefined) {
        await mutateAndEdit(context, databases, logger, draft, removeLinkFromSelectedRow(draft, linkIndex), {
            action,
            linkIndex
        });
        return;
    }

    switch (action) {
        case BuilderActions.AddText:
            await openBuilderModal(context, logger, draft, buildTextModal({ sessionID: draft.sessionID }), { action });
            return;
        case BuilderActions.AddSeparator:
            await mutateAndEdit(context, databases, logger, draft, addBlock(draft, { kind: BlockKinds.Separator }), {
                action,
                blockKind: BlockKinds.Separator
            });
            return;
        case BuilderActions.AddLinkRow:
            await openBuilderModal(context, logger, draft, buildLinkModal({ sessionID: draft.sessionID }), { action });
            return;
        case BuilderActions.AddLinkToRow:
            await openBuilderModal(context, logger, draft, buildLinkModal({ sessionID: draft.sessionID }), { action });
            return;
        case BuilderActions.AddSection:
            await openBuilderModal(context, logger, draft, buildSectionModal({ sessionID: draft.sessionID }), {
                action
            });
            return;
        case BuilderActions.AddContainer:
            await mutateAndEdit(
                context,
                databases,
                logger,
                draft,
                addBlock(draft, { kind: BlockKinds.Container, children: [] }),
                { action, blockKind: BlockKinds.Container }
            );
            return;
        case BuilderActions.AddMediaGallery:
            await openBuilderModal(context, logger, draft, buildMediaGalleryModal({ sessionID: draft.sessionID }), {
                action
            });
            return;
        case BuilderActions.AddImageToGallery:
            await openBuilderModal(context, logger, draft, buildMediaGalleryModal({ sessionID: draft.sessionID }), {
                action
            });
            return;
        case BuilderActions.EditBlock:
            await openEditModal(context, logger, draft);
            return;
        case BuilderActions.DeleteBlock:
            await mutateAndEdit(context, databases, logger, draft, deleteSelectedBlock(draft), { action });
            return;
        case BuilderActions.MoveUp:
            await mutateAndEdit(context, databases, logger, draft, moveSelectedBlock(draft, -1), { action });
            return;
        case BuilderActions.MoveDown:
            await mutateAndEdit(context, databases, logger, draft, moveSelectedBlock(draft, 1), { action });
            return;
        case BuilderActions.Clear:
            await mutateAndEdit(context, databases, logger, draft, clearDraft(draft), { action });
            return;
        case BuilderActions.Save:
            await saveTarget(context, logger, draft, saveHandlers);
            return;
        default:
            logger.warn('message_builder.action_rejected', {
                userID: context.userID,
                sessionID: draft.sessionID,
                action,
                reason: 'invalid_action'
            });
            await context.respond(ephemeralText('Choose a valid builder action.'));
    }
}

async function addTextBlock(context, databases, logger) {
    const draft = await getActiveDraft(context, logger);
    if (!draft) {
        return;
    }

    const content = modalText(context, BuilderIDs.TextInput);
    if (!content) {
        logValidationFailure(logger, context, draft, 'text_empty');
        await context.respond(ephemeralText('Text cannot be empty.'));
        return;
    }

    await mutateAndEdit(context, databases, logger, draft, addBlock(draft, { kind: BlockKinds.Text, content }), {
        blockKind: BlockKinds.Text,
        source: 'text_modal'
    });
}

async function editTextBlock(context, databases, logger) {
    const draft = await getActiveDraft(context, logger);
    if (!draft) {
        return;
    }

    const content = modalText(context, BuilderIDs.EditTextInput);
    if (!content) {
        logValidationFailure(logger, context, draft, 'text_empty');
        await context.respond(ephemeralText('Text cannot be empty.'));
        return;
    }

    await mutateAndEdit(context, databases, logger, draft, editSelectedText(draft, content), {
        blockKind: BlockKinds.Text,
        source: 'edit_text_modal'
    });
}

async function addLinkRow(context, databases, logger) {
    const draft = await getActiveDraft(context, logger);
    if (!draft) {
        return;
    }

    const label = modalText(context, BuilderIDs.LinkLabelInput);
    const url = normalizeURL(context.modalValues[BuilderIDs.LinkURLInput]);
    if (!label || !url) {
        logValidationFailure(logger, context, draft, 'invalid_link_url');
        await context.respond(ephemeralText('Provide a label and a valid URL.'));
        return;
    }

    const block = getSelectedBlock(draft);
    const result =
        block?.kind === BlockKinds.LinkButtons
            ? addLinkToSelectedRow(draft, { label, url })
            : addBlock(draft, { kind: BlockKinds.LinkButtons, buttons: [{ label, url }] });

    await mutateAndEdit(context, databases, logger, draft, result, {
        blockKind: BlockKinds.LinkButtons,
        source: 'link_modal'
    });
}

async function addSectionBlock(context, databases, logger) {
    const draft = await getActiveDraft(context, logger);
    if (!draft) {
        return;
    }

    const section = readSectionModal(context);
    if (section.error) {
        logValidationFailure(logger, context, draft, 'invalid_section');
        await context.respond(ephemeralText(section.error));
        return;
    }

    await mutateAndEdit(
        context,
        databases,
        logger,
        draft,
        addBlock(draft, { kind: BlockKinds.Section, ...section.data }),
        {
            blockKind: BlockKinds.Section,
            source: 'section_modal'
        }
    );
}

async function editSectionBlock(context, databases, logger) {
    const draft = await getActiveDraft(context, logger);
    if (!draft) {
        return;
    }

    const section = readSectionModal(context);
    if (section.error) {
        logValidationFailure(logger, context, draft, 'invalid_section');
        await context.respond(ephemeralText(section.error));
        return;
    }

    await mutateAndEdit(context, databases, logger, draft, editSelectedSection(draft, section.data), {
        blockKind: BlockKinds.Section,
        source: 'edit_section_modal'
    });
}

async function addMediaGalleryBlock(context, databases, logger) {
    const draft = await getActiveDraft(context, logger);
    if (!draft) {
        return;
    }

    const url = normalizeURL(context.modalValues[BuilderIDs.MediaURLInput]);
    if (!url) {
        logValidationFailure(logger, context, draft, 'invalid_image_url');
        await context.respond(ephemeralText('Provide a valid image URL.'));
        return;
    }

    const block = getSelectedBlock(draft);
    const result =
        block?.kind === BlockKinds.MediaGallery
            ? addItemToSelectedMediaGallery(draft, { url })
            : addBlock(draft, {
                  kind: BlockKinds.MediaGallery,
                  items: [{ url }]
              });

    await mutateAndEdit(context, databases, logger, draft, result, {
        blockKind: BlockKinds.MediaGallery,
        source: 'image_gallery_modal'
    });
}

async function editContainerBlock(context, databases, logger) {
    const draft = await getActiveDraft(context, logger);
    const block = draft ? getSelectedBlock(draft) : undefined;
    if (!draft || block?.kind !== BlockKinds.Container) {
        logger.warn('message_builder.operation_rejected', {
            userID: context.userID,
            sessionID: draft?.sessionID,
            result: OperationResults.NoSelection,
            source: 'edit_container_modal'
        });
        await context.respond(ephemeralText('Select a container first.'));
        return;
    }

    const color = parseColor(context.modalValues[BuilderIDs.ContainerColorInput]);
    if (color === false) {
        logValidationFailure(logger, context, draft, 'invalid_container_color');
        await context.respond(ephemeralText('Use a hex color like #5865F2.'));
        return;
    }

    block.accentColor = color;
    block.spoiler = context.modalValues[BuilderIDs.ContainerSpoilerInput] === true;
    await saveAndEdit(context, databases, logger, draft, { source: 'edit_container_modal' });
}

function parseIndexedAction(action, prefix) {
    if (!action.startsWith(`${prefix}:`)) {
        return undefined;
    }

    const index = Number(action.slice(prefix.length + 1));
    return Number.isInteger(index) ? index : undefined;
}

function modalText(context, id) {
    return String(context.modalValues[id] ?? '').trim();
}

function readSectionModal(context) {
    const texts = modalText(context, BuilderIDs.SectionTextInput)
        .split(/\n{2,}/)
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 3);

    if (!texts.length) {
        return { error: 'Section text cannot be empty.' };
    }

    const thumbnailURL = normalizeOptionalURL(context.modalValues[BuilderIDs.SectionThumbnailInput]);
    if (thumbnailURL === false) {
        return { error: 'Provide a valid thumbnail URL.' };
    }

    return { data: { texts, thumbnailURL } };
}

async function openEditModal(context, logger, draft) {
    const block = getSelectedBlock(draft);

    if (block?.kind === BlockKinds.Text) {
        await openBuilderModal(
            context,
            logger,
            draft,
            buildTextModal({ content: block.content, edit: true, sessionID: draft.sessionID }),
            { blockKind: block.kind }
        );
        return;
    }

    if (block?.kind === BlockKinds.Section) {
        await openBuilderModal(
            context,
            logger,
            draft,
            buildSectionModal({ block, edit: true, sessionID: draft.sessionID }),
            { blockKind: block.kind }
        );
        return;
    }

    if (block?.kind === BlockKinds.Container) {
        await openBuilderModal(context, logger, draft, buildContainerModal({ block, sessionID: draft.sessionID }), {
            blockKind: block.kind
        });
        return;
    }

    logger.warn('message_builder.operation_rejected', {
        userID: context.userID,
        sessionID: draft.sessionID,
        result: OperationResults.NotEditable,
        source: 'edit_action'
    });
    await context.respond(ephemeralText('That block cannot be edited yet.'));
}

async function mutateAndEdit(context, databases, logger, draft, result, data = {}) {
    if (result !== OperationResults.Ok) {
        logger.warn('message_builder.operation_rejected', {
            userID: context.userID,
            sessionID: draft.sessionID,
            result,
            ...data
        });
        await context.respond(ephemeralText(formatOperationResult(result)));
        return;
    }

    await saveAndEdit(context, databases, logger, draft, data);
}

async function saveAndEdit(context, databases, logger, draft, data = {}) {
    const timer = logger.time('message_builder.panel_updated', {
        userID: context.userID,
        sessionID: draft.sessionID,
        targetType: draft.target?.type,
        blockCount: draft.blocks.length,
        ...data
    });

    try {
        const panel = buildPanel(draft);

        await context.edit(panel);

        await saveCurrentDraft(databases, draft);
        timer.end();
    } catch (error) {
        timer.fail(error);
        throw error;
    }
}

async function saveTarget(context, logger, draft, saveHandlers) {
    const timer = logger.time('message_builder.target_saved', {
        userID: context.userID,
        sessionID: draft.sessionID,
        targetType: draft.target?.type,
        blockCount: draft.blocks.length
    });
    const handler = saveHandlers[draft.target?.type];
    if (!handler) {
        timer.end({ ok: false, reason: 'missing_handler' }, { level: LogLevels.Warn });
        await context.respond(ephemeralText('This builder target cannot be saved yet.'));
        return;
    }

    try {
        const result = await handler(context, draft);
        if (!result.ok) {
            timer.end({ ok: false, reason: 'handler_rejected' }, { level: LogLevels.Warn });
            await context.respond(ephemeralText(result.message));
            return;
        }

        ActiveSessions.delete(context.userID);
        timer.end({ ok: true }, { level: LogLevels.Info });
        await context.edit(ephemeralText(result.message));
    } catch (error) {
        timer.fail(error);
        throw error;
    }
}

async function openBuilderModal(context, logger, draft, modal, data = {}) {
    logger.trace('message_builder.modal_opened', {
        userID: context.userID,
        sessionID: draft.sessionID,
        ...data
    });
    await context.openModal(modal);
}

async function getActiveDraft(context, logger) {
    const active = ActiveSessions.get(context.userID);
    const sessionID = getSessionID(context.customID);

    if (!active) {
        logger.warn('message_builder.session_rejected', {
            userID: context.userID,
            sessionID,
            reason: 'expired'
        });
        await context.respond(ephemeralText('That Message Builder session has expired.'));
        return undefined;
    }

    if (active.sessionID !== sessionID) {
        logger.warn('message_builder.session_rejected', {
            userID: context.userID,
            sessionID,
            activeSessionID: active.sessionID,
            reason: 'superseded'
        });
        await context.respond(ephemeralText('A newer Message Builder is active.'));
        return undefined;
    }

    return active;
}

function logValidationFailure(logger, context, draft, reason) {
    logger.warn('message_builder.validation_failed', {
        userID: context.userID,
        sessionID: draft.sessionID,
        targetType: draft.target?.type,
        reason
    });
}

async function saveCurrentDraft(databases, draft) {
    await databases.snail.mongo.BuilderDraft.updateOne(
        { _id: draft.ownerID },
        { $set: serializeDraft(draft) },
        { upsert: true }
    );
}

function getSessionID(customID) {
    return typeof customID === 'string' ? customID.split(':').at(-1) : undefined;
}

function normalizeURL(value) {
    if (typeof value !== 'string') {
        return undefined;
    }

    const candidate = /^[a-z][a-z\d+.-]*:/i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;

    try {
        const url = new URL(candidate);
        if (!['http:', 'https:'].includes(url.protocol) || !isDiscordSafeHostname(url.hostname)) {
            return undefined;
        }

        return url.toString();
    } catch {
        return undefined;
    }
}

function normalizeOptionalURL(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return undefined;
    }

    return normalizeURL(value) ?? false;
}

function isDiscordSafeHostname(hostname) {
    return (
        hostname === 'localhost' ||
        /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname) ||
        /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)+$/i.test(hostname)
    );
}

function parseColor(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return undefined;
    }

    const normalized = value.trim().replace(/^#|^0x/i, '');
    if (!/^[\da-f]{6}$/i.test(normalized)) {
        return false;
    }

    return Number.parseInt(normalized, 16);
}

function formatOperationResult(result) {
    switch (result) {
        case OperationResults.AlreadyFirst:
            return 'That block is already first.';
        case OperationResults.AlreadyLast:
            return 'That block is already last.';
        case OperationResults.Empty:
            return 'The draft is already empty.';
        case OperationResults.Full:
            return 'That would exceed a Message Builder limit.';
        case OperationResults.NoSelection:
            return 'Select a block first.';
        case OperationResults.NotEditable:
            return 'That block cannot be edited.';
        default:
            return 'That builder action could not be completed.';
    }
}
