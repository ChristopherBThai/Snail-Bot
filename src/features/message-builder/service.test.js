import { describe, expect, test, vi } from 'vitest';
import { ComponentType, SeparatorSpacingSize } from '../../discord/components.js';
import {
    BuilderActions,
    BuilderComponentTypes,
    BuilderInputIds,
    BuilderRouteIds,
    MaxComponentsPerSelect,
    MaxLinkButtonLabelLength,
    MaxLinkButtonsPerRow,
    MaxMediaGalleryItems,
    MaxRenderedComponents
} from './constants.js';
import { createMessageBuilder } from './service.js';

describe('Message Builder service contribution', () => {
    test('starts ephemeral builder controls and resumes the current draft', async () => {
        const builder = createBuilder();
        const firstContext = createContext();

        await openBuilder(builder, firstContext, {
            components: [{ type: 'text', content: 'Saved draft' }]
        });

        const secondContext = createContext();
        await openBuilder(builder, secondContext);

        expect(secondContext.responses.at(-1).flags).toBeTruthy();
        expect(getTextDisplayContents(secondContext.responses.at(-1))).toContain('Saved draft');
        expect(hasCustomIdStartingWith(secondContext.followupMessages.at(-1), BuilderRouteIds.SelectComponent)).toBe(
            true
        );
        expect(hasCustomIdStartingWith(secondContext.followupMessages.at(-1), BuilderRouteIds.Action)).toBe(true);
    });

    test('starts fresh when a saved draft cannot be opened', async () => {
        const builder = createBuilder({
            drafts: [
                [
                    'user-id',
                    {
                        allowMentions: true,
                        components: [
                            {
                                type: BuilderComponentTypes.Section,
                                texts: ['Saved section without a thumbnail']
                            }
                        ],
                        ownerId: 'user-id'
                    }
                ]
            ]
        });
        const context = createContext();

        await openBuilder(builder, context);

        expect(hasTextDisplayContaining(context.responses.at(-1), '*Draft preview is empty.*')).toBe(true);
        expect(getButtonByLabel(getCurrentControls(context), 'Mentions: Off')).toBeTruthy();
    });

    test('starts from editable source messages without exposing hydration internals', async () => {
        const builder = createBuilder();
        const editableContext = createContext();

        await openBuilder(builder, editableContext, {
            sourceMessage: {
                components: [{ type: ComponentType.TextDisplay, content: 'Editable text' }]
            }
        });

        expect(hasTextDisplayContaining(editableContext.responses.at(-1), 'Editable text')).toBe(true);
    });

    test('cancels start with a user-facing message when a source message cannot be edited', async () => {
        const builder = createBuilder();
        const context = createContext();
        const { submission } = await openBuilder(builder, context, {
            sourceMessage: { embeds: [{}] }
        });

        expect(context.responses.at(-1)).toBe('That message cannot be edited because it has embeds.');
        expect(context.followupMessages).toHaveLength(0);
        await expect(submission).resolves.toEqual({ ok: false });
    });

    test('supersedes stale controls', async () => {
        const builder = createBuilder();
        const firstContext = createContext();
        const { submission } = await openBuilder(builder, firstContext);
        const staleCustomId = getAddComponentCustomId(getCurrentControls(firstContext));

        const secondContext = createContext();
        await openBuilder(builder, secondContext);

        await expect(submission).resolves.toEqual({ ok: false });

        const staleContext = createContext({
            customId: staleCustomId,
            values: [BuilderActions.AddText]
        });
        await getRoute(builder, BuilderRouteIds.AddComponent).handle(staleContext);

        expect(staleContext.responses.at(-1)).toBe('A newer Message Builder is active.');
        expect(staleContext.openedModal).toBeUndefined();
    });

    test('re-checks active session authorization', async () => {
        const builder = createBuilder();
        const context = createContext();
        await openBuilder(builder, context, {
            authorize: () => false
        });

        const actionContext = createContext({
            customId: getAddComponentCustomId(getCurrentControls(context), BuilderActions.AddText)
        });
        await getRoute(builder, BuilderRouteIds.AddComponent).handle(actionContext);

        expect(actionContext.responses.at(-1)).toBe('You cannot use that Message Builder session.');
        expect(actionContext.openedModal).toBeUndefined();
    });

    test('rejects interactions from another user', async () => {
        const builder = createBuilder();
        const context = createContext({ userId: 'owner-id' });
        await openBuilder(builder, context);

        const actionContext = createContext({
            customId: getAddComponentCustomId(getCurrentControls(context)),
            userId: 'other-user-id',
            values: [BuilderActions.AddText]
        });
        await getRoute(builder, BuilderRouteIds.AddComponent).handle(actionContext);

        expect(actionContext.responses.at(-1)).toBe('That Message Builder session belongs to another user.');
        expect(actionContext.openedModal).toBeUndefined();
    });

    test('adds and edits text components', async () => {
        const builder = createBuilder();
        const context = createContext();
        await openBuilder(builder, context);

        await chooseAddComponent(builder, context, BuilderActions.AddText);
        expect(context.openedModal.title).toBe('Text component');

        const textContext = createContext({
            customId: context.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.Text]: 'Hello builder'
            }
        });
        await getRoute(builder, BuilderRouteIds.TextModal).handle(textContext);

        expect(hasTextDisplayContaining(textContext.updatedMessages.at(-1), 'Hello builder')).toBe(true);
        expect(hasTextDisplayContaining(getCurrentDisplayMessage(textContext), 'Hello builder')).toBe(true);

        await chooseBuilderAction(builder, textContext, BuilderActions.EditText);
        const editContext = createContext({
            customId: textContext.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.Text]: 'Edited builder'
            }
        });
        await getRoute(builder, BuilderRouteIds.TextModal).handle(editContext);

        expect(hasTextDisplayContaining(editContext.updatedMessages.at(-1), 'Edited builder')).toBe(true);
    });

    test('keeps generated controller custom ID prefixes within the session ID budget', () => {
        const sessionIdLengthBudget = 8;
        const addComponentActions = [
            BuilderActions.AddContainer,
            BuilderActions.AddLinkRow,
            BuilderActions.AddMediaGallery,
            BuilderActions.AddSection,
            BuilderActions.AddSeparator,
            BuilderActions.AddText
        ];
        const controllerActionPrefixes = Object.values(BuilderActions).map(
            (action) => `${BuilderRouteIds.Action}:${action}:`
        );
        const addComponentPrefixes = addComponentActions.map((action) => `${BuilderRouteIds.AddComponent}:${action}:`);
        const selectPrefixes = [
            `${BuilderRouteIds.LinkButtonSelect}:`,
            `${BuilderRouteIds.MediaItemSelect}:`,
            `${BuilderRouteIds.SelectComponent}:`
        ];
        const customIdPrefixes = [...controllerActionPrefixes, ...addComponentPrefixes, ...selectPrefixes];

        expect(customIdPrefixes.every((prefix) => prefix.length <= 100 - sessionIdLengthBudget)).toBe(true);
    });

    test('sets link label input length', async () => {
        const builder = createBuilder();
        const context = createContext();
        await openBuilder(builder, context);

        await chooseAddComponent(builder, context, BuilderActions.AddLinkRow);
        const labelInput = getNestedComponents(context.openedModal).find(
            (component) => component.custom_id === BuilderInputIds.LinkLabel
        );

        expect(labelInput.max_length).toBe(MaxLinkButtonLabelLength);
    });

    test('disables or hides builder actions that are not currently available', async () => {
        const builder = createBuilder();
        const emptyContext = createContext();
        await openBuilder(builder, emptyContext);

        expect(getButtonByLabel(getCurrentControls(emptyContext), 'Clear draft').disabled).toBe(true);
        await chooseBuilderAction(builder, emptyContext, BuilderActions.ToggleMentions);
        expect(getButtonByLabel(getCurrentControls(emptyContext), 'Clear draft').disabled).toBe(false);

        const fullContext = createContext();
        await openBuilder(builder, fullContext, {
            components: Array.from({ length: MaxRenderedComponents }, () => ({ type: 'separator' }))
        });

        expect(hasCustomIdStartingWith(getCurrentControls(fullContext), BuilderRouteIds.AddComponent)).toBe(false);
    });

    test('limits add controls by the currently selected component menu', async () => {
        const builder = createBuilder();
        const rootFullContext = createContext();
        await openBuilder(builder, rootFullContext, {
            components: Array.from({ length: MaxComponentsPerSelect }, () => ({ type: 'separator' }))
        });
        await selectRoot(builder, rootFullContext);

        expect(hasCustomIdStartingWith(getCurrentControls(rootFullContext), BuilderRouteIds.AddComponent)).toBe(false);

        const splitContext = createContext();
        await openBuilder(builder, splitContext, {
            components: [
                ...Array.from({ length: MaxComponentsPerSelect - 1 }, () => ({ type: 'separator' })),
                {
                    type: 'container',
                    children: Array.from({ length: 5 }, () => ({ type: 'separator' }))
                }
            ]
        });
        await selectComponent(builder, splitContext, String(MaxComponentsPerSelect - 1));

        expect(hasCustomIdStartingWith(getCurrentControls(splitContext), BuilderRouteIds.AddComponent)).toBe(true);
    });

    test('adds new components to the current parent', async () => {
        const builder = createBuilder();
        const context = createContext();
        await openBuilder(builder, context);

        await chooseAddComponent(builder, context, BuilderActions.AddContainer);
        await chooseAddComponent(builder, context, BuilderActions.AddSeparator);
        const separatorContext = await saveSeparator(builder, context);

        expect(
            hasTextDisplayContaining(
                getCurrentControls(separatorContext),
                'New components will be added to the current container.'
            )
        ).toBe(true);

        await chooseAddComponent(builder, separatorContext, BuilderActions.AddText);
        const textContext = createContext({
            customId: separatorContext.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.Text]: 'Inside the current container'
            }
        });
        await getRoute(builder, BuilderRouteIds.TextModal).handle(textContext);

        const previewComponents = getCurrentDisplayMessage(textContext).components;

        expect(previewComponents).toEqual([
            expect.objectContaining({
                components: expect.arrayContaining([
                    expect.objectContaining({ type: ComponentType.Separator }),
                    expect.objectContaining({ content: 'Inside the current container' })
                ]),
                type: ComponentType.Container
            })
        ]);
    });

    test('adds, edits, spoilers, selects, and removes gallery images', async () => {
        const builder = createBuilder();
        const context = createContext();
        await openBuilder(builder, context);

        await chooseAddComponent(builder, context, BuilderActions.AddMediaGallery);
        const firstImageContext = createContext({
            customId: context.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.MediaUrl]: 'https://example.com/first.png'
            }
        });
        await getRoute(builder, BuilderRouteIds.MediaGalleryModal).handle(firstImageContext);

        await chooseBuilderAction(builder, firstImageContext, BuilderActions.AddGalleryImage);
        const secondImageContext = createContext({
            customId: firstImageContext.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.MediaUrl]: 'https://example.com/second.png'
            }
        });
        await getRoute(builder, BuilderRouteIds.MediaGalleryModal).handle(secondImageContext);

        await chooseBuilderAction(builder, secondImageContext, BuilderActions.EditGalleryImage);
        const editedImageContext = createContext({
            customId: secondImageContext.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.MediaUrl]: 'https://example.com/second-edited.png'
            }
        });
        await getRoute(builder, BuilderRouteIds.MediaGalleryModal).handle(editedImageContext);
        await chooseBuilderAction(builder, editedImageContext, BuilderActions.ToggleMediaSpoiler);
        await selectMediaItem(builder, editedImageContext, 0);
        await chooseBuilderAction(builder, editedImageContext, BuilderActions.DeleteGalleryImage);

        const [gallery] = getCurrentDisplayMessage(editedImageContext).components;

        expect(gallery).toEqual(
            expect.objectContaining({
                type: ComponentType.MediaGallery,
                items: [
                    expect.objectContaining({
                        media: { url: 'https://example.com/second-edited.png' },
                        spoiler: true
                    })
                ]
            })
        );
    });

    test('requires section thumbnails', async () => {
        const builder = createBuilder();
        const context = createContext();
        await openBuilder(builder, context);

        await chooseAddComponent(builder, context, BuilderActions.AddSection);
        const sectionContext = createContext({
            customId: context.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.SectionTextOne]: 'First text',
                [BuilderInputIds.SectionTextTwo]: 'Second text',
                [BuilderInputIds.SectionTextThree]: 'Third text'
            }
        });
        await getRoute(builder, BuilderRouteIds.SectionModal).handle(sectionContext);

        expect(sectionContext.responses.at(-1)).toBe('Provide a valid thumbnail URL.');
        expect(sectionContext.editedOriginalResponses).toHaveLength(0);
        expect(sectionContext.updatedMessages).toHaveLength(0);
    });

    test('uses component-specific edit controls', async () => {
        const builder = createBuilder();
        const context = createContext();
        await openBuilder(builder, context);

        await chooseAddComponent(builder, context, BuilderActions.AddText);
        const textContext = createContext({
            customId: context.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.Text]: 'Text component'
            }
        });
        await getRoute(builder, BuilderRouteIds.TextModal).handle(textContext);
        expect(getButtonLabels(getCurrentControls(textContext))).toContain('Edit text');

        await selectRoot(builder, textContext);
        await chooseAddComponent(builder, textContext, BuilderActions.AddContainer);
        expect(getButtonLabels(getCurrentControls(textContext))).toContain('Edit Container');

        await selectRoot(builder, textContext);
        await chooseAddComponent(builder, textContext, BuilderActions.AddSection);
        const sectionContext = createContext({
            customId: textContext.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.SectionTextOne]: 'Section text',
                [BuilderInputIds.SectionTextTwo]: 'Second section text',
                [BuilderInputIds.SectionTextThree]: 'Third section text',
                [BuilderInputIds.SectionThumbnail]: 'https://example.com/thumbnail.png'
            }
        });
        await getRoute(builder, BuilderRouteIds.SectionModal).handle(sectionContext);
        expect(getButtonLabels(getCurrentControls(sectionContext))).toContain('Edit section');
        expect(getButtonLabels(getCurrentControls(sectionContext))).toContain('Delete selected component');
        expect(hasTextDisplayContaining(getCurrentControls(sectionContext), 'Size: 7/40 components')).toBe(true);
        await chooseBuilderAction(builder, sectionContext, BuilderActions.EditSection);
        const sectionTextInputs = [
            BuilderInputIds.SectionTextOne,
            BuilderInputIds.SectionTextTwo,
            BuilderInputIds.SectionTextThree
        ].map((inputId) =>
            getNestedComponents(sectionContext.openedModal).find((component) => component.custom_id === inputId)
        );
        const sectionThumbnailInput = getNestedComponents(sectionContext.openedModal).find(
            (component) => component.custom_id === BuilderInputIds.SectionThumbnail
        );
        expect(sectionTextInputs.map((input) => input.value)).toEqual([
            'Section text',
            'Second section text',
            'Third section text'
        ]);
        expect(sectionThumbnailInput.value).toBe('https://example.com/thumbnail.png');

        await selectRoot(builder, sectionContext);
        await chooseAddComponent(builder, sectionContext, BuilderActions.AddMediaGallery);
        const galleryContext = createContext({
            customId: sectionContext.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.MediaUrl]: 'https://example.com/gallery.png'
            }
        });
        await getRoute(builder, BuilderRouteIds.MediaGalleryModal).handle(galleryContext);
        expect(getButtonLabels(getCurrentControls(galleryContext))).toEqual(
            expect.arrayContaining(['Add image', 'Edit image', 'Mark image spoiler', 'Remove image'])
        );
    });

    test('adds and edits separator divider and spacing', async () => {
        const builder = createBuilder();
        const context = createContext();
        await openBuilder(builder, context);

        await chooseAddComponent(builder, context, BuilderActions.AddSeparator);
        const separatorContext = await saveSeparator(builder, context, {
            [BuilderInputIds.SeparatorDivider]: [],
            [BuilderInputIds.SeparatorSpacing]: [String(SeparatorSpacingSize.Large)]
        });

        expect(getCurrentDisplayMessage(separatorContext).components).toEqual([
            expect.objectContaining({
                divider: false,
                spacing: SeparatorSpacingSize.Large,
                type: ComponentType.Separator
            })
        ]);
        expect(getButtonLabels(getCurrentControls(separatorContext))).toContain('Edit separator');

        await chooseBuilderAction(builder, separatorContext, BuilderActions.EditSeparator);
        const dividerInput = getNestedComponents(separatorContext.openedModal).find(
            (component) => component.custom_id === BuilderInputIds.SeparatorDivider
        );
        const spacingInput = getNestedComponents(separatorContext.openedModal).find(
            (component) => component.custom_id === BuilderInputIds.SeparatorSpacing
        );

        expect(dividerInput.options[0].default).toBe(false);
        expect(spacingInput.options.find((option) => option.value === String(SeparatorSpacingSize.Large)).default).toBe(
            true
        );
    });

    test('adds, edits, selects, and removes link buttons', async () => {
        const builder = createBuilder();
        const context = createContext();
        await openBuilder(builder, context);

        await chooseAddComponent(builder, context, BuilderActions.AddLinkRow);
        const firstLinkContext = createContext({
            customId: context.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.LinkLabel]: 'First',
                [BuilderInputIds.LinkUrl]: 'https://example.com/first'
            }
        });
        await getRoute(builder, BuilderRouteIds.LinkModal).handle(firstLinkContext);

        await chooseBuilderAction(builder, firstLinkContext, BuilderActions.AddLinkButton);
        const secondLinkContext = createContext({
            customId: firstLinkContext.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.LinkLabel]: 'Second',
                [BuilderInputIds.LinkUrl]: 'https://example.com/second'
            }
        });
        await getRoute(builder, BuilderRouteIds.LinkModal).handle(secondLinkContext);

        await chooseBuilderAction(builder, secondLinkContext, BuilderActions.EditLinkButton);
        const editedLinkContext = createContext({
            customId: secondLinkContext.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.LinkLabel]: 'Second edited',
                [BuilderInputIds.LinkUrl]: 'https://example.com/second-edited'
            }
        });
        await getRoute(builder, BuilderRouteIds.LinkModal).handle(editedLinkContext);
        await selectLinkButton(builder, editedLinkContext, 0);
        await chooseBuilderAction(builder, editedLinkContext, BuilderActions.DeleteLinkButton);

        const [linkRow] = getCurrentDisplayMessage(editedLinkContext).components;

        expect(linkRow.components).toEqual([
            expect.objectContaining({
                label: 'Second edited',
                url: 'https://example.com/second-edited'
            })
        ]);
    });

    test('limits link rows to five links', async () => {
        const builder = createBuilder();
        const context = createContext();
        await openBuilder(builder, context);

        await chooseAddComponent(builder, context, BuilderActions.AddLinkRow);
        let activeContext = createContext({
            customId: context.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.LinkLabel]: 'Link 1',
                [BuilderInputIds.LinkUrl]: 'https://example.com/1'
            }
        });
        await getRoute(builder, BuilderRouteIds.LinkModal).handle(activeContext);

        for (let index = 2; index <= MaxLinkButtonsPerRow; index += 1) {
            await chooseBuilderAction(builder, activeContext, BuilderActions.AddLinkButton);
            activeContext = createContext({
                customId: activeContext.openedModal.custom_id,
                modalValues: {
                    [BuilderInputIds.LinkLabel]: `Link ${index}`,
                    [BuilderInputIds.LinkUrl]: `https://example.com/${index}`
                }
            });
            await getRoute(builder, BuilderRouteIds.LinkModal).handle(activeContext);
        }

        await chooseBuilderAction(builder, activeContext, BuilderActions.AddLinkButton);
        activeContext = createContext({
            customId: activeContext.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.LinkLabel]: 'Link 6',
                [BuilderInputIds.LinkUrl]: 'https://example.com/6'
            }
        });
        await getRoute(builder, BuilderRouteIds.LinkModal).handle(activeContext);

        expect(activeContext.responses.at(-1)).toBe(`Link rows can have at most ${MaxLinkButtonsPerRow} links.`);
    });

    test('limits each image gallery to ten images', async () => {
        const builder = createBuilder();
        const context = createContext();
        await openBuilder(builder, context);

        await chooseAddComponent(builder, context, BuilderActions.AddMediaGallery);
        let activeContext = createContext({
            customId: context.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.MediaUrl]: 'https://example.com/1.png'
            }
        });
        await getRoute(builder, BuilderRouteIds.MediaGalleryModal).handle(activeContext);

        for (let index = 2; index <= MaxMediaGalleryItems; index += 1) {
            await chooseBuilderAction(builder, activeContext, BuilderActions.AddGalleryImage);
            activeContext = createContext({
                customId: activeContext.openedModal.custom_id,
                modalValues: {
                    [BuilderInputIds.MediaUrl]: `https://example.com/${index}.png`
                }
            });
            await getRoute(builder, BuilderRouteIds.MediaGalleryModal).handle(activeContext);
        }

        await chooseBuilderAction(builder, activeContext, BuilderActions.AddGalleryImage);
        activeContext = createContext({
            customId: activeContext.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.MediaUrl]: 'https://example.com/11.png'
            }
        });
        await getRoute(builder, BuilderRouteIds.MediaGalleryModal).handle(activeContext);

        expect(activeContext.responses.at(-1)).toBe(`Image galleries can have at most ${MaxMediaGalleryItems} images.`);
    });

    test('rejects empty drafts on submit', async () => {
        const builder = createBuilder();
        const context = createContext();
        const { submission } = await openBuilder(builder, context);

        await chooseBuilderAction(builder, context, BuilderActions.Submit);

        expect(context.responses.at(-1)).toBe('Add at least one component before submitting.');
        await expectPromisePending(submission);
    });

    test('deactivates the session after successful submit', async () => {
        const builder = createBuilder();
        const context = createContext();
        const submit = vi.fn(async () => 'Submitted.');
        const { submission } = await openBuilder(builder, context, { submit });

        await chooseAddComponent(builder, context, BuilderActions.AddText);
        await getRoute(builder, BuilderRouteIds.TextModal).handle(
            createContext({
                customId: context.openedModal.custom_id,
                modalValues: {
                    [BuilderInputIds.Text]: 'Ready'
                }
            })
        );
        const activeCustomId = getActionCustomId(getCurrentControls(context));
        await chooseBuilderAction(builder, context, BuilderActions.Submit);

        const result = await submission;
        expect(result).toEqual({ ok: true });
        expect(hasTextDisplayContaining(submit.mock.calls[0][0].message, 'Ready')).toBe(true);
        expect(context.updatedMessages.at(-1)).toBe('Submitted.');

        const expiredContext = createContext({
            customId: activeCustomId,
            values: [BuilderActions.AddText]
        });
        await getRoute(builder, BuilderRouteIds.Action).handle(expiredContext);

        expect(expiredContext.responses.at(-1)).toBe('That Message Builder session has expired.');

        const resumedContext = createContext();
        await openBuilder(builder, resumedContext);

        expect(hasTextDisplayContaining(resumedContext.responses.at(-1), 'Ready')).toBe(true);
    });

    test('keeps the session open when the submit action fails', async () => {
        const builder = createBuilder();
        const context = createContext();
        const submit = vi.fn().mockRejectedValueOnce(new Error('Discord failed.')).mockResolvedValueOnce('Submitted.');
        const { submission } = await openBuilder(builder, context, {
            components: [{ type: BuilderComponentTypes.Text, content: 'Ready' }],
            submitError: 'Try submitting again.',
            submit
        });

        await chooseBuilderAction(builder, context, BuilderActions.Submit);

        expect(context.responses.at(-1)).toBe('Try submitting again.');
        await expectPromisePending(submission);

        await chooseBuilderAction(builder, context, BuilderActions.Submit);
        const result = await submission;

        expect(result).toEqual({ ok: true });
        expect(submit).toHaveBeenCalledTimes(2);
        expect(hasTextDisplayContaining(submit.mock.calls[1][0].message, 'Ready')).toBe(true);
    });

    test('cancels in-flight submits from superseded sessions', async () => {
        const builder = createBuilder();
        const context = createContext();
        const deferredSubmit = createDeferred();
        const { submission } = await openBuilder(builder, context, {
            components: [{ type: BuilderComponentTypes.Text, content: 'Ready' }],
            submit: () => deferredSubmit.promise
        });

        const submitAction = chooseBuilderAction(builder, context, BuilderActions.Submit);
        await Promise.resolve();

        const nextContext = createContext();
        await openBuilder(builder, nextContext);
        deferredSubmit.resolve('Submitted.');

        await submitAction;
        await expect(submission).resolves.toEqual({ ok: false });
    });

    test('toggles mention behavior and persists the draft setting', async () => {
        const builder = createBuilder();
        const context = createContext();
        await openBuilder(builder, context, {
            components: [{ type: BuilderComponentTypes.Text, content: 'Hello <@123456789012345678>' }]
        });

        expect(getButtonByLabel(getCurrentControls(context), 'Mentions: Off')).toBeTruthy();

        await chooseBuilderAction(builder, context, BuilderActions.ToggleMentions);

        expect(getButtonByLabel(getCurrentControls(context), 'Mentions: On')).toBeTruthy();

        const resumedContext = createContext();
        let submittedContext;
        let submittedMessage;
        const { submission } = await openBuilder(builder, resumedContext, {
            async submit({ context: submitContext, message }) {
                submittedContext = submitContext;
                submittedMessage = message;
                return 'Submitted.';
            }
        });

        expect(getButtonByLabel(getCurrentControls(resumedContext), 'Mentions: On')).toBeTruthy();
        await chooseBuilderAction(builder, resumedContext, BuilderActions.Submit);

        const result = await submission;
        expect(result).toEqual({ ok: true });
        expect(submittedContext).toBe(resumedContext);
        expect(submittedMessage).not.toEqual(expect.objectContaining({ allowed_mentions: { parse: [] } }));
    });

    test('compiled submit messages suppress mentions by default', async () => {
        const builder = createBuilder();
        const context = createContext();
        let submittedContext;
        let submittedMessage;
        const { submission } = await openBuilder(builder, context, {
            components: [{ type: BuilderComponentTypes.Text, content: 'Hello <@123456789012345678>' }],
            async submit({ context: submitContext, message }) {
                submittedContext = submitContext;
                submittedMessage = message;
                return 'Submitted.';
            }
        });

        await chooseBuilderAction(builder, context, BuilderActions.Submit);

        const result = await submission;
        expect(result).toEqual({ ok: true });
        expect(submittedContext).toBe(context);
        expect(submittedMessage).toEqual(
            expect.objectContaining({
                allowed_mentions: { parse: [] }
            })
        );
    });

    test('sessions that do not allow mentions force mentions off', async () => {
        const builder = createBuilder({
            drafts: [
                [
                    'user-id',
                    {
                        allowMentions: true,
                        components: [{ type: BuilderComponentTypes.Text, content: 'Hello <@123456789012345678>' }],
                        ownerId: 'user-id'
                    }
                ]
            ]
        });
        const context = createContext();
        let submittedMessage;
        const { submission } = await openBuilder(builder, context, {
            allowMentions: false,
            async submit({ message }) {
                submittedMessage = message;
                return 'Submitted.';
            }
        });

        expect(getButtonByLabel(getCurrentControls(context), 'Mentions: Off').disabled).toBe(true);
        await chooseBuilderAction(builder, context, BuilderActions.Submit);

        await expect(submission).resolves.toEqual({ ok: true });
        expect(submittedMessage).toEqual(
            expect.objectContaining({
                allowed_mentions: { parse: [] }
            })
        );
    });

    test('clear saves an empty current draft', async () => {
        const builder = createBuilder();
        const context = createContext();
        await openBuilder(builder, context);
        await chooseBuilderAction(builder, context, BuilderActions.ToggleMentions);

        await chooseAddComponent(builder, context, BuilderActions.AddText);
        await getRoute(builder, BuilderRouteIds.TextModal).handle(
            createContext({
                customId: context.openedModal.custom_id,
                modalValues: {
                    [BuilderInputIds.Text]: 'Cleared later'
                }
            })
        );
        await chooseBuilderAction(builder, context, BuilderActions.Clear);

        const resumedContext = createContext();
        await openBuilder(builder, resumedContext);

        expect(hasTextDisplayContaining(resumedContext.responses.at(-1), '*Draft preview is empty.*')).toBe(true);
        expect(getButtonByLabel(getCurrentControls(resumedContext), 'Mentions: Off')).toBeTruthy();
    });

    test('edits container spoiler settings', async () => {
        const builder = createBuilder();
        const context = createContext();
        await openBuilder(builder, context);

        await chooseAddComponent(builder, context, BuilderActions.AddContainer);
        await chooseBuilderAction(builder, context, BuilderActions.EditContainer);
        expect(
            getNestedComponents(context.openedModal).some(
                (component) => component.custom_id === BuilderInputIds.ContainerSpoiler
            )
        ).toBe(true);

        const containerContext = createContext({
            customId: context.openedModal.custom_id,
            modalValues: {
                [BuilderInputIds.ContainerAccent]: '',
                [BuilderInputIds.ContainerSpoiler]: ['spoiler']
            }
        });
        await getRoute(builder, BuilderRouteIds.ContainerModal).handle(containerContext);
        await chooseAddComponent(builder, containerContext, BuilderActions.AddSeparator);
        const separatorContext = await saveSeparator(builder, containerContext);

        expect(getCurrentDisplayMessage(separatorContext).components).toEqual([
            expect.objectContaining({
                spoiler: true,
                type: ComponentType.Container
            })
        ]);

        await selectComponent(builder, containerContext, '0');
        await chooseBuilderAction(builder, containerContext, BuilderActions.EditContainer);
        const spoilerInput = getNestedComponents(containerContext.openedModal).find(
            (component) => component.custom_id === BuilderInputIds.ContainerSpoiler
        );
        expect(spoilerInput.options[0].default).toBe(true);
    });

    test('rejects empty containers on submit', async () => {
        const builder = createBuilder();
        const context = createContext();
        const { submission } = await openBuilder(builder, context, {
            components: [{ type: 'container', children: [] }]
        });

        await chooseBuilderAction(builder, context, BuilderActions.Submit);

        expect(context.responses.at(-1)).toBe('Remove empty containers or add content inside them before submitting.');
        await expectPromisePending(submission);
    });

    test('rejects empty link rows on submit', async () => {
        const builder = createBuilder();
        const context = createContext();
        const { submission } = await openBuilder(builder, context, {
            components: [{ type: 'link_buttons', buttons: [] }]
        });

        await chooseBuilderAction(builder, context, BuilderActions.Submit);

        expect(context.responses.at(-1)).toBe('Remove empty link rows or add at least one link before submitting.');
        await expectPromisePending(submission);
    });

    test('rejects link rows with too many links on submit', async () => {
        const builder = createBuilder();
        const context = createContext();
        const { submission } = await openBuilder(builder, context, {
            components: [
                {
                    type: 'link_buttons',
                    buttons: Array.from({ length: MaxLinkButtonsPerRow + 1 }, (_, index) => ({
                        label: `Link ${index + 1}`,
                        url: `https://example.com/${index + 1}`
                    }))
                }
            ]
        });

        await chooseBuilderAction(builder, context, BuilderActions.Submit);

        expect(context.responses.at(-1)).toBe(`Link rows can have at most ${MaxLinkButtonsPerRow} links.`);
        await expectPromisePending(submission);
    });

    test('rejects image galleries with too many images on submit', async () => {
        const builder = createBuilder();
        const context = createContext();
        const { submission } = await openBuilder(builder, context, {
            components: [
                {
                    type: 'media_gallery',
                    items: Array.from({ length: MaxMediaGalleryItems + 1 }, (_, index) => ({
                        url: `https://example.com/${index + 1}.png`
                    }))
                }
            ]
        });

        await chooseBuilderAction(builder, context, BuilderActions.Submit);

        expect(context.responses.at(-1)).toBe(`Image galleries can have at most ${MaxMediaGalleryItems} images.`);
        await expectPromisePending(submission);
    });

    test('rejects empty image galleries on submit', async () => {
        const builder = createBuilder();
        const context = createContext();
        const { submission } = await openBuilder(builder, context, {
            components: [{ type: 'media_gallery', items: [] }]
        });

        await chooseBuilderAction(builder, context, BuilderActions.Submit);

        expect(context.responses.at(-1)).toBe(
            'Remove empty image galleries or add at least one image before submitting.'
        );
        await expectPromisePending(submission);
    });
});

