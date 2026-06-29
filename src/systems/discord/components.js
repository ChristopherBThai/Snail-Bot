import { ButtonStyle, ChannelType, ComponentType, MessageFlags, TextInputStyle } from 'discord-api-types/v10';

export { ButtonStyle, ChannelType, ComponentType, MessageFlags, TextInputStyle };

export function componentsMessage(...components) {
    return {
        flags: MessageFlags.IsComponentsV2,
        components
    };
}

export function ephemeralComponentsMessage(...components) {
    return {
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components
    };
}

export function ephemeralText(content) {
    return ephemeralComponentsMessage(textDisplay(content));
}

export function textDisplay(content) {
    return {
        type: ComponentType.TextDisplay,
        content
    };
}

export function fileDisplay(filename, { spoiler = false } = {}) {
    return {
        type: ComponentType.File,
        file: {
            url: `attachment://${filename}`
        },
        spoiler
    };
}

export function mediaGallery(...items) {
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

export function thumbnailURL(url, { spoiler = false } = {}) {
    return {
        type: ComponentType.Thumbnail,
        media: {
            url
        },
        spoiler
    };
}

export function accentContainer(accentColor, ...components) {
    return {
        type: ComponentType.Container,
        accent_color: accentColor,
        components
    };
}

export function container(...components) {
    return {
        type: ComponentType.Container,
        components
    };
}

export function separator({ divider = true, spacing } = {}) {
    return {
        type: ComponentType.Separator,
        divider,
        spacing
    };
}

export function section(components, accessory) {
    return {
        type: ComponentType.Section,
        components,
        accessory
    };
}

export function actionRow(...components) {
    return {
        type: ComponentType.ActionRow,
        components
    };
}

export function actionButton(label, customID, { style = ButtonStyle.Secondary, disabled = false } = {}) {
    return {
        type: ComponentType.Button,
        style,
        label,
        custom_id: customID,
        disabled
    };
}

export function linkButton(label, url, { disabled = false } = {}) {
    return {
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        label,
        url,
        disabled
    };
}

export function stringSelect(customID, options, placeholder, { required } = {}) {
    return {
        type: ComponentType.StringSelect,
        custom_id: customID,
        placeholder,
        options,
        required
    };
}

export function channelSelect(customID, { channelTypes, defaultValues, placeholder, required } = {}) {
    return {
        type: ComponentType.ChannelSelect,
        custom_id: customID,
        placeholder,
        channel_types: channelTypes,
        default_values: defaultValues,
        required
    };
}

export function userSelect(customID, { maxValues = 25, minValues = 1, placeholder, required } = {}) {
    return {
        type: ComponentType.UserSelect,
        custom_id: customID,
        placeholder,
        min_values: minValues,
        max_values: maxValues,
        required
    };
}

export function label(labelText, component, description) {
    return {
        type: ComponentType.Label,
        label: labelText,
        description,
        component
    };
}

export function textInput(customID, { placeholder, value, required = true, style = TextInputStyle.Short } = {}) {
    return {
        type: ComponentType.TextInput,
        custom_id: customID,
        style,
        placeholder,
        value,
        required
    };
}

export function checkbox(customID, { default: checked = false } = {}) {
    return {
        type: ComponentType.Checkbox,
        custom_id: customID,
        default: checked
    };
}
