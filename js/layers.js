import { state, dom, TYPE_NAMES, TYPE_ICONS } from './state.js';
import {
    saveSnapshot,
    getStaticOrFirstKeyframe,
    setStaticOrFirstKeyframe,
    getStaticOrFirstKeyframeScalar,
    setStaticOrFirstKeyframeScalar,
    toast,
} from './utils.js';
import { renderPreview, renderPreviewSilent } from './preview.js';
import { clearSelectedShapePath, getSelectedShapePathForLayer, layerMatchesShapeSelection, moveShapePath } from './shapes.js';

let renderInspectorFn = null;
let renderActiveTabFn = null;
let buildTimelineFn = null;
const SHAPE_LAYER_TYPE = 4;
const PASTE_OFFSET = 24;

export function setInspectorCallbacks(ri, rat) {
    renderInspectorFn = ri;
    renderActiveTabFn = rat;
}

export function setTimelineCallback(fn) {
    buildTimelineFn = fn;
}

export function updateLayerClipboardControls() {
    if (dom.btnCopyShape) {
        dom.btnCopyShape.disabled = !state.lottieData || getSelectedShapeEntries().length === 0;
    }
    if (dom.btnPasteShape) {
        dom.btnPasteShape.disabled = !state.lottieData || !state.shapeClipboard || !state.shapeClipboard.layers.length;
    }
}

export function copySelectedShapeLayers() {
    if (!state.lottieData) {
        toast('Load a Lottie file first', 'info');
        return false;
    }

    const entries = getSelectedShapeEntries();
    if (entries.length === 0) {
        toast('Select a shape layer to copy', 'info');
        return false;
    }

    state.shapeClipboard = {
        layers: entries.map(({ entry }) => JSON.parse(JSON.stringify(entry.layer))),
        copiedAt: Date.now(),
    };
    state.shapePasteCount = 0;
    updateLayerClipboardControls();

    const count = entries.length;
    toast(`Copied ${count} shape layer${count !== 1 ? 's' : ''}`, 'success');
    return true;
}

export function pasteCopiedShapeLayers() {
    if (!state.lottieData) {
        toast('Load a Lottie file first', 'info');
        return false;
    }
    if (!state.shapeClipboard || !state.shapeClipboard.layers || state.shapeClipboard.layers.length === 0) {
        toast('Copy a shape layer first', 'info');
        return false;
    }

    saveSnapshot();

    let nextInd = getMaxLayerInd() + 1;
    const indMap = new Map();
    for (const layer of state.shapeClipboard.layers) {
        if (Number.isFinite(layer.ind)) {
            indMap.set(layer.ind, nextInd++);
        }
    }

    const targetParent = getPasteTargetParent();
    const offset = PASTE_OFFSET * (state.shapePasteCount + 1);
    const pastedLayers = state.shapeClipboard.layers.map(source => {
        const layer = JSON.parse(JSON.stringify(source));
        const sourceInd = Number.isFinite(layer.ind) ? layer.ind : null;
        layer.ind = sourceInd !== null ? indMap.get(sourceInd) : nextInd++;
        layer.nm = makeCopyName(layer.nm || `Shape ${layer.ind}`);

        if (layer.parent !== undefined) {
            if (indMap.has(layer.parent)) {
                layer.parent = indMap.get(layer.parent);
            } else if (targetParent !== undefined) {
                layer.parent = targetParent;
            } else if (!hasTopLevelLayerInd(layer.parent)) {
                delete layer.parent;
            }
        } else if (targetParent !== undefined) {
            layer.parent = targetParent;
        }

        offsetLayerPosition(layer, offset, offset);
        return layer;
    });

    const insertIndex = getPasteInsertIndex();
    state.lottieData.layers.splice(insertIndex, 0, ...pastedLayers);
    state.shapePasteCount += 1;

    renderPreview({ autoplay: false, preserveFrame: true });
    buildLayersList();
    selectLayerRefs(pastedLayers);
    if (renderInspectorFn) renderInspectorFn();
    updateSelectionBox();
    updateLayerClipboardControls();

    const count = pastedLayers.length;
    toast(`Pasted ${count} shape layer${count !== 1 ? 's' : ''}`, 'success');
    return true;
}

