import {
    BlockKinds,
    MaxLinkButtonsPerRow,
    MaxMediaGalleryItems,
    MaxRenderedComponents,
    MaxSelectableBlocks,
    OperationResults
} from './constants.js';

export function createDraft({
    blocks = [],
    ownerID,
    selectedBlockPath = blocks.length ? [0] : undefined,
    sessionID = crypto.randomUUID(),
    source,
    target
}) {
    return {
        blocks,
        ownerID,
        selectedBlockPath,
        sessionID,
        source,
        target,
        updatedAt: Date.now()
    };
}

export function serializeDraft(draft) {
    return {
        blocks: draft.blocks,
        selectedBlockPath: draft.selectedBlockPath,
        source: draft.source,
        updatedBySessionID: draft.sessionID
    };
}

export function restoreDraft(ownerID, doc, options = {}) {
    return createDraft({
        blocks: doc?.blocks ?? [],
        ownerID,
        selectedBlockPath: doc?.selectedBlockPath,
        sessionID: options.sessionID,
        source: doc?.source,
        target: options.target
    });
}

export function addBlock(draft, block) {
    if (!canAddBlock(draft, block.kind)) {
        return OperationResults.InvalidTarget;
    }

    const target = getInsertionTarget(draft);
    if (!target) {
        return OperationResults.InvalidTarget;
    }

    target.push(block);
    draft.selectedBlockPath = [...getInsertionParentPath(draft), target.length - 1];
    touchDraft(draft);

    if (getRenderedComponentCount(draft) > MaxRenderedComponents) {
        target.pop();
        draft.selectedBlockPath = undefined;
        return OperationResults.Full;
    }

    if (getSelectableBlockCount(draft) > MaxSelectableBlocks) {
        target.pop();
        draft.selectedBlockPath = undefined;
        return OperationResults.Full;
    }

    return OperationResults.Ok;
}

export function canAddBlock(draft, blockKind) {
    const path = getSelectedBlockPath(draft);
    if (!path?.length) {
        return true;
    }

    const selected = getSelectedBlock(draft);

    return selected?.kind === BlockKinds.Container && blockKind !== BlockKinds.Container;
}

export function selectBlock(draft, path) {
    if (!path) {
        return OperationResults.StaleSelection;
    }

    if (path.length && !getBlockAtPath(draft, path)) {
        return OperationResults.StaleSelection;
    }

    draft.selectedBlockPath = path;
    touchDraft(draft);
    return OperationResults.Ok;
}

export function editSelectedText(draft, content) {
    const block = getSelectedBlock(draft);
    if (block?.kind !== BlockKinds.Text) {
        return OperationResults.NotEditable;
    }

    block.content = content;
    touchDraft(draft);
    return OperationResults.Ok;
}

export function editSelectedSection(draft, data) {
    const block = getSelectedBlock(draft);
    if (block?.kind !== BlockKinds.Section) {
        return OperationResults.NotEditable;
    }

    Object.assign(block, data);
    touchDraft(draft);
    return OperationResults.Ok;
}

export function addLinkToSelectedRow(draft, button) {
    const block = getSelectedBlock(draft);
    if (block?.kind !== BlockKinds.LinkButtons) {
        return OperationResults.InvalidTarget;
    }

    block.buttons ??= [];
    if (block.buttons.length >= MaxLinkButtonsPerRow) {
        return OperationResults.Full;
    }

    block.buttons.push(button);
    touchDraft(draft);
    return OperationResults.Ok;
}

export function removeLinkFromSelectedRow(draft, index) {
    const block = getSelectedBlock(draft);
    if (block?.kind !== BlockKinds.LinkButtons) {
        return OperationResults.InvalidTarget;
    }

    if (!block.buttons?.length || index < 0 || index >= block.buttons.length) {
        return OperationResults.StaleSelection;
    }

    if (block.buttons.length === 1) {
        return deleteSelectedBlock(draft);
    }

    block.buttons.splice(index, 1);
    touchDraft(draft);
    return OperationResults.Ok;
}

export function addItemToSelectedMediaGallery(draft, item) {
    const block = getSelectedBlock(draft);
    if (block?.kind !== BlockKinds.MediaGallery) {
        return OperationResults.InvalidTarget;
    }

    block.items ??= [];
    if (block.items.length >= MaxMediaGalleryItems) {
        return OperationResults.Full;
    }

    block.items.push(item);
    touchDraft(draft);
    return OperationResults.Ok;
}

export function removeItemFromSelectedMediaGallery(draft, index) {
    const block = getSelectedBlock(draft);
    if (block?.kind !== BlockKinds.MediaGallery) {
        return OperationResults.InvalidTarget;
    }

    if (!block.items?.length || index < 0 || index >= block.items.length) {
        return OperationResults.StaleSelection;
    }

    block.items.splice(index, 1);
    touchDraft(draft);
    return OperationResults.Ok;
}

