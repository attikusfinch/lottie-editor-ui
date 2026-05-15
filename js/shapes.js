/* Shape content helpers: select and move inner shape items */

import { state } from './state.js';

const MOVABLE_TYPES = new Set(['gr', 'sh', 'el', 'rc', 'sr']);

export const SHAPE_TYPE_LABELS = {
    gr: 'Group',
    sh: 'Path',
    el: 'Ellipse',
    rc: 'Rectangle',
    sr: 'Star',
};

export function getShapePathKey(path) {
    return Array.isArray(path) ? path.join('.') : '';
}

export function parseShapePathKey(key) {
    if (!key) return null;
    const path = String(key).split('.').map(v => parseInt(v, 10));
    return path.every(Number.isInteger) ? path : null;
}

export function getLayerShapeKey(layer) {
    if (!layer) return null;
    if (Number.isFinite(layer.ind)) return `ind:${layer.ind}`;
    return `name:${layer.nm || ''}`;
}

export function setSelectedShapePath(layer, path) {
    state.selectedShapeLayerKey = getLayerShapeKey(layer);
    state.selectedShapePath = Array.isArray(path) ? path.slice() : null;
}

export function clearSelectedShapePath() {
    state.selectedShapeLayerKey = null;
    state.selectedShapePath = null;
    state.dragShapeEntry = null;
}

export function getSelectedShapePathForLayer(layer) {
    if (!layer || !state.selectedShapePath) return null;
    if (state.selectedShapeLayerKey !== getLayerShapeKey(layer)) return null;
    return state.selectedShapePath.slice();
}

export function layerMatchesShapeSelection(layer) {
    return Boolean(getSelectedShapePathForLayer(layer));
}

export function collectEditableShapeItems(layer) {
    const items = [];
    walkShapeItems(layer && layer.shapes, [], 0, items);
    return items;
}

function walkShapeItems(shapeItems, path, depth, result) {
    if (!Array.isArray(shapeItems)) return;

    shapeItems.forEach((item, index) => {
        if (!item || typeof item !== 'object') return;
        const itemPath = [...path, index];
        if (MOVABLE_TYPES.has(item.ty)) {
            result.push({
                item,
                path: itemPath,
                pathKey: getShapePathKey(itemPath),
                depth,
                label: getShapeItemLabel(item),
                typeLabel: SHAPE_TYPE_LABELS[item.ty] || item.ty,
            });
        }

        if (item.ty === 'gr' && Array.isArray(item.it)) {
            walkShapeItems(item.it, itemPath, depth + 1, result);
        }
    });
}

export function getShapeItemLabel(item) {
    if (!item) return 'Shape';
    return item.nm || SHAPE_TYPE_LABELS[item.ty] || item.ty || 'Shape';
}

export function getShapeItemByPath(layer, path) {
    if (!layer || !Array.isArray(path)) return null;

    let items = layer.shapes;
    let item = null;
    for (const index of path) {
        if (!Array.isArray(items) || !Number.isInteger(index) || !items[index]) return null;
        item = items[index];
        items = item.it;
    }
    return item;
}

export function moveShapePath(layer, path, dx, dy) {
    const item = getShapeItemByPath(layer, path);
    if (!item) return false;
    return offsetShapeItem(item, dx, dy);
}

function offsetShapeItem(item, dx, dy) {
    if (!item || !Number.isFinite(dx) || !Number.isFinite(dy)) return false;

    switch (item.ty) {
        case 'sh':
            return offsetPathProperty(item.ks, dx, dy);
        case 'el':
        case 'rc':
        case 'sr':
            return offsetPositionProperty(item.p, dx, dy);
        case 'gr':
            return offsetGroup(item, dx, dy);
        default:
            return false;
    }
}

function offsetGroup(group, dx, dy) {
    const transform = Array.isArray(group.it) ? group.it.find(item => item && item.ty === 'tr') : null;
    if (transform && offsetPositionProperty(transform.p, dx, dy)) return true;

    let moved = false;
    for (const child of group.it || []) {
        if (child && child.ty !== 'tr' && offsetShapeItem(child, dx, dy)) moved = true;
    }
    return moved;
}

function offsetPathProperty(prop, dx, dy) {
    if (!prop) return false;

    if (prop.a === 1 && Array.isArray(prop.k)) {
        let moved = false;
        for (const keyframe of prop.k) {
            if (offsetShapeKeyValue(keyframe && keyframe.s, dx, dy)) moved = true;
            if (offsetShapeKeyValue(keyframe && keyframe.e, dx, dy)) moved = true;
        }
        return moved;
    }

    return offsetShapeKeyValue(prop.k, dx, dy);
}

function offsetShapeKeyValue(value, dx, dy) {
    if (!value) return false;

    if (Array.isArray(value)) {
        let moved = false;
        for (const entry of value) {
            if (offsetShapeKeyValue(entry, dx, dy)) moved = true;
        }
        return moved;
    }

    if (!Array.isArray(value.v)) return false;
    for (const vertex of value.v) {
        if (!Array.isArray(vertex)) continue;
        vertex[0] = (parseFloat(vertex[0]) || 0) + dx;
        vertex[1] = (parseFloat(vertex[1]) || 0) + dy;
    }
    return true;
}

function offsetPositionProperty(prop, dx, dy) {
    if (!prop) return false;

    if (prop.s && prop.x && prop.y) {
        const movedX = offsetScalarProperty(prop.x, dx);
        const movedY = offsetScalarProperty(prop.y, dy);
        return movedX || movedY;
    }

    if (prop.a === 1 && Array.isArray(prop.k)) {
        let moved = false;
        for (const keyframe of prop.k) {
            if (offsetPositionValue(keyframe && keyframe.s, dx, dy)) moved = true;
            if (offsetPositionValue(keyframe && keyframe.e, dx, dy)) moved = true;
        }
        return moved;
    }

    return offsetPositionValue(prop.k, dx, dy);
}

function offsetPositionValue(value, dx, dy) {
    if (!Array.isArray(value)) return false;
    value[0] = (parseFloat(value[0]) || 0) + dx;
    value[1] = (parseFloat(value[1]) || 0) + dy;
    return true;
}

function offsetScalarProperty(prop, delta) {
    if (!prop) return false;

    if (prop.a === 1 && Array.isArray(prop.k)) {
        let moved = false;
        for (const keyframe of prop.k) {
            if (Array.isArray(keyframe && keyframe.s)) { keyframe.s[0] = (parseFloat(keyframe.s[0]) || 0) + delta; moved = true; }
            if (Array.isArray(keyframe && keyframe.e)) { keyframe.e[0] = (parseFloat(keyframe.e[0]) || 0) + delta; moved = true; }
        }
        return moved;
    }

    if (Array.isArray(prop.k)) {
        prop.k[0] = (parseFloat(prop.k[0]) || 0) + delta;
        return true;
    }
    if (Number.isFinite(prop.k)) {
        prop.k += delta;
        return true;
    }
    return false;
}
