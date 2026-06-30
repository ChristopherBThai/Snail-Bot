export const BuilderIDs = Object.freeze({
    Action: 'message_builder:action',
    SelectBlock: 'message_builder:select_block',
    TextModal: 'message_builder:text_modal',
    EditTextModal: 'message_builder:edit_text_modal',
    LinkModal: 'message_builder:link_modal',
    SectionModal: 'message_builder:section_modal',
    EditSectionModal: 'message_builder:edit_section_modal',
    MediaGalleryModal: 'message_builder:media_gallery_modal',
    EditContainerModal: 'message_builder:edit_container_modal',
    TextInput: 'message_builder:text',
    EditTextInput: 'message_builder:edit_text',
    LinkLabelInput: 'message_builder:link_label',
    LinkURLInput: 'message_builder:link_url',
    SectionTextInput: 'message_builder:section_text',
    SectionThumbnailInput: 'message_builder:section_thumbnail',
    MediaURLInput: 'message_builder:media_url',
    ContainerColorInput: 'message_builder:container_color',
    ContainerSpoilerInput: 'message_builder:container_spoiler'
});

export const BuilderActions = Object.freeze({
    AddText: 'add_text',
    AddSeparator: 'add_separator',
    AddLinkRow: 'add_link_row',
    AddSection: 'add_section',
    AddContainer: 'add_container',
    AddMediaGallery: 'add_media_gallery',
    AddImageToGallery: 'add_image_to_gallery',
    RemoveImageFromGallery: 'remove_image_from_gallery',
    AddLinkToRow: 'add_link_to_row',
    RemoveLinkFromRow: 'remove_link_from_row',
    EditBlock: 'edit_block',
    DeleteBlock: 'delete_block',
    MoveUp: 'move_up',
    MoveDown: 'move_down',
    Clear: 'clear',
    Submit: 'submit'
});

export const BlockKinds = Object.freeze({
    Text: 'text',
    Separator: 'separator',
    LinkButtons: 'link_buttons',
    Container: 'container',
    Section: 'section',
    MediaGallery: 'media_gallery'
});

export const OpenModes = Object.freeze({
    ReplaceFromBlocks: 'replace_from_blocks',
    Resume: 'resume'
});

export const OperationResults = Object.freeze({
    AlreadyFirst: 'already_first',
    AlreadyLast: 'already_last',
    Empty: 'empty',
    Full: 'full',
    InvalidTarget: 'invalid_target',
    NoSelection: 'no_selection',
    NotEditable: 'not_editable',
    Ok: 'ok',
    StaleSelection: 'stale_selection'
});

export const MaxRenderedComponents = 35;
export const MaxSelectableBlocks = 24;
export const MaxLinkButtonsPerRow = 5;
export const MaxMediaGalleryItems = 10;
