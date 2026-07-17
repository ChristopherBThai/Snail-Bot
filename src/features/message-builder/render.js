import {
    actionRow,
    ButtonStyle,
    button,
    checkboxGroup,
    componentsMessage,
    container,
    label,
    linkButton,
    mediaGallery,
    mediaURLItem,
    SeparatorSpacingSize,
    section,
    separator,
    stringSelect,
    TextInputStyle,
    textDisplay,
    textInput,
    thumbnailURL
} from '../../discord/components.js';
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
import {
    canAddComponent,
    canAddToSelectedComponentList,
    formatComponentPath,
    getComponentItems,
    getComponentLabel,
    getRenderedComponentCount,
    getSelectedComponent,
    getSelectedComponentPath,
    getSelectedLinkButton,
    getSelectedLinkButtonIndex,
    getSelectedMediaItem,
    getSelectedMediaItemIndex
} from './model.js';

export function buildControllerMessage(session, notice) {
    const draft = session.draft;
    const items = getComponentItems(draft);
    const selected = getSelectedComponent(draft);
    const componentCount = getRenderedComponentCount(draft.components);
    const header = textDisplay(
        [
            '## Message Builder',
            `Editing: ${session.label}`,
            selected ? `Selected: ${getComponentLabel(selected)}` : 'Selected: Message root',
            `Size: ${componentCount}/${MaxRenderedComponents} components`,
            notice
        ]
            .filter(Boolean)
            .join('\n')
    );

    return {
        ...componentsMessage(
            [
                container(
                    [
                        header,
                        separator({ divider: false }),
                        ...buildSelectionControls(draft, items),
                        separator({ divider: false }),
                        ...buildCombinedControls(session)
                    ],
                    { accentColor: session.colors.ui.primary }
                )
            ],
            { ephemeral: true }
        ),
        allowed_mentions: { parse: [] }
    };
}

export function buildDisplayMessage(session) {
    const components = compileDraftComponents(session.draft.components);

    return {
        ...componentsMessage(components.length ? components : [textDisplay('*Draft preview is empty.*')], {
            ephemeral: true
        }),
        allowed_mentions: { parse: [] }
    };
}

export function buildCompiledMessage(components, { suppressMentions = true } = {}) {
    const message = componentsMessage(compileDraftComponents(components));

    return suppressMentions ? { ...message, allowed_mentions: { parse: [] } } : message;
}

export function buildTextModal({ content = '', sessionId } = {}) {
    return {
        title: 'Text component',
        custom_id: getSessionCustomId(BuilderRouteIds.TextModal, sessionId),
        components: [
            label(
                'Content',
                textInput(BuilderInputIds.Text, {
                    style: TextInputStyle.Paragraph,
                    value: content
                })
            )
        ]
    };
}

export function buildLinkModal({ action, button, sessionId } = {}) {
    return {
        title: 'Link Row',
        custom_id: action
            ? getSessionActionCustomId(BuilderRouteIds.LinkModal, action, sessionId)
            : getSessionCustomId(BuilderRouteIds.LinkModal, sessionId),
        components: [
            label(
                'Label',
                textInput(BuilderInputIds.LinkLabel, {
                    maxLength: MaxLinkButtonLabelLength,
                    value: button?.label ?? ''
                })
            ),
            label('URL', textInput(BuilderInputIds.LinkUrl, { value: button?.url ?? '' }))
        ]
    };
}

export function buildSectionModal({ action, component, sessionId } = {}) {
    const customId = action
        ? getSessionActionCustomId(BuilderRouteIds.SectionModal, action, sessionId)
        : getSessionCustomId(BuilderRouteIds.SectionModal, sessionId);

    return {
        title: 'Section',
        custom_id: customId,
        components: [
            label(
                'Text 1',
                textInput(BuilderInputIds.SectionTextOne, {
                    style: TextInputStyle.Paragraph,
                    value: component?.texts?.[0] ?? ''
                })
            ),
            label(
                'Text 2',
                textInput(BuilderInputIds.SectionTextTwo, {
                    required: false,
                    style: TextInputStyle.Paragraph,
                    value: component?.texts?.[1] ?? ''
                })
            ),
            label(
                'Text 3',
                textInput(BuilderInputIds.SectionTextThree, {
                    required: false,
                    style: TextInputStyle.Paragraph,
                    value: component?.texts?.[2] ?? ''
                })
            ),
            label(
                'Thumbnail URL',
                textInput(BuilderInputIds.SectionThumbnail, {
                    required: false,
                    value: component?.thumbnailUrl ?? ''
                })
            ),
            label(
                'Thumbnail spoiler',
                checkboxGroup(
                    BuilderInputIds.SectionThumbnailSpoiler,
                    [
                        {
                            default: component?.thumbnailSpoiler === true,
                            label: 'Mark thumbnail as spoiler',
                            value: 'spoiler'
                        }
                    ],
                    { maxValues: 1, minValues: 0, required: false }
                )
            )
        ]
    };
}

