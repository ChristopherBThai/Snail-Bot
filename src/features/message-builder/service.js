import { SeparatorSpacingSize } from '../../discord/components.js';
import {
    BuilderActions,
    BuilderComponentTypes,
    BuilderInputIds,
    BuilderRouteIds,
    MaxLinkButtonLabelLength,
    MaxLinkButtonsPerRow,
    MaxMediaGalleryItems,
    OperationResults
} from './constants.js';
import { createDraftFromMessage, HydrationRejectReasons } from './hydrate.js';
import {
    addComponent,
    addLinkButton,
    addMediaItem,
    clearDraft,
    createDraft,
    deleteSelectedComponent,
    deleteSelectedLinkButton,
    deleteSelectedMediaItem,
    editSelectedComponent,
    editSelectedLinkButton,
    editSelectedMediaItem,
    getSelectedComponent,
    getSelectedLinkButton,
    getSelectedMediaItem,
    moveSelectedComponent,
    parseComponentPath,
    selectComponent,
    selectLinkButton,
    selectMediaItem,
    toggleMentions,
    toggleSelectedMediaItemSpoiler
} from './model.js';
import {
    buildCompiledMessage,
    buildContainerModal,
    buildControllerMessage,
    buildDisplayMessage,
    buildLinkModal,
    buildMediaGalleryModal,
    buildSectionModal,
    buildSeparatorModal,
    buildTextModal
} from './render.js';
import { validateRenderableDraft } from './rules.js';

export function createMessageBuilder({ draftRepository }) {
    const activeSessions = new Map();
    let nextSessionId = 1;

    return {
        service: Object.freeze({
            start(context, options = {}) {
                return startBuilder({
                    activeSessions,
                    context,
                    createSessionId() {
                        const sessionId = String(nextSessionId);
                        nextSessionId += 1;
                        return sessionId;
                    },
                    draftRepository,
                    options
                });
            }
        }),
        routes: [
            {
                kind: 'component',
                id: BuilderRouteIds.SelectComponent,
                customIdPrefix: `${BuilderRouteIds.SelectComponent}:`,
                handle(context) {
                    return selectBuilderComponent({ activeSessions, context, draftRepository });
                }
            },
            {
                kind: 'component',
                id: BuilderRouteIds.AddComponent,
                customIdPrefix: `${BuilderRouteIds.AddComponent}:`,
                handle(context) {
                    return handleAddComponentAction({ activeSessions, context, draftRepository });
                }
            },
            {
                kind: 'component',
                id: BuilderRouteIds.Action,
                customIdPrefix: `${BuilderRouteIds.Action}:`,
                handle(context) {
                    return handleBuilderAction({ activeSessions, context, draftRepository });
                }
            },
            {
                kind: 'component',
                id: BuilderRouteIds.MediaItemSelect,
                customIdPrefix: `${BuilderRouteIds.MediaItemSelect}:`,
                handle(context) {
                    return selectBuilderMediaItem({ activeSessions, context, draftRepository });
                }
            },
            {
                kind: 'component',
                id: BuilderRouteIds.LinkButtonSelect,
                customIdPrefix: `${BuilderRouteIds.LinkButtonSelect}:`,
                handle(context) {
                    return selectBuilderLinkButton({ activeSessions, context, draftRepository });
                }
            },
            {
                kind: 'modal',
                id: BuilderRouteIds.SeparatorModal,
                customIdPrefix: `${BuilderRouteIds.SeparatorModal}:`,
                handle(context) {
                    return saveSeparator({ activeSessions, context, draftRepository });
                }
            },
            {
                kind: 'modal',
                id: BuilderRouteIds.TextModal,
                customIdPrefix: `${BuilderRouteIds.TextModal}:`,
                handle(context) {
                    return saveTextComponent({ activeSessions, context, draftRepository });
                }
            },
            {
                kind: 'modal',
                id: BuilderRouteIds.LinkModal,
                customIdPrefix: `${BuilderRouteIds.LinkModal}:`,
                handle(context) {
                    return saveLinkRow({ activeSessions, context, draftRepository });
                }
            },
            {
                kind: 'modal',
                id: BuilderRouteIds.SectionModal,
                customIdPrefix: `${BuilderRouteIds.SectionModal}:`,
                handle(context) {
                    return saveSection({ activeSessions, context, draftRepository });
                }
            },
            {
                kind: 'modal',
                id: BuilderRouteIds.MediaGalleryModal,
                customIdPrefix: `${BuilderRouteIds.MediaGalleryModal}:`,
                handle(context) {
                    return saveMediaGallery({ activeSessions, context, draftRepository });
                }
            },
            {
                kind: 'modal',
                id: BuilderRouteIds.ContainerModal,
                customIdPrefix: `${BuilderRouteIds.ContainerModal}:`,
                handle(context) {
                    return saveContainer({ activeSessions, context, draftRepository });
                }
            }
        ]
    };
}