function getSelectedShapeEntries() {
    return [...state.selectedLayerIndices]
        .sort((a, b) => a - b)
        .map(idx => ({ idx, entry: state.flatLayers[idx] }))
        .filter(({ entry }) => entry && entry.layer && entry.layer.ty === SHAPE_LAYER_TYPE);
}

function getMaxLayerInd() {
    let maxInd = 0;
    function scan(layers) {
        if (!Array.isArray(layers)) return;
        for (const layer of layers) {
            if (Number.isFinite(layer.ind)) maxInd = Math.max(maxInd, layer.ind);
        }
    }
    scan(state.lottieData.layers);
    for (const asset of state.lottieData.assets || []) scan(asset.layers);
    return maxInd;
}

function hasTopLevelLayerInd(ind) {
    return Number.isFinite(ind) && state.lottieData.layers.some(layer => layer.ind === ind);
}

function getPasteTargetParent() {
    const selected = [...state.selectedLayerIndices].sort((a, b) => a - b);
    if (selected.length === 0) return undefined;

    const entry = state.flatLayers[selected[0]];
    if (!entry || !entry.layer || entry.path[0] === 'asset') return undefined;

    if (entry.layer.ty === 3 && Number.isFinite(entry.layer.ind)) return entry.layer.ind;
    if (hasTopLevelLayerInd(entry.layer.parent)) return entry.layer.parent;
    return undefined;
}

function getPasteInsertIndex() {
    let insertAfter = -1;
    for (const idx of state.selectedLayerIndices) {
        const entry = state.flatLayers[idx];
        if (entry && entry.path[0] !== 'asset' && Number.isInteger(entry.path[0])) {
            insertAfter = Math.max(insertAfter, entry.path[0]);
        }
    }
    return insertAfter >= 0 ? insertAfter + 1 : 0;
}

function makeCopyName(name) {
    const base = String(name || 'Shape').replace(/\s+copy(?:\s+\d+)?$/i, '');
    return `${base} copy`;
}

function offsetLayerPosition(layer, dx, dy) {
    const prop = layer && layer.ks && layer.ks.p;
    if (!prop) return;

    if (prop.a === 1 && Array.isArray(prop.k)) {
        for (const kf of prop.k) {
            if (kf && Array.isArray(kf.s)) {
                kf.s[0] = (parseFloat(kf.s[0]) || 0) + dx;
                kf.s[1] = (parseFloat(kf.s[1]) || 0) + dy;
            }
            if (kf && Array.isArray(kf.e)) {
                kf.e[0] = (parseFloat(kf.e[0]) || 0) + dx;
                kf.e[1] = (parseFloat(kf.e[1]) || 0) + dy;
            }
        }
        return;
    }

    if (Array.isArray(prop.k)) {
        prop.k[0] = (parseFloat(prop.k[0]) || 0) + dx;
        prop.k[1] = (parseFloat(prop.k[1]) || 0) + dy;
    }
}

