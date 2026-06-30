import { ButtonStyle, ComponentType } from '../discord/components.js';
import { BlockKinds, MaxRenderedComponents, MaxSelectableBlocks } from './constants.js';
import { createDraft, getRenderedComponentCount, getSelectableBlockCount } from './model.js';

export const HydrationRejectReasons = Object.freeze({
    Attachments: 'attachments',
    Embeds: 'embeds',
    UnsupportedContent: 'unsupported_content',
    TooComplex: 'too_complex',
    UnsupportedComponent: 'unsupported_component'
});

export function createDraftFromMessage(message, { ownerID, sessionID } = {}) {
    if (message.embeds?.length) {
        return { ok: false, reason: HydrationRejectReasons.Embeds };
    }

    if (message.attachments?.length || hasResolvedCollectionItems(message.attachments)) {
        return { ok: false, reason: HydrationRejectReasons.Attachments };
    }

    if (
        message.poll ||
        message.sticker_items?.length ||
        message.stickers?.length ||
        hasResolvedCollectionItems(message.stickers)
    ) {
        return { ok: false, reason: HydrationRejectReasons.UnsupportedContent };
    }

    const blocks = [];
    const content = String(message.content ?? '').trim();
    if (content) {
        blocks.push({ kind: BlockKinds.Text, content });
    }

    for (const component of message.components ?? []) {
        const block = hydrateComponent(component);
        if (!block) {
            return { ok: false, reason: HydrationRejectReasons.UnsupportedComponent };
        }

        blocks.push(block);
    }

    const draft = createDraft({
        blocks,
        ownerID,
        selectedBlockPath: blocks.length ? [0] : undefined,
        sessionID
    });

    if (
        getSelectableBlockCount(draft) > MaxSelectableBlocks ||
        getRenderedComponentCount(draft) > MaxRenderedComponents
    ) {
        return { ok: false, reason: HydrationRejectReasons.TooComplex };
    }

    return { ok: true, draft };
}

function hydrateComponent(component, { insideContainer = false } = {}) {
    switch (component.type) {
        case ComponentType.TextDisplay:
            return hydrateTextDisplay(component);
        case ComponentType.Separator:
            return { kind: BlockKinds.Separator };
        case ComponentType.ActionRow:
            return hydrateActionRow(component);
        case ComponentType.Container:
            return insideContainer ? undefined : hydrateContainer(component);
        case ComponentType.Section:
            return hydrateSection(component);
        case ComponentType.MediaGallery:
            return hydrateMediaGallery(component);
        default:
            return undefined;
    }
}

function hydrateTextDisplay(component) {
    return typeof component.content === 'string' ? { kind: BlockKinds.Text, content: component.content } : undefined;
}

function hydrateActionRow(component) {
    const buttons = component.components ?? [];
    if (!buttons.length || buttons.some((button) => !isLinkButton(button))) {
        return undefined;
    }

    return {
        kind: BlockKinds.LinkButtons,
        buttons: buttons.map((button) => ({
            label: button.label,
            url: button.url
        }))
    };
}

function hydrateContainer(component) {
    const children = [];
    for (const child of component.components ?? []) {
        const block = hydrateComponent(child, { insideContainer: true });
        if (!block) {
            return undefined;
        }

        children.push(block);
    }

    return {
        kind: BlockKinds.Container,
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

    const thumbnailURL = hydrateThumbnailURL(component.accessory);
    if (component.accessory && !thumbnailURL) {
        return undefined;
    }

    return {
        kind: BlockKinds.Section,
        texts,
        thumbnailURL
    };
}

function hydrateMediaGallery(component) {
    const items = [];
    for (const item of component.items ?? []) {
        const url = item.media?.url;
        if (!url) {
            return undefined;
        }

        items.push({ url });
    }

    return items.length ? { kind: BlockKinds.MediaGallery, items } : undefined;
}

function hydrateThumbnailURL(component) {
    return component?.type === ComponentType.Thumbnail ? component.media?.url : undefined;
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

function hasResolvedCollectionItems(collection) {
    return collection && !Array.isArray(collection) && Object.keys(collection).length > 0;
}