export function buildSeparatorModal({ component, sessionId } = {}) {
    return {
        title: 'Separator',
        custom_id: getSessionCustomId(BuilderRouteIds.SeparatorModal, sessionId),
        components: [
            label(
                'Divider',
                checkboxGroup(
                    BuilderInputIds.SeparatorDivider,
                    [
                        {
                            default: component?.divider !== false,
                            label: 'Show divider line',
                            value: 'divider'
                        }
                    ],
                    { maxValues: 1, minValues: 0, required: false }
                )
            ),
            label(
                'Spacing',
                stringSelect(
                    BuilderInputIds.SeparatorSpacing,
                    [
                        {
                            default: (component?.spacing ?? SeparatorSpacingSize.Small) === SeparatorSpacingSize.Small,
                            label: 'Small',
                            value: String(SeparatorSpacingSize.Small)
                        },
                        {
                            default: component?.spacing === SeparatorSpacingSize.Large,
                            label: 'Large',
                            value: String(SeparatorSpacingSize.Large)
                        }
                    ],
                    'Separator spacing'
                )
            )
        ]
    };
}

export function buildMediaGalleryModal({ action, item, sessionId } = {}) {
    return {
        title: 'Image Gallery',
        custom_id: action
            ? getSessionActionCustomId(BuilderRouteIds.MediaGalleryModal, action, sessionId)
            : getSessionCustomId(BuilderRouteIds.MediaGalleryModal, sessionId),
        components: [label('Image URL', textInput(BuilderInputIds.MediaUrl, { value: item?.url ?? '' }))]
    };
}

export function buildContainerModal({ component, sessionId } = {}) {
    return {
        title: 'Container',
        custom_id: getSessionCustomId(BuilderRouteIds.ContainerModal, sessionId),
        components: [
            label(
                'Accent color',
                textInput(BuilderInputIds.ContainerAccent, {
                    required: false,
                    value: component?.accentColor ? `#${component.accentColor.toString(16).padStart(6, '0')}` : ''
                })
            ),
            label(
                'Container spoiler',
                checkboxGroup(
                    BuilderInputIds.ContainerSpoiler,
                    [
                        {
                            default: component?.spoiler === true,
                            label: 'Mark container as spoiler',
                            value: 'spoiler'
                        }
                    ],
                    { maxValues: 1, minValues: 0, required: false }
                )
            )
        ]
    };
}

export function getSessionCustomId(baseId, sessionId) {
    return `${baseId}:${sessionId}`;
}

function buildSelectionControls(draft, items) {
    if (!items.length) {
        return [textDisplay('Add a component below to start building the message.')];
    }

    const selectedPath = getSelectedComponentPath(draft);
    const topLevelSelectedPath = selectedPath.length ? [selectedPath[0]] : [];
    const selectedTopLevelComponent = topLevelSelectedPath.length
        ? draft.components[topLevelSelectedPath[0]]
        : undefined;

    return [
        textDisplay(
            '### Select Component\nChoose a message root component first. If it is a container, use the second menu to choose inside it.'
        ),
        actionRow([
            stringSelect(
                getSessionCustomId(`${BuilderRouteIds.SelectComponent}:root`, draft.sessionId),
                getRootComponentOptions(draft, topLevelSelectedPath),
                'Root or top-level component'
            )
        ]),
        buildContainerChildComponentSelect(draft, selectedTopLevelComponent, topLevelSelectedPath, selectedPath)
    ];
}

