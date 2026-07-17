export const BuilderComponentTypes = Object.freeze({
    Container: 'container',
    LinkButtons: 'link_buttons',
    MediaGallery: 'media_gallery',
    Section: 'section',
    Separator: 'separator',
    Text: 'text'
});

export const BuilderActions = Object.freeze({
    AddContainer: 'add_container',
    AddGalleryImage: 'add_gallery_image',
    AddLinkButton: 'add_link_button',
    AddLinkRow: 'add_link_row',
    AddMediaGallery: 'add_media_gallery',
    AddSection: 'add_section',
    AddSeparator: 'add_separator',
    AddText: 'add_text',
    Clear: 'clear',
    DeleteComponent: 'delete_component',
    DeleteGalleryImage: 'delete_gallery_image',
    DeleteLinkButton: 'delete_link_button',
    EditContainer: 'edit_container',
    EditGalleryImage: 'edit_gallery_image',
    EditLinkButton: 'edit_link_button',
    EditSection: 'edit_section',
    EditSeparator: 'edit_separator',
    EditText: 'edit_text',
    MoveDown: 'move_down',
    MoveUp: 'move_up',
    Submit: 'submit',
    ToggleMentions: 'toggle_mentions',
    ToggleMediaSpoiler: 'toggle_media_spoiler'
});

export const BuilderRouteIds = Object.freeze({
    Action: 'message_builder:action',
    AddComponent: 'message_builder:add_component',
    ContainerModal: 'message_builder:container_modal',
    LinkButtonSelect: 'message_builder:select_link',
    LinkModal: 'message_builder:link_modal',
    MediaGalleryModal: 'message_builder:media_gallery_modal',
    MediaItemSelect: 'message_builder:select_image',
    SectionModal: 'message_builder:section_modal',
    SelectComponent: 'message_builder:select_component',
    SeparatorModal: 'message_builder:separator_modal',
    TextModal: 'message_builder:text_modal'
});

export const BuilderInputIds = Object.freeze({
    ContainerAccent: 'message_builder:container_accent',
    ContainerSpoiler: 'message_builder:container_spoiler',
    LinkLabel: 'message_builder:link_label',
    LinkUrl: 'message_builder:link_url',
    MediaUrl: 'message_builder:media_url',
    SeparatorDivider: 'message_builder:separator_divider',
    SeparatorSpacing: 'message_builder:separator_spacing',
    SectionTextOne: 'message_builder:section_text_1',
    SectionTextTwo: 'message_builder:section_text_2',
    SectionTextThree: 'message_builder:section_text_3',
    SectionThumbnail: 'message_builder:section_thumbnail',
    SectionThumbnailSpoiler: 'message_builder:section_thumbnail_spoiler',
    Text: 'message_builder:text'
});

export const OperationResults = Object.freeze({
    Full: 'full',
    Ok: 'ok',
    Unavailable: 'unavailable'
});

export const MaxRenderedComponents = 40;
export const MaxMediaGalleryItems = 10;
export const MaxLinkButtonsPerRow = 5;
export const MaxLinkButtonLabelLength = 80;
export const MaxComponentsPerSelect = 24;