function startBuilder({ activeSessions, context, createSessionId, draftRepository, options }) {
    const pendingResult = createPendingBuilderResult();

    initializeBuilder({
        activeSessions,
        context,
        createSessionId,
        draftRepository,
        options,
        pendingResult
    }).catch(pendingResult.reject);

    return pendingResult.promise;
}

async function initializeBuilder({
    activeSessions,
    context,
    createSessionId,
    draftRepository,
    options,
    pendingResult
}) {
    const sessionId = createSessionId();
    const sourceDraft = options.sourceMessage
        ? createDraftFromMessage(options.sourceMessage, { ownerId: context.userId, sessionId })
        : undefined;

    if (sourceDraft && !sourceDraft.ok) {
        await context.respond(formatHydrationRejectReason(sourceDraft.reason), { ephemeral: true });
        pendingResult.resolve(createCancelledResult());
        return;
    }

    const savedDraft =
        !sourceDraft && !Object.hasOwn(options, 'components') ? await draftRepository.load(context.userId) : undefined;
    const resumableDraft = savedDraft && validateRenderableDraft(savedDraft).ok ? savedDraft : undefined;
    const draft =
        sourceDraft?.draft ??
        (resumableDraft
            ? createDraft({ ...resumableDraft, sessionId })
            : createDraft({
                  components: options.components ?? [],
                  ownerId: context.userId,
                  sessionId
              }));
    const session = {
        authorize: options.authorize,
        colors: context.config.colors,
        displayToken: context.interaction.token,
        draft,
        label: options.label ?? 'Draft',
        pendingResult,
        submitting: false,
        submit: options.submit,
        submitError: options.submitError,
        submitLabel: options.submitLabel ?? 'Submit'
    };

    await draftRepository.save(draft);

    await context.respond(buildDisplayMessage(session), { ephemeral: true });
    await context.createFollowupMessage(buildControllerMessage(session), { ephemeral: true });
    cancelActiveSession(activeSessions.get(context.userId));
    activeSessions.set(context.userId, session);
}

async function selectBuilderComponent({ activeSessions, context, draftRepository }) {
    const session = await getActiveSession({ activeSessions, context });
    if (!session) {
        return;
    }

    const result = selectComponent(session.draft, parseComponentPath(context.values[0]));
    await applyOperationResult({ context, draftRepository, result, session });
}

async function selectBuilderMediaItem({ activeSessions, context, draftRepository }) {
    const session = await getActiveSession({ activeSessions, context });
    if (!session) {
        return;
    }

    const result = selectMediaItem(session.draft, context.values[0]);
    await applyOperationResult({ context, draftRepository, result, session });
}

async function selectBuilderLinkButton({ activeSessions, context, draftRepository }) {
    const session = await getActiveSession({ activeSessions, context });
    if (!session) {
        return;
    }

    const result = selectLinkButton(session.draft, context.values[0]);
    await applyOperationResult({ context, draftRepository, result, session });
}

