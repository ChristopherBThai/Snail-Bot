import { ButtonStyle, ComponentType, MessageFlags, SeparatorSpacingSize, TextInputStyle } from 'discord-api-types/v10';

export { ButtonStyle, ComponentType, MessageFlags, SeparatorSpacingSize, TextInputStyle };

export function componentsMessage(components, { ephemeral = false } = {}) {
    const flags = MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0);

    return {
        flags,
        components
    };
}

export function textDisplay(content) {
    return {
        type: ComponentType.TextDisplay,
        content
    };
}

export function actionRow(components) {
    return {
        type: ComponentType.ActionRow,
        components
    };
}

export function stringSelect(customId, options, placeholder, { disabled } = {}) {
    return {
        type: ComponentType.StringSelect,
        custom_id: customId,
        ...(disabled === undefined ? {} : { disabled }),
        options,
        placeholder
    };
}

export function checkboxGroup(customId, options, { maxValues, minValues, required = false } = {}) {
    return {
        type: ComponentType.CheckboxGroup,
        custom_id: customId,
        max_values: maxValues,
        min_values: minValues,
        options,
        required
    };
}

export function label(labelText, component) {
    return {
        type: ComponentType.Label,
        label: labelText,
        component
    };
}

export function textInput(
    customId,
    { maxLength, placeholder, required = true, style = TextInputStyle.Short, value } = {}
) {
    return {
        type: ComponentType.TextInput,
        custom_id: customId,
        required,
        style,
        ...(maxLength === undefined ? {} : { max_length: maxLength }),
        ...(placeholder === undefined ? {} : { placeholder }),
        ...(value === undefined ? {} : { value })
    };
}

export function linkButton(labelText, url) {
    return {
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        label: labelText,
        url
    };
}

export function button(customId, labelText, { disabled = false, style = ButtonStyle.Secondary } = {}) {
    return {
        type: ComponentType.Button,
        custom_id: customId,
        disabled,
        label: labelText,
        style
    };
}

export function separator({ divider = true, spacing } = {}) {
    return {
        type: ComponentType.Separator,
        divider,
        spacing
    };
}

export function container(components, { accentColor, spoiler } = {}) {
    return {
        type: ComponentType.Container,
        accent_color: accentColor,
        spoiler,
        components
    };
}

export function section(components, accessory) {
    return {
        type: ComponentType.Section,
        components,
        accessory
    };
}

export function thumbnailURL(url, { spoiler = false } = {}) {
    return {
        type: ComponentType.Thumbnail,
        media: {
            url
        },
        spoiler
    };
}

export function mediaGallery(items) {
    return {
        type: ComponentType.MediaGallery,
        items
    };
}

export function mediaURLItem(url, { spoiler = false } = {}) {
    return {
        media: {
            url
        },
        spoiler
    };
}