export function deleteSelectedBlock(draft) {
    const path = getSelectedBlockPath(draft);
    if (!path?.length) {
        return OperationResults.NoSelection;
    }

    const parent = getChildrenAtPath(draft, path.slice(0, -1));
    const index = path.at(-1);
    if (!parent || index === undefined || index < 0 || index >= parent.length) {
        return OperationResults.StaleSelection;
    }

    parent.splice(index, 1);
    draft.selectedBlockPath = parent.length ? [...path.slice(0, -1), Math.max(0, index - 1)] : path.slice(0, -1);
    touchDraft(draft);
    return OperationResults.Ok;
}

export function moveSelectedBlock(draft, direction) {
    const path = getSelectedBlockPath(draft);
    if (!path?.length) {
        return OperationResults.NoSelection;
    }

    const parent = getChildrenAtPath(draft, path.slice(0, -1));
    const from = path.at(-1);
    const to = from + direction;
    if (!parent || from === undefined || from < 0 || from >= parent.length) {
        return OperationResults.StaleSelection;
    }

    if (to < 0) {
        return OperationResults.AlreadyFirst;
    }

    if (to >= parent.length) {
        return OperationResults.AlreadyLast;
    }

    const [block] = parent.splice(from, 1);
    parent.splice(to, 0, block);
    draft.selectedBlockPath = [...path.slice(0, -1), to];
    touchDraft(draft);
    return OperationResults.Ok;
}

export function canMoveSelectedBlock(draft, direction) {
    const path = getSelectedBlockPath(draft);
    if (!path?.length) {
        return false;
    }

    const parent = getChildrenAtPath(draft, path.slice(0, -1));
    const from = path.at(-1);
    const to = from + direction;

    return Boolean(parent && from !== undefined && from >= 0 && from < parent.length && to >= 0 && to < parent.length);
}

export function clearDraft(draft) {
    if (!draft.blocks.length) {
        return OperationResults.Empty;
    }

    draft.blocks = [];
    draft.selectedBlockPath = undefined;
    touchDraft(draft);
    return OperationResults.Ok;
}

export function getSelectedBlock(draft) {
    const path = getSelectedBlockPath(draft);

    return path ? getBlockAtPath(draft, path) : undefined;
}

export function getSelectedBlockPath(draft) {
    if (!draft.selectedBlockPath) {
        return undefined;
    }

    if (!draft.selectedBlockPath.length || getBlockAtPath(draft, draft.selectedBlockPath)) {
        return draft.selectedBlockPath;
    }

    return undefined;
}

export function getBlockAtPath(draft, path) {
    let block;
    let children = draft.blocks;

    for (const index of path) {
        block = children[index];
        if (!block) {
            return undefined;
        }

        children = block.children ?? [];
    }

    return block;
}

export function getBlockItems(draft) {
    const items = [];

    collectBlockItems(draft.blocks, [], items);

    return items;
}

export function parseBlockPath(value) {
    if (value === 'root') {
        return [];
    }

    if (typeof value !== 'string' || !/^\d+(?:\.\d+)*$/.test(value)) {
        return undefined;
    }

    return value.split('.').map(Number);
}

export function formatBlockPath(path) {
    return path.length ? path.join('.') : 'root';
}

export function getRenderedComponentCount(draft) {
    return countRenderedBlocks(draft.blocks);
}

export function getSelectableBlockCount(draft) {
    return getBlockItems(draft).length;
}

export function getBlockLabel(block) {
    switch (block.kind) {
        case BlockKinds.Text:
            return `Text: ${
                String(block.content ?? '')
                    .replace(/\s+/g, ' ')
                    .slice(0, 60) || 'empty'
            }`;
        case BlockKinds.Separator:
            return 'Separator';
        case BlockKinds.LinkButtons:
            return `Link Row (${block.buttons?.length ?? 0})`;
        case BlockKinds.Container:
            return 'Container';
        case BlockKinds.Section:
            return 'Section';
        case BlockKinds.MediaGallery:
            return `Image Gallery (${block.items?.length ?? 0})`;
        default:
            return 'Block';
    }
}

function getInsertionTarget(draft) {
    const path = getSelectedBlockPath(draft);
    if (!path?.length) {
        return draft.blocks;
    }

    const selected = getSelectedBlock(draft);

    return selected?.kind === BlockKinds.Container ? selected.children : undefined;
}

function getInsertionParentPath(draft) {
    const path = getSelectedBlockPath(draft);
    if (!path?.length) {
        return [];
    }

    const selected = getSelectedBlock(draft);

    return selected?.kind === BlockKinds.Container ? getSelectedBlockPath(draft) : [];
}

function getChildrenAtPath(draft, path) {
    if (!path.length) {
        return draft.blocks;
    }

    return getBlockAtPath(draft, path)?.children;
}

function touchDraft(draft) {
    draft.updatedAt = Date.now();
}

function collectBlockItems(blocks, parentPath, items) {
    blocks.forEach((block, index) => {
        const path = [...parentPath, index];
        items.push({ block, path });

        if (block.children?.length) {
            collectBlockItems(block.children, path, items);
        }
    });
}

function countRenderedBlocks(blocks) {
    return blocks.reduce((count, block) => count + countRenderedBlock(block), 0);
}

function countRenderedBlock(block) {
    if (block.kind === BlockKinds.Container) {
        return 1 + countRenderedBlocks(block.children ?? []);
    }

    return 1;
}