async function handleAddComponentAction({ activeSessions, context, draftRepository }) {
    const session = await getActiveSession({ activeSessions, context });
    if (!session) {
        return;
    }

    const action = getInteractionValue(context);

    if (action === BuilderActions.AddText) {
        await context.openModal(buildTextModal({ sessionId: session.draft.sessionId }));
        return;
    }

    if (action === BuilderActions.AddSeparator) {
        await context.openModal(buildSeparatorModal({ sessionId: session.draft.sessionId }));
        return;
    }

    if (action === BuilderActions.AddLinkRow) {
        await context.openModal(buildLinkModal({ sessionId: session.draft.sessionId }));
        return;
    }

    if (action === BuilderActions.AddContainer) {
        await applyOperationResult({
            context,
            draftRepository,
            result: addComponent(session.draft, { type: BuilderComponentTypes.Container, children: [] }),
            session
        });
        return;
    }

    if (action === BuilderActions.AddSection) {
        await context.openModal(buildSectionModal({ sessionId: session.draft.sessionId }));
        return;
    }

    if (action === BuilderActions.AddMediaGallery) {
        await context.openModal(buildMediaGalleryModal({ sessionId: session.draft.sessionId }));
        return;
    }

    await context.respond('Choose a valid component to add.', { ephemeral: true });
}

async function handleBuilderAction({ activeSessions, context, draftRepository }) {
    const session = await getActiveSession({ activeSessions, context });
    if (!session) {
        return;
    }

    const action = getInteractionValue(context);

    if (action === BuilderActions.EditText) {
        await openTextModal(context, session);
        return;
    }

    if (action === BuilderActions.EditContainer) {
        await openContainerModal(context, session);
        return;
    }

    if (action === BuilderActions.EditSection) {
        await openSectionModal(context, session);
        return;
    }

    if (action === BuilderActions.EditSeparator) {
        await openSeparatorModal(context, session);
        return;
    }

    if (action === BuilderActions.ToggleMediaSpoiler) {
        await toggleMediaSpoiler({ context, draftRepository, session });
        return;
    }

    if (action === BuilderActions.ToggleMentions) {
        await applyOperationResult({
            context,
            draftRepository,
            result: toggleMentions(session.draft),
            session
        });
        return;
    }

    if (action === BuilderActions.AddLinkButton) {
        await context.openModal(
            buildLinkModal({
                action: BuilderActions.AddLinkButton,
                sessionId: session.draft.sessionId
            })
        );
        return;
    }

    if (action === BuilderActions.EditLinkButton) {
        await context.openModal(
            buildLinkModal({
                action: BuilderActions.EditLinkButton,
                button: getSelectedLinkButton(session.draft),
                sessionId: session.draft.sessionId
            })
        );
        return;
    }

    if (action === BuilderActions.DeleteLinkButton) {
        await applyOperationResult({
            context,
            draftRepository,
            result: deleteSelectedLinkButton(session.draft),
            session
        });
        return;
    }

    if (action === BuilderActions.AddGalleryImage) {
        await context.openModal(
            buildMediaGalleryModal({
                action: BuilderActions.AddGalleryImage,
                sessionId: session.draft.sessionId
            })
        );
        return;
    }

    if (action === BuilderActions.EditGalleryImage) {
        await context.openModal(
            buildMediaGalleryModal({
                action: BuilderActions.EditGalleryImage,
                item: getSelectedMediaItem(session.draft),
                sessionId: session.draft.sessionId
            })
        );
        return;
    }

    if (action === BuilderActions.DeleteGalleryImage) {
        await applyOperationResult({
            context,
            draftRepository,
            result: deleteSelectedMediaItem(session.draft),
            session
        });
        return;
    }

    if (action === BuilderActions.DeleteComponent) {
        await applyOperationResult({
            context,
            draftRepository,
            result: deleteSelectedComponent(session.draft),
            session
        });
        return;
    }

    if (action === BuilderActions.MoveUp) {
        await applyOperationResult({
            context,
            draftRepository,
            result: moveSelectedComponent(session.draft, -1),
            session
        });
        return;
    }

    if (action === BuilderActions.MoveDown) {
        await applyOperationResult({
            context,
            draftRepository,
            result: moveSelectedComponent(session.draft, 1),
            session
        });
        return;
    }

    if (action === BuilderActions.Clear) {
        await applyOperationResult({ context, draftRepository, result: clearDraft(session.draft), session });
        return;
    }

    if (action === BuilderActions.Submit) {
        await submitSession({ activeSessions, context, session });
        return;
    }

    await context.respond('Choose a valid builder action.', { ephemeral: true });
}

