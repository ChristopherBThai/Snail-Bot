import { ButtonStyle, ComponentType, SeparatorSpacingSize } from 'discord-api-types/v10';

export const MAX_COMPONENTS = 40;
export const MAX_SELECTABLE_COMPONENTS = 24;

export function createDraft(components = [], allowMentions = false) {
    return { allowMentions, components };
}

export function createComponent(type) {
    if (type === ComponentType.TextDisplay) return { type, content: '' };
    if (type === ComponentType.Separator) {
        return { type, divider: true, spacing: SeparatorSpacingSize.Small };
    }
    if (type === ComponentType.ActionRow) return { type, components: [] };
    if (type === ComponentType.MediaGallery) return { type, items: [] };
    if (type === ComponentType.Container) return { type, components: [], spoiler: false };
    if (type === ComponentType.Section) {
        return {
            type,
            components: [{ type: ComponentType.TextDisplay, content: '' }],
            accessory: { type: ComponentType.Thumbnail, media: { url: '' }, spoiler: false },
        };
    }
}

export function getComponent(draft, path) {
    if (!path.length) return undefined;

    const component = draft.components[path[0]];
    return path.length === 1 ? component : component?.components?.[path[1]];
}

export function getChildren(component) {
    return component?.type === ComponentType.Container ? component.components : undefined;
}

export function getComponentName(component) {
    return (
        {
            [ComponentType.ActionRow]: 'Link buttons',
            [ComponentType.TextDisplay]: 'Text',
            [ComponentType.Section]: 'Section',
            [ComponentType.Thumbnail]: 'Thumbnail',
            [ComponentType.MediaGallery]: 'Gallery',
            [ComponentType.Separator]: 'Separator',
            [ComponentType.Container]: 'Container',
        }[component?.type] ?? 'Unknown'
    );
}

export function countComponents(components) {
    let count = 0;

    for (const component of components) {
        count += 1;
        if (component.components) count += countComponents(component.components);
        if (component.accessory) count += 1;
    }

    return count;
}

export function addComponent(draft, selection, component) {
    const next = structuredClone(draft);

    if (!selection.path.length) {
        next.components.push(component);
        return finish(next, [next.components.length - 1]);
    }

    const selected = getComponent(next, selection.path);
    if (selected?.type === ComponentType.Container) {
        if (component.type === ComponentType.Container) return failure('Containers cannot be nested.');
        selected.components.push(component);
        return finish(next, [selection.path[0], selected.components.length - 1]);
    }

    const parent = selection.path.length === 1 ? next.components : next.components[selection.path[0]].components;
    if (component.type === ComponentType.Container && selection.path.length > 1) {
        return failure('Containers cannot be nested.');
    }

    const index = selection.path.at(-1) + 1;
    parent.splice(index, 0, component);
    return finish(next, selection.path.length === 1 ? [index] : [selection.path[0], index]);
}

export function canAddComponent(draft, selection, component) {
    const selected = getComponent(draft, selection.path);
    const insideContainer = selection.path.length > 1 || selected?.type === ComponentType.Container;
    if (insideContainer && component.type === ComponentType.Container) return false;

    const parent = insideContainer ? draft.components[selection.path[0]].components : draft.components;
    return (
        parent.length < MAX_SELECTABLE_COMPONENTS &&
        countComponents(draft.components) + countComponents([component]) <= MAX_COMPONENTS
    );
}

export function replaceComponent(draft, selection, component) {
    if (!selection.path.length || !getComponent(draft, selection.path)) {
        return failure('Select a component first.');
    }

    const next = structuredClone(draft);
    const parent = selection.path.length === 1 ? next.components : next.components[selection.path[0]].components;
    parent[selection.path.at(-1)] = component;
    return finish(next, selection.path, selection.item);
}

export function deleteComponent(draft, selection) {
    if (!selection.path.length || !getComponent(draft, selection.path)) {
        return failure('Select a component first.');
    }

    const next = structuredClone(draft);
    const parent = selection.path.length === 1 ? next.components : next.components[selection.path[0]].components;
    const index = selection.path.at(-1);
    parent.splice(index, 1);

    if (parent.length) {
        const nextIndex = Math.min(index, parent.length - 1);
        return finish(next, selection.path.length === 1 ? [nextIndex] : [selection.path[0], nextIndex]);
    }

    return finish(next, selection.path.length === 1 ? [] : [selection.path[0]]);
}

