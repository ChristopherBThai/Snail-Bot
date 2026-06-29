import {
    actionRow,
    checkbox,
    componentsMessage,
    label,
    linkButton,
    mediaGallery,
    mediaURLItem,
    section,
    separator,
    stringSelect,
    TextInputStyle,
    textDisplay,
    textInput,
    thumbnailURL
} from '../discord/components.js';
import {
    BlockKinds,
    BuilderActions,
    BuilderIDs,
    MaxLinkButtonsPerRow,
    MaxMediaGalleryItems,
    MaxRenderedComponents,
    MaxSelectableBlocks
} from './constants.js';
import {
    canAddBlock,
    canMoveSelectedBlock,
    formatBlockPath,
    getBlockItems,
    getBlockLabel,
    getRenderedComponentCount,
    getSelectableBlockCount,
    getSelectedBlock,
    getSelectedBlockPath
} from './model.js';

export function buildCompiledMessage(blocks) {
    return {
        ...componentsMessage(...compileBlocks(blocks)),
        allowed_mentions: { parse: [] }
    };
}

export function buildPanel(draft) {
    const items = getBlockItems(draft);
    const selected = getSelectedBlock(draft);
    const header = [
        '## Message Builder',
        `Target: ${getTargetLabel(draft.target)}`,
        `Components: ${getRenderedComponentCount(draft)}/${MaxRenderedComponents}`,
        `Editable blocks: ${getSelectableBlockCount(draft)}/${MaxSelectableBlocks}`,
        selected ? `Selected: ${getBlockLabel(selected)}` : 'Selected: Message root'
    ];

    return {
        ...componentsMessage(
            textDisplay(header.join('\n')),
            ...(items.length ? [buildBlockSelect(draft, items)] : []),
            buildActionSelect(draft),
            ...compileBlocks(draft.blocks)
        ),
        allowed_mentions: { parse: [] }
    };
}

export function buildTextModal({ content = '', edit = false, sessionID } = {}) {
    return {
        title: edit ? 'Edit Text' : 'Add Text',
        custom_id: getSessionCustomID(edit ? BuilderIDs.EditTextModal : BuilderIDs.TextModal, sessionID),
        components: [
            label(
                'Content',
                textInput(edit ? BuilderIDs.EditTextInput : BuilderIDs.TextInput, {
                    style: TextInputStyle.Paragraph,
                    value: content
                })
            )
        ]
    };
}

export function buildLinkModal({ sessionID } = {}) {
    return {
        title: 'Add Link Row',
        custom_id: getSessionCustomID(BuilderIDs.LinkModal, sessionID),
        components: [
            label('Label', textInput(BuilderIDs.LinkLabelInput)),
            label('URL', textInput(BuilderIDs.LinkURLInput))
        ]
    };
}

export function buildSectionModal({ block, edit = false, sessionID } = {}) {
    return {
        title: edit ? 'Edit Section' : 'Add Section',
        custom_id: getSessionCustomID(edit ? BuilderIDs.EditSectionModal : BuilderIDs.SectionModal, sessionID),
        components: [
            label(
                'Text',
                textInput(BuilderIDs.SectionTextInput, {
                    style: TextInputStyle.Paragraph,
                    value: block?.texts?.join('\n\n') ?? ''
                })
            ),
            label('Thumbnail image URL', textInput(BuilderIDs.SectionThumbnailInput, { required: false }))
        ]
    };
}

export function buildMediaGalleryModal({ sessionID } = {}) {
    return {
        title: 'Add Image Gallery',
        custom_id: getSessionCustomID(BuilderIDs.MediaGalleryModal, sessionID),
        components: [label('Image URL', textInput(BuilderIDs.MediaURLInput))]
    };
}

export function buildContainerModal({ block, sessionID } = {}) {
    return {
        title: 'Edit Container',
        custom_id: getSessionCustomID(BuilderIDs.EditContainerModal, sessionID),
        components: [
            label(
                'Accent color',
                textInput(BuilderIDs.ContainerColorInput, {
                    required: false,
                    value: block?.accentColor ? `#${block.accentColor.toString(16).padStart(6, '0')}` : ''
                })
            ),
            label('Spoiler', checkbox('message_builder:container_spoiler', { default: Boolean(block?.spoiler) }))
        ]
    };
}

function compileBlock(block) {
    switch (block.kind) {
        case BlockKinds.Text:
            return textDisplay(block.content ?? '');
        case BlockKinds.Separator:
            return separator();
        case BlockKinds.LinkButtons:
            return actionRow(...(block.buttons ?? []).map((button) => linkButton(button.label, button.url)));
        case BlockKinds.Container: {
            const compiled = compileBlocks(block.children ?? []);
            if (!compiled.length) {
                return textDisplay('*Empty container*');
            }

            return {
                type: 17,
                accent_color: block.accentColor,
                spoiler: block.spoiler,
                components: compiled
            };
        }
        case BlockKinds.Section: {
            const components = (block.texts ?? []).map((text) => textDisplay(text));
            if (!components.length) {
                return textDisplay('*Missing section text*');
            }

            return block.thumbnailURL
                ? section(components, thumbnailURL(block.thumbnailURL))
                : textDisplay((block.texts ?? []).join('\n'));
        }
        case BlockKinds.MediaGallery: {
            const mediaItems = (block.items ?? []).map((item) => item.url && mediaURLItem(item.url)).filter(Boolean);
            if (!mediaItems.length) {
                return textDisplay('*Missing image URL*');
            }

            return mediaGallery(...mediaItems);
        }
        default:
            return undefined;
    }
}

