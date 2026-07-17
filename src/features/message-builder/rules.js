import { BuilderComponentTypes, MaxLinkButtonsPerRow, MaxMediaGalleryItems } from './constants.js';

export function validateRenderableDraft(draft) {
    if (!draft.components.length) {
        return { ok: false, message: 'Add at least one component before submitting.' };
    }

    if (hasEmptyContainer(draft.components)) {
        return {
            ok: false,
            message: 'Remove empty containers or add content inside them before submitting.'
        };
    }

    if (hasEmptyLinkRow(draft.components)) {
        return {
            ok: false,
            message: 'Remove empty link rows or add at least one link before submitting.'
        };
    }

    if (hasOversizedLinkRow(draft.components)) {
        return {
            ok: false,
            message: `Link rows can have at most ${MaxLinkButtonsPerRow} links.`
        };
    }

    if (hasOversizedMediaGallery(draft.components)) {
        return {
            ok: false,
            message: `Image galleries can have at most ${MaxMediaGalleryItems} images.`
        };
    }

    if (hasEmptyMediaGallery(draft.components)) {
        return {
            ok: false,
            message: 'Remove empty image galleries or add at least one image before submitting.'
        };
    }

    if (hasSectionWithoutThumbnail(draft.components)) {
        return {
            ok: false,
            message: 'Sections need a thumbnail URL before submitting.'
        };
    }

    return { ok: true };
}

function hasEmptyContainer(components) {
    return components.some(
        (component) => component.type === BuilderComponentTypes.Container && !component.children?.length
    );
}

function hasEmptyLinkRow(components) {
    return components.some(
        (component) =>
            (component.type === BuilderComponentTypes.LinkButtons && !component.buttons?.length) ||
            (component.type === BuilderComponentTypes.Container && hasEmptyLinkRow(component.children ?? []))
    );
}

function hasOversizedLinkRow(components) {
    return components.some(
        (component) =>
            (component.type === BuilderComponentTypes.LinkButtons &&
                (component.buttons?.length ?? 0) > MaxLinkButtonsPerRow) ||
            (component.type === BuilderComponentTypes.Container && hasOversizedLinkRow(component.children ?? []))
    );
}

function hasOversizedMediaGallery(components) {
    return components.some(
        (component) =>
            (component.type === BuilderComponentTypes.MediaGallery &&
                (component.items?.length ?? 0) > MaxMediaGalleryItems) ||
            (component.type === BuilderComponentTypes.Container && hasOversizedMediaGallery(component.children ?? []))
    );
}

function hasEmptyMediaGallery(components) {
    return components.some(
        (component) =>
            (component.type === BuilderComponentTypes.MediaGallery && !component.items?.length) ||
            (component.type === BuilderComponentTypes.Container && hasEmptyMediaGallery(component.children ?? []))
    );
}

function hasSectionWithoutThumbnail(components) {
    return components.some(
        (component) =>
            (component.type === BuilderComponentTypes.Section && !component.thumbnailUrl) ||
            (component.type === BuilderComponentTypes.Container && hasSectionWithoutThumbnail(component.children ?? []))
    );
}