function buildContainerChildComponentSelect(draft, containerComponent, containerPath, selectedPath) {
    const canSelectChild = containerComponent?.type === BuilderComponentTypes.Container;
    const options = canSelectChild
        ? [
              {
                  label: 'Container itself',
                  value: formatComponentPath(containerPath),
                  default: selectedPath.join('.') === containerPath.join('.')
              },
              ...(containerComponent.children ?? []).slice(0, MaxComponentsPerSelect).map((component, index) => {
                  const childPath = [...containerPath, index];

                  return {
                      label: getComponentLabel(component),
                      value: formatComponentPath(childPath),
                      default: selectedPath.join('.') === childPath.join('.')
                  };
              })
          ]
        : [
              {
                  label: 'Select a container first',
                  value: 'disabled',
                  default: true
              }
          ];

    return actionRow([
        stringSelect(
            getSessionCustomId(`${BuilderRouteIds.SelectComponent}:container`, draft.sessionId),
            options,
            'Component inside selected container',
            { disabled: !canSelectChild }
        )
    ]);
}

function getRootComponentOptions(draft, selectedPath) {
    return [
        {
            label: 'Message root',
            value: 'root',
            default: !selectedPath.length
        },
        ...draft.components.slice(0, MaxComponentsPerSelect).map((component, index) => ({
            label: getComponentLabel(component),
            value: formatComponentPath([index]),
            default: selectedPath[0] === index
        }))
    ];
}

function buildCombinedControls(session) {
    return [
        ...buildSelectedComponentControls(session),
        ...withSeparator(buildAddControls(session)),
        ...buildBuilderControls(session)
    ];
}

function buildSelectedComponentControls(session) {
    const selected = getSelectedComponent(session.draft);
    const selectedPath = getSelectedComponentPath(session.draft);
    const actions = getComponentActions(selected);
    const selectedActions = selectedPath.length
        ? [
              ...actions,
              {
                  label: 'Delete selected component',
                  value: BuilderActions.DeleteComponent
              }
          ]
        : actions;

    return selectedActions.length
        ? [textDisplay('### Selected Component'), buildActionRow(session, selectedActions)]
        : [];
}

function buildAddControls(session) {
    const options = getAddComponentOptions(session.draft);
    if (!options.length) {
        return [];
    }

    return [
        textDisplay(
            isAddingInsideContainer(session.draft)
                ? '### Add Component\nNew components will be added to the current container.'
                : '### Add Component\nNew components will be added to the message root.'
        ),
        ...chunk(options, 3).map((row) =>
            actionRow(
                row.map((option) =>
                    button(
                        getSessionActionCustomId(BuilderRouteIds.AddComponent, option.value, session.draft.sessionId),
                        option.label
                    )
                )
            )
        )
    ];
}

function buildBuilderControls(session) {
    const subcomponentControls = buildSubcomponentControls(session);

    return [
        ...subcomponentControls,
        ...(subcomponentControls.length ? [separator({ divider: false })] : []),
        ...buildMoveComponentControls(session),
        separator({ divider: false }),
        ...buildFinishControls(session)
    ];
}

function buildSubcomponentControls(session) {
    const selected = getSelectedComponent(session.draft);

    if (selected?.type === BuilderComponentTypes.LinkButtons) {
        return buildLinkRowControls(session);
    }

    if (selected?.type === BuilderComponentTypes.MediaGallery) {
        return buildMediaGalleryControls(session);
    }

    return [];
}

function buildLinkRowControls(session) {
    const selected = getSelectedComponent(session.draft);
    if (selected?.type !== BuilderComponentTypes.LinkButtons) {
        return [];
    }

    const selectedLinkButton = getSelectedLinkButton(session.draft);
    const selectedIndex = getSelectedLinkButtonIndex(session.draft);
    const controls = [
        textDisplay('### Selected Link'),
        ...(selected.buttons?.length
            ? [
                  actionRow([
                      stringSelect(
                          getSessionCustomId(BuilderRouteIds.LinkButtonSelect, session.draft.sessionId),
                          selected.buttons.slice(0, MaxComponentsPerSelect).map((button, index) => ({
                              label: button.label,
                              value: String(index),
                              default: selectedIndex === index
                          })),
                          'Select link'
                      )
                  ])
              ]
            : []),
        buildActionRow(session, [
            { disabled: !selectedLinkButton, label: 'Edit link', value: BuilderActions.EditLinkButton },
            { disabled: !selectedLinkButton, label: 'Remove link', value: BuilderActions.DeleteLinkButton }
        ])
    ];

    return controls;
}