async function saveTextComponent({ activeSessions, context, draftRepository }) {
    const session = await getActiveSession({ activeSessions, context });
    if (!session) {
        return;
    }

    const content = String(context.modalValues[BuilderInputIds.Text] ?? '').trim();
    if (!content) {
        await context.respond('Text cannot be empty.', { ephemeral: true });
        return;
    }

    const selected = getSelectedComponent(session.draft);
    const result =
        selected?.type === BuilderComponentTypes.Text
            ? editSelectedComponent(session.draft, { content })
            : addComponent(session.draft, { type: BuilderComponentTypes.Text, content });

    await applyOperationResult({ context, draftRepository, result, session });
}

async function saveLinkRow({ activeSessions, context, draftRepository }) {
    const session = await getActiveSession({ activeSessions, context });
    if (!session) {
        return;
    }

    const label = String(context.modalValues[BuilderInputIds.LinkLabel] ?? '').trim();
    const url = normalizeUrl(context.modalValues[BuilderInputIds.LinkUrl]);
    if (!label || !url) {
        await context.respond('Provide a label and a valid URL.', { ephemeral: true });
        return;
    }
    if (label.length > MaxLinkButtonLabelLength) {
        await context.respond(`Link labels can have at most ${MaxLinkButtonLabelLength} characters.`, {
            ephemeral: true
        });
        return;
    }

    const action = getCustomIdAction(context.customId);
    if (action === BuilderActions.AddLinkButton) {
        await applyOperationResult({
            context,
            draftRepository,
            errorMessage: `Link rows can have at most ${MaxLinkButtonsPerRow} links.`,
            result: addLinkButton(session.draft, { label, url }),
            session
        });
        return;
    }

    if (action === BuilderActions.EditLinkButton) {
        await applyOperationResult({
            context,
            draftRepository,
            result: editSelectedLinkButton(session.draft, { label, url }),
            session
        });
        return;
    }

    await applyOperationResult({
        context,
        draftRepository,
        result: addComponent(session.draft, { type: BuilderComponentTypes.LinkButtons, buttons: [{ label, url }] }),
        session
    });
}

async function saveSection({ activeSessions, context, draftRepository }) {
    const session = await getActiveSession({ activeSessions, context });
    if (!session) {
        return;
    }

    const texts = getSectionTexts(context.modalValues);
    const thumbnailUrl = normalizeUrl(context.modalValues[BuilderInputIds.SectionThumbnail]);
    const thumbnailSpoiler = getCheckboxValue(context.modalValues[BuilderInputIds.SectionThumbnailSpoiler]);
    if (!texts.length) {
        await context.respond('Section text cannot be empty.', { ephemeral: true });
        return;
    }
    if (!thumbnailUrl) {
        await context.respond('Provide a valid thumbnail URL.', { ephemeral: true });
        return;
    }

    const selected = getSelectedComponent(session.draft);
    const data = {
        texts,
        thumbnailSpoiler,
        thumbnailUrl
    };
    const result =
        selected?.type === BuilderComponentTypes.Section
            ? editSelectedComponent(session.draft, data)
            : addComponent(session.draft, { type: BuilderComponentTypes.Section, ...data });

    await applyOperationResult({ context, draftRepository, result, session });
}

async function saveSeparator({ activeSessions, context, draftRepository }) {
    const session = await getActiveSession({ activeSessions, context });
    if (!session) {
        return;
    }

    const data = {
        divider: getCheckboxValue(context.modalValues[BuilderInputIds.SeparatorDivider]),
        spacing: getSeparatorSpacing(context.modalValues[BuilderInputIds.SeparatorSpacing])
    };
    const selected = getSelectedComponent(session.draft);
    const result =
        selected?.type === BuilderComponentTypes.Separator
            ? editSelectedComponent(session.draft, data)
            : addComponent(session.draft, { type: BuilderComponentTypes.Separator, ...data });

    await applyOperationResult({ context, draftRepository, result, session });
}

