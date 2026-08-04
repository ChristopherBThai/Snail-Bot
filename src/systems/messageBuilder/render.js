import { ButtonStyle, ComponentType, MessageFlags, SeparatorSpacingSize, TextInputStyle } from 'discord-api-types/v10';
import {
    canAddComponent,
    canMoveComponent,
    countComponents,
    createComponent,
    getChildren,
    getComponent,
    getComponentName,
    getItems,
} from './draft.js';

export const IDS = Object.freeze({
    select: 'messageBuilder:select:',
    child: 'messageBuilder:child:',
    add: 'messageBuilder:add:',
    action: 'messageBuilder:action:',
    item: 'messageBuilder:item:',
    itemAction: 'messageBuilder:itemAction:',
    modal: 'messageBuilder:modal:',
});

export const INPUTS = Object.freeze({
    content: 'messageBuilder:content',
    accent: 'messageBuilder:accent',
    divider: 'messageBuilder:divider',
    spacing: 'messageBuilder:spacing',
    label: 'messageBuilder:label',
    url: 'messageBuilder:url',
    text1: 'messageBuilder:text1',
    text2: 'messageBuilder:text2',
    text3: 'messageBuilder:text3',
    spoiler: 'messageBuilder:spoiler',
});

const ADD_OPTIONS = [
    [ComponentType.TextDisplay, 'Text'],
    [ComponentType.Separator, 'Separator'],
    [ComponentType.ActionRow, 'Link buttons'],
    [ComponentType.Section, 'Section'],
    [ComponentType.MediaGallery, 'Gallery'],
    [ComponentType.Container, 'Container'],
];

export function buildPreview(draft) {
    return {
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
        components: draft.components.length
            ? draft.components.map(previewComponent)
            : [placeholder('Your preview is empty.')],
    };
}

export function buildMessage(draft) {
    return {
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: draft.allowMentions ? undefined : { parse: [] },
        components: draft.components,
    };
}

