import {
    BuilderComponentTypes,
    MaxComponentsPerSelect,
    MaxLinkButtonsPerRow,
    MaxMediaGalleryItems,
    MaxRenderedComponents,
    OperationResults
} from './constants.js';

export function createDraft({
    allowMentions = false,
    components = [],
    ownerId,
    selectedLinkButtonIndex = 0,
    selectedComponentPath = components.length ? [0] : [],
    selectedMediaItemIndex = 0,
    sessionId
}) {
    return {
        allowMentions,
        components: structuredClone(components),
        ownerId,
        selectedLinkButtonIndex,
        selectedComponentPath,
        selectedMediaItemIndex,
        sessionId
    };
}

export function addComponent(draft, component) {
    if (!canAddComponent(draft, component.type)) {
        return OperationResults.Unavailable;
    }

    const target = getInsertionTarget(draft);
    if (!target) {
        return OperationResults.Unavailable;
    }

    const previousSelectedComponentPath = draft.selectedComponentPath;
    target.push(component);
    draft.selectedComponentPath = [...getInsertionParentPath(draft), target.length - 1];

    if (getRenderedComponentCount(draft.components) > MaxRenderedComponents || hasSelectableComponentOverflow(draft)) {
        target.pop();
        draft.selectedComponentPath = previousSelectedComponentPath;
        return OperationResults.Full;
    }

    return OperationResults.Ok;
}

export function editSelectedComponent(draft, data) {
    const component = getSelectedComponent(draft);

    if (
        !component ||
        ![
            BuilderComponentTypes.Container,
            BuilderComponentTypes.Section,
            BuilderComponentTypes.Separator,
            BuilderComponentTypes.Text
        ].includes(component.type)
    ) {
        return OperationResults.Unavailable;
    }

    Object.assign(component, data);
    return OperationResults.Ok;
}

export function selectComponent(draft, path) {
    if (!path) {
        return OperationResults.Unavailable;
    }

    if (path.length && !getComponentAtPath(draft.components, path)) {
        return OperationResults.Unavailable;
    }

    draft.selectedComponentPath = path;
    draft.selectedLinkButtonIndex = 0;
    draft.selectedMediaItemIndex = 0;
    return OperationResults.Ok;
}

export function selectLinkButton(draft, value) {
    const selected = getSelectedComponent(draft);
    const index = Number.parseInt(value, 10);

    if (
        selected?.type !== BuilderComponentTypes.LinkButtons ||
        !Number.isInteger(index) ||
        !selected.buttons?.[index]
    ) {
        return OperationResults.Unavailable;
    }

    draft.selectedLinkButtonIndex = index;
    return OperationResults.Ok;
}

export function addLinkButton(draft, button) {
    const selected = getSelectedComponent(draft);

    if (selected?.type !== BuilderComponentTypes.LinkButtons) {
        return OperationResults.Unavailable;
    }

    if ((selected.buttons?.length ?? 0) >= MaxLinkButtonsPerRow) {
        return OperationResults.Full;
    }

    selected.buttons = [...(selected.buttons ?? []), button];
    draft.selectedLinkButtonIndex = selected.buttons.length - 1;
    return OperationResults.Ok;
}

export function editSelectedLinkButton(draft, button) {
    const selected = getSelectedComponent(draft);
    const index = getSelectedLinkButtonIndex(draft);

    if (selected?.type !== BuilderComponentTypes.LinkButtons || !selected.buttons?.[index]) {
        return OperationResults.Unavailable;
    }

    selected.buttons[index] = button;
    return OperationResults.Ok;
}

export function deleteSelectedLinkButton(draft) {
    const selected = getSelectedComponent(draft);
    const index = getSelectedLinkButtonIndex(draft);

    if (selected?.type !== BuilderComponentTypes.LinkButtons || !selected.buttons?.[index]) {
        return OperationResults.Unavailable;
    }

    selected.buttons.splice(index, 1);
    draft.selectedLinkButtonIndex = Math.max(0, Math.min(index, selected.buttons.length - 1));
    return OperationResults.Ok;
}