async function saveMediaGallery({ activeSessions, context, draftRepository }) {
    const session = await getActiveSession({ activeSessions, context });
    if (!session) {
        return;
    }

    const url = normalizeUrl(context.modalValues[BuilderInputIds.MediaUrl]);
    if (!url) {
        await context.respond('Provide a valid image URL.', { ephemeral: true });
        return;
    }

    const action = getCustomIdAction(context.customId);
    if (action === BuilderActions.AddGalleryImage) {
        await applyOperationResult({
            context,
            draftRepository,
            errorMessage: `Image galleries can have at most ${MaxMediaGalleryItems} images.`,
            result: addMediaItem(session.draft, {
                spoiler: false,
                url
            }),
            session
        });
        return;
    }

    if (action === BuilderActions.EditGalleryImage) {
        const selectedItem = getSelectedMediaItem(session.draft);
        await applyOperationResult({
            context,
            draftRepository,
            result: editSelectedMediaItem(session.draft, {
                spoiler: selectedItem?.spoiler === true,
                url
            }),
            session
        });
        return;
    }

    await applyOperationResult({
        context,
        draftRepository,
        result: addComponent(session.draft, {
            type: BuilderComponentTypes.MediaGallery,
            items: [
                {
                    spoiler: false,
                    url
                }
            ]
        }),
        session
    });
}

async function toggleMediaSpoiler({ context, draftRepository, session }) {
    await applyOperationResult({
        context,
        draftRepository,
        result: toggleSelectedMediaItemSpoiler(session.draft),
        session
    });
}

async function saveContainer({ activeSessions, context, draftRepository }) {
    const session = await getActiveSession({ activeSessions, context });
    if (!session) {
        return;
    }

    const accentColor = parseColor(context.modalValues[BuilderInputIds.ContainerAccent]);
    const spoiler = getCheckboxValue(context.modalValues[BuilderInputIds.ContainerSpoiler]);
    if (accentColor === false) {
        await context.respond('Use a hex color like #5865F2.', { ephemeral: true });
        return;
    }

    await applyOperationResult({
        context,
        draftRepository,
        result: editSelectedComponent(session.draft, { accentColor, spoiler }),
        session
    });
}

async function openTextModal(context, session) {
    const component = getSelectedComponent(session.draft);

    if (component?.type === BuilderComponentTypes.Text) {
        await context.openModal(buildTextModal({ content: component.content, sessionId: session.draft.sessionId }));
        return;
    }

    await context.respond('That component cannot be edited.', { ephemeral: true });
}

async function openContainerModal(context, session) {
    const component = getSelectedComponent(session.draft);

    if (component?.type === BuilderComponentTypes.Container) {
        await context.openModal(buildContainerModal({ component, sessionId: session.draft.sessionId }));
        return;
    }

    await context.respond('That component cannot be edited.', { ephemeral: true });
}

async function openSectionModal(context, session) {
    const component = getSelectedComponent(session.draft);

    if (component?.type !== BuilderComponentTypes.Section) {
        await context.respond('That component cannot be edited.', { ephemeral: true });
        return;
    }

    await context.openModal(
        buildSectionModal({
            action: BuilderActions.EditSection,
            component,
            sessionId: session.draft.sessionId
        })
    );
}

async function openSeparatorModal(context, session) {
    const component = getSelectedComponent(session.draft);

    if (component?.type !== BuilderComponentTypes.Separator) {
        await context.respond('That component cannot be edited.', { ephemeral: true });
        return;
    }

    await context.openModal(buildSeparatorModal({ component, sessionId: session.draft.sessionId }));
}

async function applyOperationResult({ context, draftRepository, errorMessage, result, session }) {
    if (result !== OperationResults.Ok) {
        await context.respond(errorMessage ?? getOperationErrorMessage(result), { ephemeral: true });
        return;
    }

    await draftRepository.save(session.draft);
    await refreshBuilderMessages(context, session);
}

async function submitSession({ activeSessions, context, session }) {
    if (session.submitting) {
        await context.respond('That Message Builder submission is already being processed.', { ephemeral: true });
        return;
    }

    const validation = validateRenderableDraft(session.draft);
    if (!validation.ok) {
        await context.respond(validation.message, { ephemeral: true });
        return;
    }

    session.submitting = true;
    const message = buildCompiledMessage(session.draft.components, {
        suppressMentions: !session.draft.allowMentions
    });
    let successMessage;

    try {
        successMessage = await session.submit({
            context,
            message
        });
    } catch {
        if (session.cancelled || activeSessions.get(context.userId) !== session) {
            session.pendingResult.resolve(createCancelledResult());
            return;
        }

        session.submitting = false;
        await context.respond(session.submitError, { ephemeral: true });
        return;
    }

    if (session.cancelled || activeSessions.get(context.userId) !== session) {
        session.pendingResult.resolve(createCancelledResult());
        return;
    }

    activeSessions.delete(context.userId);
    await context.updateMessage(successMessage);
    session.pendingResult.resolve({
        ok: true
    });
}