export function buildController(session, { disabled = false, notice } = {}) {
    const selected = getComponent(session.draft, session.selection.path);
    const children = getChildren(session.draft.components[session.selection.path[0]]);
    const items = getItems(selected);
    const selectionComponents = [
        {
            type: ComponentType.TextDisplay,
            content: `## ${session.title}${notice ? `\n-# ${notice}` : ''}`,
        },
        spacing(),
        {
            type: ComponentType.TextDisplay,
            content: `-# Selected\n${selectionName(session)}`,
        },
        spacing(),
        {
            type: ComponentType.TextDisplay,
            content: `-# Components\n${countComponents(session.draft.components)}/40`,
        },
        spacing(),
        {
            type: ComponentType.TextDisplay,
            content: `-# Session\n${disabled ? 'Ended' : `Expires <t:${Math.floor(session.expiresAt / 1000)}:R>`}`,
        },
        spacing(),
        selectRow(
            customId(IDS.select, session.id),
            'Select a top-level component',
            session.draft.components.map((component, index) => ({
                label: `${index + 1}. ${getComponentName(component)}`,
                value: String(index),
                default: session.selection.path[0] === index,
            })),
            disabled,
            { label: 'Message root', default: !session.selection.path.length },
        ),
    ];

    if (children) {
        selectionComponents.push(
            spacing(),
            selectRow(
                customId(IDS.child, session.id),
                'Select a component in this container',
                children.map((component, index) => ({
                    label: `${index + 1}. ${getComponentName(component)}`,
                    value: String(index),
                    default: session.selection.path[1] === index,
                })),
                disabled,
                { label: 'Container itself', default: session.selection.path.length === 1 },
            ),
        );
    }

    const editingComponents = [
        selectRow(
            customId(IDS.add, session.id),
            'Add a component',
            ADD_OPTIONS.filter(([type]) =>
                canAddComponent(session.draft, session.selection, createComponent(type)),
            ).map(([type, label]) => ({ label, value: String(type) })),
            disabled,
        ),
    ];

    if (selected) {
        editingComponents.push(
            spacing(),
            buttonRow([
                button(
                    customId(IDS.action, session.id, 'edit'),
                    'Edit',
                    ButtonStyle.Primary,
                    disabled || !isEditable(selected),
                ),
                button(customId(IDS.action, session.id, 'delete'), 'Delete', ButtonStyle.Danger, disabled),
                button(
                    customId(IDS.action, session.id, 'up'),
                    'Move up',
                    ButtonStyle.Secondary,
                    disabled || !canMoveComponent(session.draft, session.selection, -1),
                ),
                button(
                    customId(IDS.action, session.id, 'down'),
                    'Move down',
                    ButtonStyle.Secondary,
                    disabled || !canMoveComponent(session.draft, session.selection, 1),
                ),
            ]),
        );
    }

    if (items) {
        editingComponents.push(
            spacing(),
            selectRow(
                customId(IDS.item, session.id),
                selected.type === ComponentType.ActionRow ? 'Select a link button' : 'Select an image',
                items.map((item, index) => ({
                    label: `${index + 1}. ${item.label ?? item.media?.url ?? 'Item'}`.slice(0, 100),
                    value: String(index),
                    default: session.selection.item === index,
                })),
                disabled,
            ),
            spacing(),
            buttonRow([
                button(
                    customId(IDS.itemAction, session.id, 'add'),
                    'Add item',
                    ButtonStyle.Secondary,
                    disabled || items.length >= (selected.type === ComponentType.ActionRow ? 5 : 10),
                ),
                button(
                    customId(IDS.itemAction, session.id, 'edit'),
                    'Edit item',
                    ButtonStyle.Secondary,
                    disabled || session.selection.item === undefined,
                ),
                button(
                    customId(IDS.itemAction, session.id, 'delete'),
                    'Delete item',
                    ButtonStyle.Danger,
                    disabled || session.selection.item === undefined,
                ),
            ]),
        );
    }

    editingComponents.push(
        {
            type: ComponentType.Separator,
            divider: true,
            spacing: SeparatorSpacingSize.Small,
        },
        buttonRow([
            button(
                customId(IDS.action, session.id, 'mentions'),
                session.draft.allowMentions ? 'Mentions on' : 'Mentions off',
                session.draft.allowMentions ? ButtonStyle.Success : ButtonStyle.Secondary,
                disabled || session.allowMentions === false,
            ),
            button(
                customId(IDS.action, session.id, 'clear'),
                'Clear',
                ButtonStyle.Danger,
                disabled || !session.draft.components.length,
            ),
            button(customId(IDS.action, session.id, 'submit'), session.submitLabel, ButtonStyle.Success, disabled),
        ]),
    );

    selectionComponents.push(spacing(), ...editingComponents);

    return {
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { parse: [] },
        components: [{ type: ComponentType.Container, components: selectionComponents }],
    };
}

export function buildEditModal(session, action, component = getComponent(session.draft, session.selection.path)) {
    const customId_ = customId(IDS.modal, session.id, action);
    const kind = action.replace(/(Add|Edit)$/, '');

    if (kind === 'text') {
        return modal('Edit text', customId_, [textInput('Text', INPUTS.content, component?.content, 4000, true, true)]);
    }

    if (kind === 'separator') {
        return modal('Edit separator', customId_, [
            checkbox('Show divider', INPUTS.divider, component?.divider !== false),
            stringSelect(
                'Spacing',
                INPUTS.spacing,
                [
                    { label: 'Small', value: 'small' },
                    { label: 'Large', value: 'large' },
                ],
                component?.spacing === SeparatorSpacingSize.Large ? 'large' : 'small',
            ),
        ]);
    }

    if (kind === 'container') {
        return modal('Edit container', customId_, [
            textInput('Accent color', INPUTS.accent, component?.accentColor?.toString(16).padStart(6, '0') ?? '', 7),
            checkbox('Spoiler', INPUTS.spoiler, component?.spoiler === true),
        ]);
    }

    if (kind === 'section') {
        const texts = component?.components ?? [];
        return modal('Edit section', customId_, [
            textInput('Text 1', INPUTS.text1, texts[0]?.content, 4000, true, true),
            textInput('Text 2', INPUTS.text2, texts[1]?.content, 4000, false, true),
            textInput('Text 3', INPUTS.text3, texts[2]?.content, 4000, false, true),
            textInput('Thumbnail URL', INPUTS.url, component?.accessory?.media?.url, 2048, true),
            checkbox('Spoiler', INPUTS.spoiler, component?.accessory?.spoiler === true),
        ]);
    }

    if (kind === 'link') {
        return modal('Edit link button', customId_, [
            textInput('Label', INPUTS.label, component?.label, 80, true),
            textInput('URL', INPUTS.url, component?.url, 2048, true),
        ]);
    }

    if (kind === 'image') {
        return modal('Edit gallery image', customId_, [
            textInput('Image URL', INPUTS.url, component?.media?.url, 2048, true),
            checkbox('Spoiler', INPUTS.spoiler, component?.spoiler === true),
        ]);
    }
}