function compileBlocks(blocks) {
    return blocks.map(compileBlock).filter(Boolean);
}

function buildBlockSelect(draft, items) {
    return actionRow(
        stringSelect(
            getSessionCustomID(BuilderIDs.SelectBlock, draft.sessionID),
            [
                {
                    label: 'Message root',
                    value: 'root',
                    default: !draft.selectedBlockPath?.length
                },
                ...items.slice(0, MaxSelectableBlocks).map(({ block, path }) => ({
                    label: getBlockLabel(block),
                    value: formatBlockPath(path),
                    default: draft.selectedBlockPath?.join('.') === path.join('.')
                }))
            ],
            'Select a block'
        )
    );
}

function buildActionSelect(draft) {
    return actionRow(
        stringSelect(
            getSessionCustomID(BuilderIDs.Action, draft.sessionID),
            getActionOptions(draft),
            'Choose an action'
        )
    );
}

function getActionOptions(draft) {
    const selected = getSelectedBlock(draft);
    const selectedPath = getSelectedBlockPath(draft);
    const addOptions = [
        { kind: BlockKinds.Text, label: 'Add text', value: BuilderActions.AddText },
        { kind: BlockKinds.Container, label: 'Add container', value: BuilderActions.AddContainer },
        { kind: BlockKinds.Separator, label: 'Add separator', value: BuilderActions.AddSeparator },
        { kind: BlockKinds.MediaGallery, label: 'Add image gallery', value: BuilderActions.AddMediaGallery },
        { kind: BlockKinds.Section, label: 'Add section', value: BuilderActions.AddSection },
        { kind: BlockKinds.LinkButtons, label: 'Add link row', value: BuilderActions.AddLinkRow }
    ].filter((option) => canAddBlock(draft, option.kind));
    const appendOptions = [
        ...(selected?.kind === BlockKinds.MediaGallery
            ? [{ label: 'Add image', value: BuilderActions.AddImageToGallery }]
            : []),
        ...(selected?.kind === BlockKinds.MediaGallery
            ? selected.items.slice(0, MaxMediaGalleryItems).map((item, index) => ({
                  label: `Remove image: ${optionLabel(item.url)}`,
                  value: `${BuilderActions.RemoveImageFromGallery}:${index}`
              }))
            : []),
        ...(selected?.kind === BlockKinds.LinkButtons
            ? [{ label: 'Add link', value: BuilderActions.AddLinkToRow }]
            : []),
        ...(selected?.kind === BlockKinds.LinkButtons
            ? selected.buttons.slice(0, MaxLinkButtonsPerRow).map((button, index) => ({
                  label: `Remove link: ${optionLabel(button.label)}`,
                  value: `${BuilderActions.RemoveLinkFromRow}:${index}`
              }))
            : [])
    ];
    const blockOptions = [
        ...(canEditBlock(selected) ? [{ label: 'Edit selected block', value: BuilderActions.EditBlock }] : []),
        ...(selectedPath?.length && canMoveSelectedBlock(draft, -1)
            ? [{ label: 'Move up', value: BuilderActions.MoveUp }]
            : []),
        ...(selectedPath?.length && canMoveSelectedBlock(draft, 1)
            ? [{ label: 'Move down', value: BuilderActions.MoveDown }]
            : []),
        ...(selectedPath?.length ? [{ label: 'Delete selected block', value: BuilderActions.DeleteBlock }] : [])
    ];

    return [
        ...addOptions,
        ...appendOptions,
        ...blockOptions,
        { label: 'Clear draft', value: BuilderActions.Clear },
        { label: 'Save', value: BuilderActions.Save, description: getTargetLabel(draft.target), default: false }
    ].map(({ kind, ...option }) => option);
}

function optionLabel(value) {
    return String(value).replace(/\s+/g, ' ').slice(0, 65);
}

function canEditBlock(block) {
    return [BlockKinds.Container, BlockKinds.Section, BlockKinds.Text].includes(block?.kind);
}

function getTargetLabel(target) {
    if (target?.type === 'tag_create') {
        return `Create tag ${target.name}`;
    }

    if (target?.type === 'tag_edit') {
        return `Edit tag ${target.name}`;
    }

    return 'Draft';
}

export function getSessionCustomID(baseID, sessionID) {
    return `${baseID}:${sessionID}`;
}
