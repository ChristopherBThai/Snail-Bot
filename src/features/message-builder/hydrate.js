import { ButtonStyle, ComponentType } from '../../discord/components.js';
import { BuilderComponentTypes, MaxRenderedComponents } from './constants.js';
import { createDraft, getRenderedComponentCount, hasSelectableComponentOverflow } from './model.js';

export const HydrationRejectReasons = Object.freeze({
    Attachments: 'attachments',
    Embeds: 'embeds',
    TooComplex: 'too_complex',
    UnsupportedComponent: 'unsupported_component',
    UnsupportedContent: 'unsupported_content'
});

export function createDraftFromMessage(message, { ownerId, sessionId } = {}) {
    if (message.embeds?.length) {
        return { ok: false, reason: HydrationRejectReasons.Embeds };
    }

    if (hasCollectionItems(message.attachments)) {
        return { ok: false, reason: HydrationRejectReasons.Attachments };
    }

    if (message.poll || hasCollectionItems(message.sticker_items) || hasCollectionItems(message.stickers)) {
        return { ok: false, reason: HydrationRejectReasons.UnsupportedContent };
    }

    const components = [];
    const content = String(message.content ?? '').trim();
    if (content) {
        components.push({ type: BuilderComponentTypes.Text, content });
    }

    for (const component of message.components ?? []) {
        const hydrated = hydrateComponent(component);
        if (!hydrated) {
            return { ok: false, reason: HydrationRejectReasons.UnsupportedComponent };
        }

        components.push(hydrated);
    }

    const draft = createDraft({ components, ownerId, sessionId });

    if (getRenderedComponentCount(draft.components) > MaxRenderedComponents || hasSelectableComponentOverflow(draft)) {
        return { ok: false, reason: HydrationRejectReasons.TooComplex };
    }

    return { ok: true, draft };
}

function hydrateComponent(component, { insideContainer = false } = {}) {
    if (component.type === ComponentType.TextDisplay) {
        return hydrateTextDisplay(component);
    }

    if (component.type === ComponentType.Separator) {
        return {
            type: BuilderComponentTypes.Separator,
            divider: component.divider,
            spacing: component.spacing
        };
    }

    if (component.type === ComponentType.ActionRow) {
        return hydrateActionRow(component);
    }

    if (component.type === ComponentType.Container) {
        return insideContainer ? undefined : hydrateContainer(component);
    }

    if (component.type === ComponentType.Section) {
        return hydrateSection(component);
    }

    if (component.type === ComponentType.MediaGallery) {
        return hydrateMediaGallery(component);
    }

    return undefined;
}

function hydrateTextDisplay(component) {
    return typeof component.content === 'string'
        ? { type: BuilderComponentTypes.Text, content: component.content }
        : undefined;
}

function hydrateActionRow(component) {
    const buttons = component.components ?? [];

    if (!buttons.length || buttons.some((buttonComponent) => !isLinkButton(buttonComponent))) {
        return undefined;
    }

    return {
        type: BuilderComponentTypes.LinkButtons,
        buttons: buttons.map((buttonComponent) => ({
            label: buttonComponent.label,
            url: buttonComponent.url
        }))
    };
}

function hydrateContainer(component) {
    const children = [];

    for (const child of component.components ?? []) {
        const hydrated = hydrateComponent(child, { insideContainer: true });
        if (!hydrated) {
            return undefined;
        }

        children.push(hydrated);
    }

    return {
        type: BuilderComponentTypes.Container,
        accentColor: component.accent_color,
        children,
        spoiler: component.spoiler
    };
}

function hydrateSection(component) {
    const texts = [];

    for (const child of component.components ?? []) {
        if (child.type !== ComponentType.TextDisplay || typeof child.content !== 'string') {
            return undefined;
        }

        texts.push(child.content);
    }

    if (!texts.length || texts.length > 3) {
        return undefined;
    }

    const thumbnail = hydrateThumbnail(component.accessory);
    if (!thumbnail) {
        return undefined;
    }

    return {
        type: BuilderComponentTypes.Section,
        texts,
        thumbnailSpoiler: thumbnail?.spoiler,
        thumbnailUrl: thumbnail?.url
    };
}

function hydrateMediaGallery(component) {
    const items = [];

    for (const item of component.items ?? []) {
        const url = item.media?.url;
        if (!url) {
            return undefined;
        }

        items.push({
            spoiler: item.spoiler,
            url
        });
    }

    return items.length ? { type: BuilderComponentTypes.MediaGallery, items } : undefined;
}

function hydrateThumbnail(component) {
    return component?.type === ComponentType.Thumbnail && component.media?.url
        ? {
              spoiler: component.spoiler,
              url: component.media.url
          }
        : undefined;
}

function isLinkButton(component) {
    return (
        component.type === ComponentType.Button &&
        component.style === ButtonStyle.Link &&
        typeof component.label === 'string' &&
        typeof component.url === 'string' &&
        !component.custom_id
    );
}

function hasCollectionItems(collection) {
    return Array.isArray(collection) ? collection.length > 0 : collection && Object.keys(collection).length > 0;
}