function previewComponent(component) {
    if (component.type === ComponentType.Container && !component.components.length) {
        return { ...component, components: [placeholder('Empty container')] };
    }
    if (component.type === ComponentType.Container) {
        return { ...component, components: component.components.map(previewComponent) };
    }
    if (component.type === ComponentType.ActionRow && !component.components.length)
        return placeholder('Empty link row');
    if (component.type === ComponentType.MediaGallery && !component.items.length) return placeholder('Empty gallery');
    return component;
}

function placeholder(content) {
    return { type: ComponentType.TextDisplay, content: `-# ${content}` };
}

function spacing() {
    return {
        type: ComponentType.Separator,
        divider: false,
        spacing: SeparatorSpacingSize.Small,
    };
}

function isEditable(component) {
    return [
        ComponentType.TextDisplay,
        ComponentType.Separator,
        ComponentType.Container,
        ComponentType.Section,
    ].includes(component.type);
}

function selectionName(session) {
    if (!session.selection.path.length) return 'Message root';
    const component = getComponent(session.draft, session.selection.path);
    return component
        ? `${session.selection.path.map((index) => index + 1).join('.')} ${getComponentName(component)}`
        : 'Message root';
}

function customId(prefix, sessionId, action) {
    return `${prefix}${action ? `${action}:` : ''}${sessionId}`;
}

function selectRow(customId_, placeholder_, options, disabled, rootOption) {
    const normalized = rootOption
        ? [{ label: rootOption.label, value: 'root', default: rootOption.default }, ...options]
        : options;
    return {
        type: ComponentType.ActionRow,
        components: [
            {
                type: ComponentType.StringSelect,
                customId: customId_,
                placeholder: placeholder_,
                disabled: disabled || !normalized.length,
                options: normalized.length ? normalized : [{ label: 'Nothing available', value: 'none' }],
            },
        ],
    };
}

function buttonRow(components) {
    return { type: ComponentType.ActionRow, components };
}

function button(customId_, label, style, disabled) {
    return { type: ComponentType.Button, customId: customId_, label, style, disabled };
}

function modal(title, customId_, inputs) {
    return { title, customId: customId_, components: inputs };
}

function textInput(label, customId_, value = '', maxLength = 4000, required = false, paragraph = false) {
    return {
        type: ComponentType.Label,
        label,
        component: {
            type: ComponentType.TextInput,
            customId: customId_,
            style: paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short,
            required,
            maxLength,
            ...(value ? { value } : {}),
        },
    };
}

function checkbox(label, customId_, value) {
    return {
        type: ComponentType.Label,
        label,
        component: { type: ComponentType.Checkbox, customId: customId_, default: value },
    };
}

function stringSelect(label, customId_, options, value) {
    return {
        type: ComponentType.Label,
        label,
        component: {
            type: ComponentType.StringSelect,
            customId: customId_,
            options: options.map((option) => ({ ...option, default: option.value === value })),
        },
    };
}