function selectLayerRefs(layers) {
    const refs = new Set(layers);
    state.selectedLayerIndices.clear();
    state.flatLayers.forEach((entry, idx) => {
        if (refs.has(entry.layer)) state.selectedLayerIndices.add(idx);
    });

    state.currentTab = 'inspector';
    document.querySelectorAll('.inspector-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'inspector'));
    dom.layersList.querySelectorAll('.layer-item').forEach((el, i) => {
        el.classList.toggle('selected', state.selectedLayerIndices.has(i));
    });
    dom.lottiePlayer.style.cursor = state.selectedLayerIndices.size > 0 ? 'grab' : '';
}

// ─── Extend All Layers to Full Animation Range ───
export function extendAllLayers() {
    if (!state.lottieData) return;
    saveSnapshot();

    const ip = state.lottieData.ip ?? 0;
    const op = state.lottieData.op ?? 60;
    let count = 0;

    function extendLayers(layers) {
        for (const layer of layers) {
            if (layer.ip !== undefined && layer.ip > ip) { layer.ip = ip; count++; }
            else if (layer.ip === undefined) { layer.ip = ip; count++; }
            if (layer.op !== undefined && layer.op < op) { layer.op = op; count++; }
            else if (layer.op === undefined) { layer.op = op; count++; }
        }
    }

    extendLayers(state.lottieData.layers);

    // Also extend layers inside assets (precomps)
    if (state.lottieData.assets) {
        for (const asset of state.lottieData.assets) {
            if (asset.layers) extendLayers(asset.layers);
        }
    }

    renderPreview();
    buildLayersList();
    if (renderInspectorFn) renderInspectorFn();
    toast(`Extended all layers to ${ip}–${op}`, 'success');
}

// ─── Flat Layer Builder (tree-aware with parent/ind) ───
export function buildFlatLayers() {
    state.flatLayers = [];
    if (!state.lottieData || !state.lottieData.layers) return;

    const layers = state.lottieData.layers;

    // Build ind → layer map and children map
    const byInd = new Map();
    for (const l of layers) {
        if (l.ind !== undefined) byInd.set(l.ind, l);
    }

    // Find roots (no parent, or parent not found)
    const roots = [];
    const childrenOf = new Map(); // parentInd → [layer, ...]
    for (const l of layers) {
        if (l.parent !== undefined && byInd.has(l.parent)) {
            if (!childrenOf.has(l.parent)) childrenOf.set(l.parent, []);
            childrenOf.get(l.parent).push(l);
        } else {
            roots.push(l);
        }
    }

    function walk(layer, depth) {
        const idx = state.flatLayers.length;
        const hasChildren = (childrenOf.has(layer.ind)) ||
            (layer.ty === 0 && layer.refId && state.lottieData.assets);
        const layerKey = layer.ind !== undefined ? layer.ind : 'L' + layers.indexOf(layer);
        state.flatLayers.push({ layer, path: [layers.indexOf(layer)], depth, hasChildren, layerKey });

        // Skip children if collapsed (use layer.ind as stable key)
        if (state.collapsedLayers.has(layerKey)) return;

        // Child layers (via parent property)
        if (layer.ind !== undefined && childrenOf.has(layer.ind)) {
            for (const child of childrenOf.get(layer.ind)) {
                walk(child, depth + 1);
            }
        }

        // Precomp children (in assets)
        if (layer.ty === 0 && layer.refId && state.lottieData.assets) {
            const asset = state.lottieData.assets.find(a => a.id === layer.refId);
            if (asset && asset.layers) {
                for (const child of asset.layers) {
                    const ci = state.flatLayers.length;
                    state.flatLayers.push({ layer: child, path: ['asset', layer.refId, asset.layers.indexOf(child)], depth: depth + 1, hasChildren: false });
                }
            }
        }
    }

    for (const root of roots) {
        walk(root, 0);
    }
}

// ─── Layer List ───
export function buildLayersList() {
    buildFlatLayers();
    dom.layerCount.textContent = state.flatLayers.length;
    dom.layersList.innerHTML = '';

    if (state.flatLayers.length === 0) {
        dom.layersList.innerHTML = `<div class="empty-state"><p>No layers found</p></div>`;
        updateLayerClipboardControls();
        return;
    }

    state.flatLayers.forEach((entry, idx) => {
        const { layer, depth, hasChildren } = entry;
        const item = document.createElement('div');
        item.className = 'layer-item' + (state.selectedLayerIndices.has(idx) ? ' selected' : '');
        item.style.paddingLeft = (10 + depth * 16) + 'px';
        item.dataset.index = idx;

        // Collapse/expand chevron
        if (hasChildren) {
            const key = entry.layerKey;
            const chevron = document.createElement('button');
            chevron.className = 'layer-chevron' + (state.collapsedLayers.has(key) ? ' collapsed' : '');
            chevron.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
            chevron.addEventListener('click', (e) => {
                e.stopPropagation();
                if (state.collapsedLayers.has(key)) {
                    state.collapsedLayers.delete(key);
                } else {
                    state.collapsedLayers.add(key);
                }
                buildLayersList();
            });
            item.appendChild(chevron);
        } else {
            const spacer = document.createElement('div');
            spacer.className = 'layer-chevron-spacer';
            item.appendChild(spacer);
        }

        // Thumbnail container (populated async after render)
        const thumb = document.createElement('div');
        thumb.className = 'layer-thumb';
        thumb.dataset.flatIdx = idx;
        thumb.textContent = TYPE_ICONS[layer.ty] || '?';

        const name = document.createElement('span');
        name.className = 'layer-name';
        name.textContent = layer.nm || `Layer ${layer.ind ?? idx}`;

        const tag = document.createElement('span');
        tag.className = 'layer-type-tag';
        tag.textContent = TYPE_NAMES[layer.ty] || `ty:${layer.ty}`;

        // Timing badge (shows frame range, warns if shorter than animation)
        const timingBadge = document.createElement('span');
        const lIp = layer.ip ?? 0;
        const lOp = layer.op ?? 60;
        const gIp = state.lottieData.ip ?? 0;
        const gOp = state.lottieData.op ?? 60;
        const isShorter = (lIp > gIp || lOp < gOp);
        timingBadge.className = 'layer-timing-badge' + (isShorter ? ' short' : '');
        timingBadge.textContent = `${lIp}–${lOp}`;
        timingBadge.title = isShorter
            ? `Layer range ${lIp}–${lOp} is shorter than animation ${gIp}–${gOp}`
            : `Frames ${lIp}–${lOp}`;

        // Move up/down buttons
        const moveWrap = document.createElement('div');
        moveWrap.className = 'layer-move-btns';

        const upBtn = document.createElement('button');
        upBtn.className = 'layer-move-btn';
        upBtn.title = 'Move up';
        upBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 7l3-4 3 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(idx, -1); });

        const downBtn = document.createElement('button');
        downBtn.className = 'layer-move-btn';
        downBtn.title = 'Move down';
        downBtn.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 3l3 4 3-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveLayer(idx, 1); });

        moveWrap.appendChild(upBtn);
        moveWrap.appendChild(downBtn);

        const delBtn = document.createElement('button');
        delBtn.className = 'layer-delete-btn';
        delBtn.title = 'Delete layer';
        delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3.5l8 8M11 3.5l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteLayer(idx);
        });

        item.appendChild(thumb);
        item.appendChild(name);
        item.appendChild(tag);
        item.appendChild(timingBadge);
        item.appendChild(moveWrap);
        item.appendChild(delBtn);

        item.addEventListener('click', (e) => selectLayer(idx, e));
        dom.layersList.appendChild(item);
    });

    // Generate thumbnails after a short delay (animation must be rendered)
    requestAnimationFrame(() => requestAnimationFrame(() => renderLayerThumbnails()));

    if (buildTimelineFn) buildTimelineFn();
    updateLayerClipboardControls();
}