export function selectMediaItem(draft, value) {
    const selected = getSelectedComponent(draft);
    const index = Number.parseInt(value, 10);

    if (selected?.type !== BuilderComponentTypes.MediaGallery || !Number.isInteger(index) || !selected.items?.[index]) {
        return OperationResults.Unavailable;
    }

    draft.selectedMediaItemIndex = index;
    return OperationResults.Ok;
}

export function addMediaItem(draft, item) {
    const selected = getSelectedComponent(draft);

    if (selected?.type !== BuilderComponentTypes.MediaGallery) {
        return OperationResults.Unavailable;
    }

    if ((selected.items?.length ?? 0) >= MaxMediaGalleryItems) {
        return OperationResults.Full;
    }

    selected.items = [...(selected.items ?? []), item];
    draft.selectedMediaItemIndex = selected.items.length - 1;
    return OperationResults.Ok;
}

export function editSelectedMediaItem(draft, item) {
    const selected = getSelectedComponent(draft);
    const index = getSelectedMediaItemIndex(draft);

    if (selected?.type !== BuilderComponentTypes.MediaGallery || !selected.items?.[index]) {
        return OperationResults.Unavailable;
    }

    selected.items[index] = item;
    return OperationResults.Ok;
}

export function deleteSelectedMediaItem(draft) {
    const selected = getSelectedComponent(draft);
    const index = getSelectedMediaItemIndex(draft);

    if (selected?.type !== BuilderComponentTypes.MediaGallery || !selected.items?.[index]) {
        return OperationResults.Unavailable;
    }

    selected.items.splice(index, 1);
    draft.selectedMediaItemIndex = Math.max(0, Math.min(index, selected.items.length - 1));
    return OperationResults.Ok;
}

export function toggleSelectedMediaItemSpoiler(draft) {
    const item = getSelectedMediaItem(draft);

    if (!item) {
        return OperationResults.Unavailable;
    }

    item.spoiler = !item.spoiler;
    return OperationResults.Ok;
}

export function deleteSelectedComponent(draft) {
    const path = getSelectedComponentPath(draft);

    if (!path.length) {
        return OperationResults.Unavailable;
    }

    const parent = getChildrenAtPath(draft.components, path.slice(0, -1));
    const index = path.at(-1);

    if (!parent || index === undefined || index < 0 || index >= parent.length) {
        return OperationResults.Unavailable;
    }

    parent.splice(index, 1);
    draft.selectedComponentPath = parent.length ? [...path.slice(0, -1), Math.max(0, index - 1)] : path.slice(0, -1);
    return OperationResults.Ok;
}

export function moveSelectedComponent(draft, direction) {
    const path = getSelectedComponentPath(draft);

    if (!path.length) {
        return OperationResults.Unavailable;
    }

    const parent = getChildrenAtPath(draft.components, path.slice(0, -1));
    const from = path.at(-1);
    const to = from + direction;

    if (!parent || from === undefined || from < 0 || from >= parent.length) {
        return OperationResults.Unavailable;
    }

    if (to < 0) {
        return OperationResults.Unavailable;
    }

    if (to >= parent.length) {
        return OperationResults.Unavailable;
    }

    const [component] = parent.splice(from, 1);
    parent.splice(to, 0, component);
    draft.selectedComponentPath = [...path.slice(0, -1), to];
    return OperationResults.Ok;
}

export function clearDraft(draft) {
    draft.allowMentions = false;
    draft.components = [];
    draft.selectedComponentPath = [];
    return OperationResults.Ok;
}

export function toggleMentions(draft) {
    draft.allowMentions = !draft.allowMentions;
    return OperationResults.Ok;
}

export function canAddComponent(draft, componentType) {
    const parentPath = getInsertionParentPath(draft);

    return !parentPath.length || componentType !== BuilderComponentTypes.Container;
}

export function canAddToSelectedComponentList(draft) {
    const target = getInsertionTarget(draft);

    return Boolean(target) && target.length < MaxComponentsPerSelect;
}

export function getSelectedComponent(draft) {
    const path = getSelectedComponentPath(draft);

    return path.length ? getComponentAtPath(draft.components, path) : undefined;
}