async function chooseAddComponent(builder, context, action) {
    const message = getCurrentControls(context);
    context.customId = getAddComponentCustomId(message, action);
    context.values = [];

    await getRoute(builder, BuilderRouteIds.AddComponent).handle(context);
}

async function openBuilder(builder, context, options = {}) {
    const submission = builder.service.start(context, {
        submit: async () => 'Submitted.',
        submitError: 'Submit failed.',
        ...options
    });

    await waitForBuilderOpen();

    return { submission };
}

async function waitForBuilderOpen() {
    // start returns the pending submit result while the initial display and controls open asynchronously.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

async function expectPromisePending(promise) {
    const pending = Symbol('pending');
    const result = await Promise.race([promise, Promise.resolve(pending)]);

    expect(result).toBe(pending);
}

function createDeferred() {
    let resolve;
    const promise = new Promise((resolvePromise) => {
        resolve = resolvePromise;
    });

    return {
        promise,
        resolve
    };
}

async function saveSeparator(builder, context, modalValues = {}) {
    const separatorContext = createContext({
        customId: context.openedModal.custom_id,
        modalValues: {
            [BuilderInputIds.SeparatorDivider]: ['divider'],
            [BuilderInputIds.SeparatorSpacing]: [String(SeparatorSpacingSize.Small)],
            ...modalValues
        }
    });

    await getRoute(builder, BuilderRouteIds.SeparatorModal).handle(separatorContext);

    return separatorContext;
}

async function chooseBuilderAction(builder, context, action) {
    const message = getCurrentControls(context);
    context.customId = getActionCustomId(message, action);
    context.values = [];

    await getRoute(builder, BuilderRouteIds.Action).handle(context);
}

async function selectMediaItem(builder, context, index) {
    const message = getCurrentControls(context);
    context.customId = getMediaItemSelectCustomId(message);
    context.values = [String(index)];

    await getRoute(builder, BuilderRouteIds.MediaItemSelect).handle(context);
}

async function selectLinkButton(builder, context, index) {
    const message = getCurrentControls(context);
    context.customId = getLinkButtonSelectCustomId(message);
    context.values = [String(index)];

    await getRoute(builder, BuilderRouteIds.LinkButtonSelect).handle(context);
}

async function selectRoot(builder, context) {
    const message = getCurrentControls(context);
    context.customId = getSelectComponentCustomId(message);
    context.values = ['root'];

    await getRoute(builder, BuilderRouteIds.SelectComponent).handle(context);
}

async function selectComponent(builder, context, path) {
    const message = getCurrentControls(context);
    context.customId = getSelectComponentCustomId(message);
    context.values = [path];

    await getRoute(builder, BuilderRouteIds.SelectComponent).handle(context);
}

function getRoute(builder, routeId) {
    return builder.routes.find((route) => route.id === routeId);
}

function getAddComponentCustomId(message, action) {
    return getNestedComponents(message).find((component) =>
        component.custom_id?.startsWith(
            action ? `${BuilderRouteIds.AddComponent}:${action}:` : `${BuilderRouteIds.AddComponent}:`
        )
    )?.custom_id;
}

function getActionCustomId(message, action) {
    return getNestedComponents(message).find((component) =>
        component.custom_id?.startsWith(action ? `${BuilderRouteIds.Action}:${action}:` : `${BuilderRouteIds.Action}:`)
    )?.custom_id;
}

function getMediaItemSelectCustomId(message) {
    return getNestedComponents(message).find((component) =>
        component.custom_id?.startsWith(`${BuilderRouteIds.MediaItemSelect}:`)
    )?.custom_id;
}

function getLinkButtonSelectCustomId(message) {
    return getNestedComponents(message).find((component) =>
        component.custom_id?.startsWith(`${BuilderRouteIds.LinkButtonSelect}:`)
    )?.custom_id;
}

function getSelectComponentCustomId(message) {
    return getNestedComponents(message).find((component) =>
        component.custom_id?.startsWith(`${BuilderRouteIds.SelectComponent}:`)
    )?.custom_id;
}

function getCurrentControls(context) {
    return [...context.responses, ...context.followupMessages, ...context.updatedMessages]
        .reverse()
        .find((message) =>
            getNestedComponents(message).some((component) => component.custom_id?.startsWith('message_builder:'))
        );
}

function getCurrentDisplayMessage(context) {
    return context.editedOriginalResponses.at(-1)?.message ?? context.responses.find((message) => message?.components);
}

function getNestedComponents(message) {
    const components = [];

    for (const component of message?.components ?? []) {
        collectNestedComponents(components, component);
    }

    return components;
}

function getButtonLabels(message) {
    return getNestedComponents(message)
        .filter((component) => component.label && component.custom_id)
        .map((component) => component.label);
}

function getButtonByLabel(message, label) {
    return getNestedComponents(message).find((component) => component.label === label && component.custom_id);
}

function getTextDisplayContents(message) {
    return getNestedComponents(message)
        .filter((component) => component.type === ComponentType.TextDisplay)
        .map((component) => component.content);
}

function hasTextDisplayContaining(message, text) {
    return getTextDisplayContents(message).some((content) => content.includes(text));
}

function hasCustomIdStartingWith(message, prefix) {
    return getNestedComponents(message).some((component) => component.custom_id?.startsWith(prefix));
}

function collectNestedComponents(components, component) {
    components.push(component);

    for (const child of component.components ?? []) {
        collectNestedComponents(components, child);
    }

    if (component.component) {
        collectNestedComponents(components, component.component);
    }

    if (component.accessory) {
        collectNestedComponents(components, component.accessory);
    }
}

function createBuilder({ drafts } = {}) {
    return createMessageBuilder({
        draftRepository: createDraftRepositoryStub(drafts)
    });
}

function createDraftRepositoryStub(drafts = []) {
    const savedDrafts = new Map(drafts);

    return {
        async load(userId) {
            const draft = savedDrafts.get(userId);

            return draft ? structuredClone(draft) : undefined;
        },
        async save(draft) {
            savedDrafts.set(draft.ownerId, {
                allowMentions: draft.allowMentions,
                components: structuredClone(draft.components),
                ownerId: draft.ownerId
            });
        }
    };
}

function createContext({ customId, modalValues = {}, userId = 'user-id', values = [] } = {}) {
    return {
        config: {
            colors: {
                ui: {
                    primary: 0x5865f2,
                    success: 0x57f287,
                    warning: 0xfee75c
                }
            }
        },
        customId,
        editedOriginalResponses: [],
        followupMessages: [],
        interaction: {
            token: 'start-token'
        },
        modalValues,
        responses: [],
        updatedMessages: [],
        userId,
        values,
        async createFollowupMessage(message) {
            this.followupMessages.push(message);
            return {
                id: `control-message-${this.followupMessages.length}`
            };
        },
        async editOriginalResponse(message, token) {
            this.editedOriginalResponses.push({ message, token });
        },
        async openModal(modal) {
            this.openedModal = modal;
        },
        async respond(message) {
            this.responses.push(message);
        },
        async updateMessage(message) {
            this.updatedMessages.push(message);
        }
    };
}
