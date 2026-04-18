import { state, dom, TYPE_NAMES, TYPE_ICONS } from './state.js';
import { saveSnapshot, getStaticOrFirstKeyframe, setStaticOrFirstKeyframe, toast } from './utils.js';
import { renderPreview, renderPreviewSilent } from './preview.js';

let renderInspectorFn = null;
let renderActiveTabFn = null;

export function setInspectorCallbacks(ri, rat) {
    renderInspectorFn = ri;
    renderActiveTabFn = rat;
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

    if (renderInspectorFn) renderInspectorFn();
    updateSelectionBox();

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
    toast(`Deleted ${removed} layer${removed !== 1 ? 's' : ''}`, 'info');

    renderPreview();
    buildLayersList();
    if (renderInspectorFn) renderInspectorFn();
}

// ─── Selection Bounding Box ───
function ensureSelectionBox() {
    if (!state.selectionBox) {
        state.selectionBox = document.createElement('div');
        state.selectionBox.className = 'selection-box';
        state.selectionBox.innerHTML = '<div class="sel-corner tl"></div><div class="sel-corner tr"></div><div class="sel-corner bl"></div><div class="sel-corner br"></div>';
        dom.previewContainer.appendChild(state.selectionBox);
    }
    return state.selectionBox;
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
        if (!state.isDragging || state.dragEntries.length === 0) return;

        const dx = (e.clientX - state.dragStartMouseX) / state.previewScale;
        const dy = (e.clientY - state.dragStartMouseY) / state.previewScale;

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
        state.dragEntries = [];
        dom.lottiePlayer.style.cursor = state.selectedLayerIndices.size > 0 ? 'grab' : '';

        if (state.anim && state.isPlaying) state.anim.play();
    });
}