function cancelActiveSession(session) {
    if (!session) {
        return;
    }

    session.cancelled = true;

    if (!session.submitting) {
        session.pendingResult.resolve(createCancelledResult());
    }
}

function createPendingBuilderResult() {
    let resolveResult;
    let rejectResult;
    const promise = new Promise((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
    });

    return {
        promise,
        reject: rejectResult,
        resolve: resolveResult
    };
}

function createCancelledResult() {
    return {
        ok: false
    };
}

function formatHydrationRejectReason(reason) {
    if (reason === HydrationRejectReasons.Attachments) {
        return 'That message cannot be edited because it has attachments.';
    }

    if (reason === HydrationRejectReasons.Embeds) {
        return 'That message cannot be edited because it has embeds.';
    }

    if (reason === HydrationRejectReasons.UnsupportedContent) {
        return 'That message cannot be edited because it has unsupported message content.';
    }

    if (reason === HydrationRejectReasons.TooComplex) {
        return 'That message has more editable components than Message Builder supports.';
    }

    return 'That message cannot be edited because it uses unsupported components.';
}

async function refreshBuilderMessages(context, session) {
    await context.updateMessage(buildControllerMessage(session));
    await context.editOriginalResponse(buildDisplayMessage(session), session.displayToken);
}

async function getActiveSession({ activeSessions, context }) {
    const session = activeSessions.get(context.userId);
    const sessionId = getSessionId(context.customId);

    if (!session) {
        if (findSessionById(activeSessions, sessionId)) {
            await context.respond('That Message Builder session belongs to another user.', { ephemeral: true });
            return undefined;
        }

        await context.respond('That Message Builder session has expired.', { ephemeral: true });
        return undefined;
    }

    if (session.draft.sessionId !== sessionId) {
        await context.respond('A newer Message Builder is active.', { ephemeral: true });
        return undefined;
    }

    if (session.authorize && !(await session.authorize(context))) {
        await context.respond('You cannot use that Message Builder session.', { ephemeral: true });
        return undefined;
    }

    return session;
}

function findSessionById(activeSessions, sessionId) {
    return [...activeSessions.values()].find((session) => session.draft.sessionId === sessionId);
}

function getSessionId(customId) {
    return typeof customId === 'string' ? customId.split(':').at(-1) : undefined;
}

function getInteractionValue(context) {
    return context.values[0] ?? getCustomIdAction(context.customId);
}

function getCustomIdAction(customId) {
    if (typeof customId !== 'string') {
        return undefined;
    }

    return customId.split(':').at(2);
}

function normalizeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return undefined;
    }

    const candidate = /^[a-z][a-z\d+.-]*:/i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;

    try {
        const url = new URL(candidate);
        return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
    } catch {
        return undefined;
    }
}

function getSectionTexts(modalValues) {
    return [
        modalValues[BuilderInputIds.SectionTextOne],
        modalValues[BuilderInputIds.SectionTextTwo],
        modalValues[BuilderInputIds.SectionTextThree]
    ]
        .map((text) => String(text ?? '').trim())
        .filter(Boolean);
}

function getCheckboxValue(value) {
    return Array.isArray(value) ? value.length > 0 : value === true;
}

function getSeparatorSpacing(value) {
    const [spacing] = Array.isArray(value) ? value : [value];
    const parsed = Number.parseInt(spacing, 10);

    return [SeparatorSpacingSize.Small, SeparatorSpacingSize.Large].includes(parsed) ? parsed : undefined;
}

function parseColor(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return undefined;
    }

    const normalized = value.trim().replace(/^#|^0x/i, '');
    return /^[\da-f]{6}$/i.test(normalized) ? Number.parseInt(normalized, 16) : false;
}

function getOperationErrorMessage(result) {
    if (result === OperationResults.Full) {
        return 'This draft has reached the Message Builder limit.';
    }

    return 'That builder action is no longer available.';
}