export function getSelectedMediaItem(draft) {
    const selected = getSelectedComponent(draft);

    return selected?.type === BuilderComponentTypes.MediaGallery
        ? selected.items?.[getSelectedMediaItemIndex(draft)]
        : undefined;
}

export function getSelectedLinkButton(draft) {
    const selected = getSelectedComponent(draft);

    return selected?.type === BuilderComponentTypes.LinkButtons
        ? selected.buttons?.[getSelectedLinkButtonIndex(draft)]
        : undefined;
}

export function getSelectedLinkButtonIndex(draft) {
    const selected = getSelectedComponent(draft);
    const index = draft.selectedLinkButtonIndex ?? 0;

    return selected?.buttons?.[index] ? index : 0;
}

export function getSelectedMediaItemIndex(draft) {
    const selected = getSelectedComponent(draft);
    const index = draft.selectedMediaItemIndex ?? 0;

    return selected?.items?.[index] ? index : 0;
}

export function getSelectedComponentPath(draft) {
    const path = draft.selectedComponentPath ?? [];

    if (!path.length || getComponentAtPath(draft.components, path)) {
        return path;
    }

    return [];
}

export function getComponentItems(draft) {
    const items = [];

    collectComponentItems(draft.components, [], items);

    return items;
}

export function parseComponentPath(value) {
    if (value === 'root') {
        return [];
    }

    if (typeof value !== 'string' || !/^\d+(?:\.\d+)*$/.test(value)) {
        return undefined;
    }

    return value.split('.').map(Number);
}

export function formatComponentPath(path) {
    return path.length ? path.join('.') : 'root';
}

export function getRenderedComponentCount(components) {
    return components.reduce((count, component) => count + getRenderedDraftComponentCount(component), 0);
}

export function hasSelectableComponentOverflow(draft) {
    return hasComponentListOverflow(draft.components);
}

export function getComponentLabel(component) {
    if (component.type === BuilderComponentTypes.Text) {
        return `Text: ${
            String(component.content ?? '')
                .replace(/\s+/g, ' ')
                .slice(0, 60) || 'empty'
        }`;
    }

    if (component.type === BuilderComponentTypes.LinkButtons) {
        return `Link row (${component.buttons?.length ?? 0})`;
    }

    if (component.type === BuilderComponentTypes.MediaGallery) {
        return `Image gallery (${component.items?.length ?? 0})`;
    }

    if (component.type === BuilderComponentTypes.Section) {
        return 'Section';
    }

    if (component.type === BuilderComponentTypes.Container) {
        return 'Container';
    }

    return 'Separator';
}

function getInsertionTarget(draft) {
    return getChildrenAtPath(draft.components, getInsertionParentPath(draft));
}

function getInsertionParentPath(draft) {
    const selected = getSelectedComponent(draft);
    const selectedPath = getSelectedComponentPath(draft);

    return selected?.type === BuilderComponentTypes.Container ? selectedPath : selectedPath.slice(0, -1);
}

function getComponentAtPath(components, path) {
    let component;
    let children = components;

    for (const index of path) {
        component = children[index];
        if (!component) {
            return undefined;
        }
        children = component.children ?? [];
    }

    return component;
}

function getChildrenAtPath(components, path) {
    return path.length ? getComponentAtPath(components, path)?.children : components;
}

function collectComponentItems(components, parentPath, items) {
    components.forEach((component, index) => {
        const path = [...parentPath, index];
        items.push({ component, path });

        if (component.children?.length) {
            collectComponentItems(component.children, path, items);
        }
    });
}

function hasComponentListOverflow(components) {
    return (
        components.length > MaxComponentsPerSelect ||
        components.some(
            (component) =>
                component.type === BuilderComponentTypes.Container && hasComponentListOverflow(component.children ?? [])
        )
    );
}

function getRenderedDraftComponentCount(component) {
    if (component.type === BuilderComponentTypes.Container) {
        return 1 + getRenderedComponentCount(component.children ?? []);
    }

    if (component.type === BuilderComponentTypes.Section) {
        const textCount = Math.max(1, component.texts?.length ?? 0);

        return 1 + textCount + 1;
    }

    return 1;
}