export function moveComponent(draft, selection, offset) {
    if (!selection.path.length || !getComponent(draft, selection.path)) {
        return failure('Select a component first.');
    }

    const next = structuredClone(draft);
    const parent = selection.path.length === 1 ? next.components : next.components[selection.path[0]].components;
    const index = selection.path.at(-1);
    const destination = index + offset;

    if (destination < 0 || destination >= parent.length) return failure('That component cannot move farther.');

    [parent[index], parent[destination]] = [parent[destination], parent[index]];
    return finish(next, selection.path.length === 1 ? [destination] : [selection.path[0], destination], selection.item);
}

export function canMoveComponent(draft, selection, offset) {
    if (!selection.path.length || !getComponent(draft, selection.path)) return false;

    const parent = selection.path.length === 1 ? draft.components : draft.components[selection.path[0]].components;
    const destination = selection.path.at(-1) + offset;
    return destination >= 0 && destination < parent.length;
}

export function addItem(draft, selection, item) {
    const selected = getComponent(draft, selection.path);
    const items = getItems(selected);
    if (!items) return failure('The selected component does not contain editable items.');

    const limit = selected.type === ComponentType.ActionRow ? 5 : 10;
    if (items.length >= limit) return failure(`This component can contain at most ${limit} items.`);

    const next = structuredClone(draft);
    getItems(getComponent(next, selection.path)).push(item);
    return finish(next, selection.path, items.length);
}

export function replaceItem(draft, selection, item) {
    const items = getItems(getComponent(draft, selection.path));
    if (!items || selection.item === undefined || !items[selection.item]) return failure('Select an item first.');

    const next = structuredClone(draft);
    getItems(getComponent(next, selection.path))[selection.item] = item;
    return finish(next, selection.path, selection.item);
}

export function deleteItem(draft, selection) {
    const items = getItems(getComponent(draft, selection.path));
    if (!items || selection.item === undefined || !items[selection.item]) return failure('Select an item first.');

    const next = structuredClone(draft);
    const nextItems = getItems(getComponent(next, selection.path));
    nextItems.splice(selection.item, 1);
    return finish(next, selection.path, nextItems.length ? Math.min(selection.item, nextItems.length - 1) : undefined);
}

export function getItems(component) {
    if (component?.type === ComponentType.ActionRow) return component.components;
    if (component?.type === ComponentType.MediaGallery) return component.items;
}

export function validateDraft(draft, { allowIncomplete = false } = {}) {
    const limits = validateLimits(draft);
    if (!limits.ok) return limits;
    if (!allowIncomplete && !draft.components.length) return failure('Add at least one component before submitting.');

    for (const component of draft.components) {
        const result = validateComponent(component, allowIncomplete);
        if (!result.ok) return result;
    }

    return { ok: true };
}

function validateComponent(component, allowIncomplete) {
    if (component.type === ComponentType.Container) {
        if (!allowIncomplete && !component.components.length) return failure('Containers cannot be empty.');
        for (const child of component.components) {
            if (child.type === ComponentType.Container) return failure('Containers cannot be nested.');
            const result = validateComponent(child, allowIncomplete);
            if (!result.ok) return result;
        }
    }

    if (component.type === ComponentType.ActionRow) {
        if (!allowIncomplete && !component.components.length) return failure('Link button rows cannot be empty.');
        if (component.components.some((button) => button.style !== ButtonStyle.Link || !button.url)) {
            return failure('Link button rows may only contain complete link buttons.');
        }
    }

    if (component.type === ComponentType.MediaGallery && !allowIncomplete && !component.items.length) {
        return failure('Media galleries cannot be empty.');
    }

    return { ok: true };
}

function validateLimits(draft) {
    if (draft.components.length > MAX_SELECTABLE_COMPONENTS) {
        return failure(`Message Builder supports at most ${MAX_SELECTABLE_COMPONENTS} top-level components.`);
    }

    if (countComponents(draft.components) > MAX_COMPONENTS) {
        return failure(`A message may contain at most ${MAX_COMPONENTS} components.`);
    }

    for (const component of draft.components) {
        if (component.type === ComponentType.Container && component.components.length > MAX_SELECTABLE_COMPONENTS) {
            return failure(`Message Builder supports at most ${MAX_SELECTABLE_COMPONENTS} components in a container.`);
        }
    }

    return { ok: true };
}

function finish(draft, path, item) {
    const limits = validateLimits(draft);
    return limits.ok ? { ok: true, draft, selection: { path, item } } : limits;
}

function failure(message) {
    return { ok: false, message };
}
