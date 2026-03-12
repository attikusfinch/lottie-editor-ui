/* Layer list, selection, deletion, drag-to-move, selection box */

import { state, dom, TYPE_NAMES, TYPE_ICONS } from './state.js';
import { saveSnapshot, getStaticOrFirstKeyframe, setStaticOrFirstKeyframe, toast } from './utils.js';
import { renderPreview, renderPreviewSilent } from './preview.js';

let renderInspectorFn = null;
let renderActiveTabFn = null;

export function setInspectorCallbacks(ri, rat) {
    renderInspectorFn = ri;
    renderActiveTabFn = rat;
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

        const icon = document.createElement('div');
        icon.className = 'layer-icon';
        icon.textContent = TYPE_ICONS[layer.ty] || '?';

        const name = document.createElement('span');
        name.className = 'layer-name';
        name.textContent = layer.nm || `Layer ${layer.ind ?? idx}`;

        const tag = document.createElement('span');
        tag.className = 'layer-type-tag';
        tag.textContent = TYPE_NAMES[layer.ty] || `ty:${layer.ty}`;

        const delBtn = document.createElement('button');
        delBtn.className = 'layer-delete-btn';
        delBtn.title = 'Delete layer';
        delBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3.5l8 8M11 3.5l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            deleteLayer(idx);
        });

        item.appendChild(icon);
        item.appendChild(name);
        item.appendChild(tag);
        item.appendChild(delBtn);

        item.addEventListener('click', (e) => selectLayer(idx, e));
        dom.layersList.appendChild(item);
    });
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

// ─── Delete Layer ───
export function deleteLayer(idx) {
    const entry = state.flatLayers[idx];
    if (!entry) return;
    saveSnapshot();

    if (state.selectedLayerIndices.has(idx) && state.selectedLayerIndices.size > 1) {
        const sorted = [...state.selectedLayerIndices].sort((a, b) => b - a);
        let count = 0;
        for (const si of sorted) {
            const e = state.flatLayers[si];
            if (!e) continue;
            let arr;
            if (e.path[0] === 'asset') {
                const asset = state.lottieData.assets.find(a => a.id === e.path[1]);
                arr = asset && asset.layers;
            } else {
                arr = state.lottieData.layers;
            }
            if (!arr) continue;
            const ai = arr.indexOf(e.layer);
            if (ai !== -1) { arr.splice(ai, 1); count++; }
        }
        state.selectedLayerIndices.clear();
        toast(`Deleted ${count} layers`, 'info');
    } else {
        const { layer, path } = entry;
        const layerName = layer.nm || `Layer ${idx}`;
        let layersArray;
        if (path[0] === 'asset') {
            const asset = state.lottieData.assets.find(a => a.id === path[1]);
            if (asset && asset.layers) layersArray = asset.layers;
        } else {
            layersArray = state.lottieData.layers;
        }
        if (!layersArray) return;
        const arrayIndex = layersArray.indexOf(layer);
        if (arrayIndex === -1) return;
        layersArray.splice(arrayIndex, 1);
        state.selectedLayerIndices.delete(idx);
        toast(`Deleted "${layerName}"`, 'info');
    }

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
