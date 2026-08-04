import { ButtonStyle, ComponentType } from 'discord-api-types/v10';
import { createDraft, validateDraft } from './draft.js';

export function hydrateMessage(message) {
    if (message.embeds?.length || message.attachments?.length || message.stickerItems?.length || message.poll) {
        return failure('That message contains content the Message Builder does not support.');
    }

    const components = [];
    if (message.content) components.push({ type: ComponentType.TextDisplay, content: message.content });
    components.push(...(message.components ?? []));

    return hydrateDraft({ allowMentions: false, components });
}

export function hydrateDraft(value, { allowIncomplete = false } = {}) {
    if (!value || !Array.isArray(value.components)) return failure('The saved draft is not valid.');

    const components = [];
    for (const component of value.components) {
        const hydrated = hydrateComponent(component, true, allowIncomplete);
        if (!hydrated) return failure('The draft contains an unsupported or invalid component.');
        components.push(hydrated);
    }

    const draft = createDraft(components, value.allowMentions === true);
    const validation = validateDraft(draft, { allowIncomplete });
    return validation.ok ? { ok: true, draft } : validation;
}

function hydrateComponent(component, topLevel, allowIncomplete) {
    if (!component || typeof component !== 'object') return;

    if (
        component.type === ComponentType.TextDisplay &&
        typeof component.content === 'string' &&
        component.content.trim()
    ) {
        return { type: ComponentType.TextDisplay, content: component.content };
    }

    if (component.type === ComponentType.Separator) {
        return {
            type: ComponentType.Separator,
            divider: component.divider !== false,
            spacing: component.spacing,
        };
    }

    if (component.type === ComponentType.ActionRow && Array.isArray(component.components)) {
        const buttons = component.components.map(hydrateLinkButton);
        if (buttons.some((button) => !button) || (!allowIncomplete && !buttons.length) || buttons.length > 5) return;
        return { type: ComponentType.ActionRow, components: buttons };
    }

    if (component.type === ComponentType.Container && topLevel && Array.isArray(component.components)) {
        const children = component.components.map((child) => hydrateComponent(child, false, allowIncomplete));
        if (children.some((child) => !child) || (!allowIncomplete && !children.length)) return;
        const accentColor = Number.isInteger(component.accentColor) ? component.accentColor : undefined;
        if (accentColor !== undefined && (accentColor < 0 || accentColor > 0xffffff)) return;
        return {
            type: ComponentType.Container,
            components: children,
            ...(accentColor === undefined ? {} : { accentColor }),
            spoiler: component.spoiler === true,
        };
    }

    if (component.type === ComponentType.Section && Array.isArray(component.components)) {
        const text = component.components.map((child) => hydrateComponent(child, false, allowIncomplete));
        const accessory = hydrateThumbnail(component.accessory);
        if (text.some((child) => child?.type !== ComponentType.TextDisplay) || !accessory) return;
        if (text.length < 1 || text.length > 3) return;
        return { type: ComponentType.Section, components: text, accessory };
    }

    if (component.type === ComponentType.MediaGallery && Array.isArray(component.items)) {
        const items = component.items.map(hydrateMediaItem);
        if (items.some((item) => !item) || (!allowIncomplete && !items.length) || items.length > 10) return;
        return { type: ComponentType.MediaGallery, items };
    }
}

function hydrateLinkButton(button) {
    if (button?.type !== ComponentType.Button || button.style !== ButtonStyle.Link || !validUrl(button.url)) return;
    if (!button.label?.trim() && !button.emoji) return;

    return {
        type: ComponentType.Button,
        style: ButtonStyle.Link,
        url: button.url,
        ...(button.label ? { label: button.label } : {}),
        ...(button.emoji ? { emoji: button.emoji } : {}),
        ...(button.disabled ? { disabled: true } : {}),
    };
}

function hydrateThumbnail(thumbnail) {
    if (thumbnail?.type !== ComponentType.Thumbnail || !validUrl(thumbnail.media?.url)) return;
    return {
        type: ComponentType.Thumbnail,
        media: { url: thumbnail.media.url },
        spoiler: thumbnail.spoiler === true,
    };
}

function hydrateMediaItem(item) {
    if (!validUrl(item?.media?.url)) return;
    return { media: { url: item.media.url }, spoiler: item.spoiler === true };
}

function validUrl(value) {
    if (typeof value !== 'string') return false;
    try {
        return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

function failure(message) {
    return { ok: false, message };
}