function buildMediaGalleryControls(session) {
    const selected = getSelectedComponent(session.draft);
    if (selected?.type !== BuilderComponentTypes.MediaGallery) {
        return [];
    }

    const selectedMediaItem = getSelectedMediaItem(session.draft);
    const selectedIndex = getSelectedMediaItemIndex(session.draft);
    const controls = [
        textDisplay('### Selected Image'),
        ...(selected.items?.length
            ? [
                  actionRow([
                      stringSelect(
                          getSessionCustomId(BuilderRouteIds.MediaItemSelect, session.draft.sessionId),
                          selected.items.slice(0, MaxComponentsPerSelect).map((item, index) => ({
                              label: `Image ${index + 1}${item.spoiler ? ' (spoiler)' : ''}`,
                              value: String(index),
                              default: selectedIndex === index
                          })),
                          'Select image'
                      )
                  ])
              ]
            : []),
        buildActionRow(session, [
            { disabled: !selectedMediaItem, label: 'Edit image', value: BuilderActions.EditGalleryImage },
            {
                disabled: !selectedMediaItem,
                label: selectedMediaItem?.spoiler ? 'Remove image spoiler' : 'Mark image spoiler',
                value: BuilderActions.ToggleMediaSpoiler
            },
            { disabled: !selectedMediaItem, label: 'Remove image', value: BuilderActions.DeleteGalleryImage }
        ])
    ];

    return controls;
}

function getAddComponentOptions(draft) {
    if (getRenderedComponentCount(draft.components) >= MaxRenderedComponents || !canAddToSelectedComponentList(draft)) {
        return [];
    }

    const addOptions = [
        { type: BuilderComponentTypes.Text, label: 'Add text', value: BuilderActions.AddText },
        { type: BuilderComponentTypes.Container, label: 'Add container', value: BuilderActions.AddContainer },
        { type: BuilderComponentTypes.Separator, label: 'Add separator', value: BuilderActions.AddSeparator },
        { type: BuilderComponentTypes.LinkButtons, label: 'Add link row', value: BuilderActions.AddLinkRow },
        { type: BuilderComponentTypes.Section, label: 'Add section', value: BuilderActions.AddSection },
        { type: BuilderComponentTypes.MediaGallery, label: 'Add image gallery', value: BuilderActions.AddMediaGallery }
    ].filter((option) => canAddComponent(draft, option.type));

    return addOptions.map(({ label, value }) => ({ label, value }));
}

function isAddingInsideContainer(draft) {
    const selectedPath = getSelectedComponentPath(draft);
    const selected = getSelectedComponent(draft);

    return selected?.type === BuilderComponentTypes.Container || selectedPath.length > 1;
}

function buildMoveComponentControls(session) {
    const draft = session.draft;
    const selectedPath = getSelectedComponentPath(draft);
    const selectedIndex = selectedPath.at(-1);
    const siblingCount = getSiblingCount(draft.components, selectedPath);
    const selectedHasSiblings = selectedIndex !== undefined && siblingCount !== undefined;

    return [
        textDisplay('### Move Component'),
        buildActionRow(session, [
            {
                disabled: !selectedPath.length || !selectedHasSiblings || selectedIndex <= 0,
                label: 'Move up',
                value: BuilderActions.MoveUp
            },
            {
                disabled: !selectedPath.length || !selectedHasSiblings || selectedIndex >= siblingCount - 1,
                label: 'Move down',
                value: BuilderActions.MoveDown
            }
        ])
    ];
}

function buildFinishControls(session) {
    return [
        textDisplay('### Finish Builder'),
        buildActionRow(session, [
            {
                disabled: !session.allowMentions,
                label: session.draft.allowMentions ? 'Mentions: On' : 'Mentions: Off',
                style: session.draft.allowMentions ? ButtonStyle.Success : ButtonStyle.Secondary,
                value: BuilderActions.ToggleMentions
            },
            {
                disabled: !session.draft.components.length && !session.draft.allowMentions,
                label: 'Clear draft',
                value: BuilderActions.Clear
            },
            { label: session.submitLabel, value: BuilderActions.Submit }
        ])
    ];
}