// ─── Layer Thumbnails (rasterized to avoid ID conflicts) ───
function renderLayerThumbnails() {
    if (!state.anim || !state.anim.renderer || !state.anim.renderer.elements) return;

    const mainSvg = dom.lottiePlayer.querySelector('svg');
    if (!mainSvg) return;

    const thumbEls = dom.layersList.querySelectorAll('.layer-thumb');
    thumbEls.forEach(thumbEl => {
        const idx = parseInt(thumbEl.dataset.flatIdx);
        const entry = state.flatLayers[idx];
        if (!entry) return;

        const svgGroup = findRenderedLayerElement(entry);
        if (!svgGroup) return;

        try {
            const bbox = svgGroup.getBBox();
            if (bbox.width < 1 && bbox.height < 1) return;

            // Build a standalone SVG string (no shared IDs in the DOM)
            const ns = 'http://www.w3.org/2000/svg';
            const tmpSvg = document.createElementNS(ns, 'svg');
            tmpSvg.setAttribute('xmlns', ns);
            tmpSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
            const pad = Math.max(bbox.width, bbox.height) * 0.05;
            tmpSvg.setAttribute('viewBox',
                `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
            tmpSvg.setAttribute('width', '56');
            tmpSvg.setAttribute('height', '56');

            // Copy defs for gradients/filters
            const defs = mainSvg.querySelector('defs');
            if (defs) tmpSvg.appendChild(defs.cloneNode(true));
            tmpSvg.appendChild(svgGroup.cloneNode(true));

            // Serialize → data URL → <img>
            const svgStr = new XMLSerializer().serializeToString(tmpSvg);
            const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);

            const img = document.createElement('img');
            img.width = 28;
            img.height = 28;
            img.style.display = 'block';
            img.style.objectFit = 'contain';
            img.src = dataUrl;
            img.onload = () => {
                thumbEl.textContent = '';
                thumbEl.appendChild(img);
            };
        } catch (e) {
            // Keep fallback emoji
        }
    });
}

// ─── Collect a layer and all its descendants ───
function collectDescendants(layer, allLayers) {
    const result = new Set();
    result.add(layer);
    if (layer.ind === undefined) return result;
    const queue = [layer.ind];
    while (queue.length > 0) {
        const pInd = queue.shift();
        for (const l of allLayers) {
            if (l.parent === pInd && !result.has(l)) {
                result.add(l);
                if (l.ind !== undefined) queue.push(l.ind);
            }
        }
    }
    return result;
}

// ─── Move Layer Up/Down (moves entire group for z-order) ───
function moveLayer(flatIdx, direction) {
    const entry = state.flatLayers[flatIdx];
    if (!entry) return;
    const layer = entry.layer;
    const layers = state.lottieData.layers;

    // Find same-level siblings (same parent value)
    const parentVal = layer.parent;
    const topLevelSiblings = [];
    for (const l of layers) {
        if (l.parent === parentVal) topLevelSiblings.push(l);
    }

    const myPos = topLevelSiblings.indexOf(layer);
    if (myPos === -1) return;

    const targetPos = myPos + direction;
    if (targetPos < 0 || targetPos >= topLevelSiblings.length) return;

    saveSnapshot();

    const targetLayer = topLevelSiblings[targetPos];

    // Collect all layers in "my" group and "target" group
    const myGroup = collectDescendants(layer, layers);
    const targetGroup = collectDescendants(targetLayer, layers);

    // Build new layers array: replace myGroup and targetGroup in swapped order
    const newLayers = [];
    let i = 0;
    while (i < layers.length) {
        if (myGroup.has(layers[i])) {
            // Skip my group layers (will insert target group here)
            if (direction < 0) {
                // Moving up: insert my group, then target group
                for (const l of layers) { if (myGroup.has(l)) newLayers.push(l); }
                for (const l of layers) { if (targetGroup.has(l)) newLayers.push(l); }
            } else {
                // Moving down: insert target group, then my group
                for (const l of layers) { if (targetGroup.has(l)) newLayers.push(l); }
                for (const l of layers) { if (myGroup.has(l)) newLayers.push(l); }
            }
            // Skip all layers from both groups
            while (i < layers.length && (myGroup.has(layers[i]) || targetGroup.has(layers[i]))) i++;
        } else if (targetGroup.has(layers[i])) {
            // Skip target group layers (already inserted above)
            while (i < layers.length && targetGroup.has(layers[i])) i++;
        } else {
            newLayers.push(layers[i]);
            i++;
        }
    }

    // Replace layers array contents
    state.lottieData.layers = newLayers;

    renderPreview();
    buildLayersList();
    if (renderInspectorFn) renderInspectorFn();
}

// ─── Select Layer (multi-select with Ctrl) ───
export function selectLayer(idx, event) {
    const ctrlKey = event && (event.ctrlKey || event.metaKey);

    if (ctrlKey) {
        if (state.selectedLayerIndices.has(idx)) {
            state.selectedLayerIndices.delete(idx);
        } else {
            state.selectedLayerIndices.add(idx);
        }
    } else {
        if (state.selectedLayerIndices.size === 1 && state.selectedLayerIndices.has(idx)) {
            state.selectedLayerIndices.clear();
            dom.layersList.querySelectorAll('.layer-item').forEach(el => el.classList.remove('selected'));
            dom.lottiePlayer.style.cursor = '';
            state.currentTab = 'colors';
            document.querySelectorAll('.inspector-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'colors'));
            if (renderActiveTabFn) renderActiveTabFn();
            updateSelectionBox();
            updateLayerClipboardControls();
            clearSelectedShapePath();
            return;
        }
        state.selectedLayerIndices.clear();
        state.selectedLayerIndices.add(idx);
    }

    if (state.selectedLayerIndices.size > 0) {
        state.currentTab = 'inspector';
        document.querySelectorAll('.inspector-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'inspector'));
    } else {
        state.currentTab = 'colors';
        document.querySelectorAll('.inspector-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'colors'));
    }

    dom.layersList.querySelectorAll('.layer-item').forEach((el, i) => {
        el.classList.toggle('selected', state.selectedLayerIndices.has(i));
    });

    if (state.selectedLayerIndices.size !== 1) {
        clearSelectedShapePath();
    } else {
        const selectedEntry = state.flatLayers[[...state.selectedLayerIndices][0]];
        if (!selectedEntry || !layerMatchesShapeSelection(selectedEntry.layer)) clearSelectedShapePath();
    }

    if (renderInspectorFn) renderInspectorFn();
    updateSelectionBox();
    updateLayerClipboardControls();

    dom.lottiePlayer.style.cursor = state.selectedLayerIndices.size > 0 ? 'grab' : '';
}

// ─── Cascade Delete: collect a layer and all its children (by parent chain) ───
function collectLayerAndChildren(layer, allLayers) {
    const toDelete = new Set();
    toDelete.add(layer);
    if (layer.ind === undefined) return toDelete;

    // BFS to find all descendants
    const queue = [layer.ind];
    while (queue.length > 0) {
        const parentInd = queue.shift();
        for (const l of allLayers) {
            if (l.parent === parentInd && !toDelete.has(l)) {
                toDelete.add(l);
                if (l.ind !== undefined) queue.push(l.ind);
            }
        }
    }
    return toDelete;
}

// ─── Delete Layer (with cascade) ───
export function deleteLayer(idx) {
    const entry = state.flatLayers[idx];
    if (!entry) return;
    saveSnapshot();

    // Collect all indices to delete (including children of selected)
    const layersToRemove = new Set();

    const indicesToProcess = (state.selectedLayerIndices.has(idx) && state.selectedLayerIndices.size > 1)
        ? [...state.selectedLayerIndices]
        : [idx];

    for (const si of indicesToProcess) {
        const e = state.flatLayers[si];
        if (!e) continue;
        const cascade = collectLayerAndChildren(e.layer, state.lottieData.layers);
        for (const l of cascade) layersToRemove.add(l);
    }

    // Remove from layers array
    const before = state.lottieData.layers.length;
    state.lottieData.layers = state.lottieData.layers.filter(l => !layersToRemove.has(l));
    const removed = before - state.lottieData.layers.length;

    state.selectedLayerIndices.clear();
    clearSelectedShapePath();
    toast(`Deleted ${removed} layer${removed !== 1 ? 's' : ''}`, 'info');

    renderPreview();
    buildLayersList();
    if (renderInspectorFn) renderInspectorFn();
    updateLayerClipboardControls();
}

// ─── Selection Bounding Box ───
function ensureSelectionBox() {
    if (!state.selectionBox) {
        state.selectionBox = document.createElement('div');
        state.selectionBox.className = 'selection-box';
        state.selectionBox.innerHTML = `
            <button type="button" class="sel-rotate-handle" title="Rotate selected layer">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M10.9 4.2A4.8 4.8 0 1 0 11.5 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
                    <path d="M10.9 1.8v2.4H8.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
            </button>
            <div class="sel-corner tl"></div><div class="sel-corner tr"></div><div class="sel-corner bl"></div><div class="sel-corner br"></div>`;
        state.selectionBox.querySelector('.sel-rotate-handle')?.addEventListener('mousedown', startRotateDrag);
        dom.previewContainer.appendChild(state.selectionBox);
    }
    return state.selectionBox;
}

function startRotateDrag(e) {
    if (!state.lottieData || state.selectedLayerIndices.size === 0) return;

    const boxRect = state.selectionBox.getBoundingClientRect();
    const centerX = boxRect.left + boxRect.width / 2;
    const centerY = boxRect.top + boxRect.height / 2;
    const rotateEntries = [];

    for (const si of state.selectedLayerIndices) {
        const entry = state.flatLayers[si];
        if (!entry || !entry.layer || !entry.layer.ks) continue;
        const prop = ensureLayerRotationProp(entry.layer);
        rotateEntries.push({ entry, prop, startRotation: getStaticOrFirstKeyframeScalar(prop) || 0 });
    }
    if (rotateEntries.length === 0) return;

    saveSnapshot();
    state.isDragging = true;
    state.isRotating = true;
    state.dragEntries = [];
    state.dragShapeEntry = null;
    state.rotateEntries = rotateEntries;
    state.rotateCenterX = centerX;
    state.rotateCenterY = centerY;
    state.rotateStartAngle = Math.atan2(e.clientY - centerY, e.clientX - centerX);

    if (state.anim && state.isPlaying) state.anim.pause();
    dom.lottiePlayer.style.cursor = 'grabbing';
    e.preventDefault();
    e.stopPropagation();
}

function ensureLayerRotationProp(layer) {
    if (!layer.ks) layer.ks = {};
    if (!layer.ks.r) layer.ks.r = { a: 0, k: 0 };
    return layer.ks.r;
}

export function updateSelectionBox() {
    const box = ensureSelectionBox();

    if (state.selectedLayerIndices.size === 0 || !state.anim) {
        box.style.display = 'none';
        return;
    }

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const containerRect = dom.previewContainer.getBoundingClientRect();

    for (const si of state.selectedLayerIndices) {
        const entry = state.flatLayers[si];
        if (!entry) continue;
        const svgGroup = findRenderedLayerElement(entry);
        if (!svgGroup) continue;
        try {
            const r = svgGroup.getBoundingClientRect();
            if (r.width < 1 && r.height < 1) continue;
            minX = Math.min(minX, r.left - containerRect.left);
            minY = Math.min(minY, r.top - containerRect.top);
            maxX = Math.max(maxX, r.right - containerRect.left);
            maxY = Math.max(maxY, r.bottom - containerRect.top);
        } catch (e) {}
    }

    if (minX === Infinity) { box.style.display = 'none'; return; }

    box.style.display = 'block';
    box.style.left = minX + 'px';
    box.style.top = minY + 'px';
    box.style.width = (maxX - minX) + 'px';
    box.style.height = (maxY - minY) + 'px';
}

function findRenderedLayerElement(entry) {
    if (!state.anim || !state.anim.renderer || !state.anim.renderer.elements) return null;
    const { path } = entry;

    if (path[0] !== 'asset') {
        const layerArrayIndex = path[path.length - 1];
        const el = state.anim.renderer.elements[layerArrayIndex];
        if (el) return el.baseElement || el.layerElement || null;
    } else {
        for (const el of state.anim.renderer.elements) {
            if (el && el.elements) {
                const childIdx = path[path.length - 1];
                const child = el.elements[childIdx];
                if (child) return child.baseElement || child.layerElement || null;
            }
        }
    }
    return null;
}

// ─── Drag-to-Move ───
export function initDrag() {
    dom.lottiePlayer.addEventListener('mousedown', (e) => {
        if (!state.lottieData || state.selectedLayerIndices.size === 0) return;

        if (state.selectedLayerIndices.size === 1) {
            const entry = state.flatLayers[[...state.selectedLayerIndices][0]];
            const shapePath = entry && getSelectedShapePathForLayer(entry.layer);
            if (entry && shapePath) {
                saveSnapshot();
                state.isDragging = true;
                state.dragShapeEntry = { entry, shapePath };
                state.dragShapeLastDx = 0;
                state.dragShapeLastDy = 0;
                state.dragStartMouseX = e.clientX;
                state.dragStartMouseY = e.clientY;

                if (state.anim && state.isPlaying) state.anim.pause();
                dom.lottiePlayer.style.cursor = 'grabbing';
                e.preventDefault();
                return;
            }
        }

        state.dragEntries = [];
        for (const si of state.selectedLayerIndices) {
            const entry = state.flatLayers[si];
            if (!entry || !entry.layer.ks || !entry.layer.ks.p) continue;
            const pos = getStaticOrFirstKeyframe(entry.layer.ks.p);
            state.dragEntries.push({ entry, startX: pos[0], startY: pos[1] });
        }
        if (state.dragEntries.length === 0) return;

        saveSnapshot();
        state.isDragging = true;
        state.dragStartMouseX = e.clientX;
        state.dragStartMouseY = e.clientY;

        if (state.anim && state.isPlaying) state.anim.pause();
        dom.lottiePlayer.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!state.isDragging) return;

        if (state.isRotating) {
            const angle = Math.atan2(e.clientY - state.rotateCenterY, e.clientX - state.rotateCenterX);
            const deltaDeg = (angle - state.rotateStartAngle) * 180 / Math.PI;
            for (const re of state.rotateEntries) {
                setStaticOrFirstKeyframeScalar(re.prop, re.startRotation + deltaDeg);
            }
            renderPreviewSilent();

            if (state.rotateEntries.length === 1) {
                const inp = document.getElementById('inp-rotation');
                if (inp) inp.value = formatAngle(state.rotateEntries[0].startRotation + deltaDeg);
            }
            return;
        }

        const dx = (e.clientX - state.dragStartMouseX) / state.previewScale;
        const dy = (e.clientY - state.dragStartMouseY) / state.previewScale;

        if (state.dragShapeEntry) {
            const moveDx = dx - state.dragShapeLastDx;
            const moveDy = dy - state.dragShapeLastDy;
            if (moveShapePath(state.dragShapeEntry.entry.layer, state.dragShapeEntry.shapePath, moveDx, moveDy)) {
                state.dragShapeLastDx = dx;
                state.dragShapeLastDy = dy;
                renderPreviewSilent();
            }
            return;
        }

        if (state.dragEntries.length === 0) return;

        for (const de of state.dragEntries) {
            const newX = Math.round(de.startX + dx);
            const newY = Math.round(de.startY + dy);
            setStaticOrFirstKeyframe(de.entry.layer.ks.p, [newX, newY]);
        }

        renderPreviewSilent();

        if (state.dragEntries.length === 1) {
            const inpX = document.getElementById('inp-pos-x');
            const inpY = document.getElementById('inp-pos-y');
            const pos = getStaticOrFirstKeyframe(state.dragEntries[0].entry.layer.ks.p);
            if (inpX) inpX.value = pos[0];
            if (inpY) inpY.value = pos[1];
        }
    });

    document.addEventListener('mouseup', () => {
        if (!state.isDragging) return;
        state.isDragging = false;
        state.isRotating = false;
        state.dragEntries = [];
        state.dragShapeEntry = null;
        state.dragShapeLastDx = 0;
        state.dragShapeLastDy = 0;
        state.rotateEntries = [];
        dom.lottiePlayer.style.cursor = state.selectedLayerIndices.size > 0 ? 'grab' : '';

        if (state.anim && state.isPlaying) state.anim.play();
    });
}

function formatAngle(value) {
    if (!Number.isFinite(value)) return '0';
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