function compileComponent(component) {
    if (component.type === BuilderComponentTypes.Text) {
        return textDisplay(component.content ?? '');
    }

    if (component.type === BuilderComponentTypes.Separator) {
        return separator(component);
    }

    if (component.type === BuilderComponentTypes.LinkButtons) {
        const buttons = (component.buttons ?? []).map((button) => linkButton(button.label, button.url));

        return buttons.length ? actionRow(buttons) : textDisplay('*Missing links*');
    }

    if (component.type === BuilderComponentTypes.Container) {
        const children = compileDraftComponents(component.children ?? []);

        return children.length ? container(children, component) : textDisplay('*Empty container*');
    }

    if (component.type === BuilderComponentTypes.Section) {
        const texts = component.texts ?? [];
        const textComponents = texts.map((text) => textDisplay(text));

        if (!textComponents.length) {
            return textDisplay('*Missing section text*');
        }

        return section(
            textComponents,
            thumbnailURL(component.thumbnailUrl, { spoiler: component.thumbnailSpoiler === true })
        );
    }

    if (component.type === BuilderComponentTypes.MediaGallery) {
        const items = (component.items ?? [])
            .map((item) => item.url && mediaURLItem(item.url, { spoiler: item.spoiler === true }))
            .filter(Boolean);

        return items.length ? mediaGallery(items) : textDisplay('*Missing image URL*');
    }

    return undefined;
}

function compileDraftComponents(components) {
    return components.flatMap((component) => compileComponent(component) ?? []);
}

function getComponentActions(component) {
    if (component?.type === BuilderComponentTypes.Container) {
        return [{ label: 'Edit Container', value: BuilderActions.EditContainer }];
    }

    if (component?.type === BuilderComponentTypes.Text) {
        return [{ label: 'Edit text', value: BuilderActions.EditText }];
    }

    if (component?.type === BuilderComponentTypes.Section) {
        return [{ label: 'Edit section', value: BuilderActions.EditSection }];
    }

    if (component?.type === BuilderComponentTypes.Separator) {
        return [{ label: 'Edit separator', value: BuilderActions.EditSeparator }];
    }

    if (component?.type === BuilderComponentTypes.LinkButtons) {
        return [
            {
                disabled: (component.buttons?.length ?? 0) >= MaxLinkButtonsPerRow,
                label: 'Add link',
                value: BuilderActions.AddLinkButton
            }
        ];
    }

    if (component?.type === BuilderComponentTypes.MediaGallery) {
        return [
            {
                disabled: (component.items?.length ?? 0) >= MaxMediaGalleryItems,
                label: 'Add image',
                value: BuilderActions.AddGalleryImage
            }
        ];
    }

    return [];
}

function getSiblingCount(components, path) {
    if (!path.length) {
        return undefined;
    }

    let siblings = components;

    for (const index of path.slice(0, -1)) {
        const component = siblings[index];
        if (!component?.children) {
            return undefined;
        }

        siblings = component.children;
    }

    return siblings.length;
}

function buildActionRow(session, options) {
    return actionRow(
        options.map((option) =>
            button(
                getSessionActionCustomId(BuilderRouteIds.Action, option.value, session.draft.sessionId),
                option.label,
                {
                    disabled: option.disabled,
                    style: option.style ?? getActionButtonStyle(option.value)
                }
            )
        )
    );
}

function getSessionActionCustomId(baseId, action, sessionId) {
    return `${baseId}:${action}:${sessionId}`;
}

function getActionButtonStyle(action) {
    if (action === BuilderActions.Submit) {
        return ButtonStyle.Success;
    }

    if ([BuilderActions.Clear, BuilderActions.DeleteComponent].includes(action)) {
        return ButtonStyle.Danger;
    }

    return ButtonStyle.Primary;
}

function chunk(items, size) {
    const chunks = [];

    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }

    return chunks;
}

function withSeparator(components) {
    return components.length ? [separator({ divider: false }), ...components, separator({ divider: false })] : [];
}
