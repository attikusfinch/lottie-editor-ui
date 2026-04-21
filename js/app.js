/* Lottie Editor — Entry Point */

import { state, initDom, dom } from './state.js';
import { toast, saveSnapshot } from './utils.js';
import { loadFile, mergeFile } from './file.js';
import { renderPreview, initPlaybackControls, setUpdateSelectionBox, setPlayheadCallback, setRebuildTimelineCallback } from './preview.js';
import { buildLayersList, initDrag, updateSelectionBox, setInspectorCallbacks, setTimelineCallback, extendAllLayers, selectLayer } from './layers.js';
import { renderInspector, renderActiveTab, initTabs } from './inspector.js';
import { initExport } from './export.js';
import { initTimelineDom, initTimeline, buildTimeline, updatePlayhead, setTimelineSelectCallback } from './timeline.js';

// ─── Initialize ───
initDom();
initTimelineDom();

// Wire callbacks to break circular deps
setUpdateSelectionBox(updateSelectionBox);
setInspectorCallbacks(renderInspector, renderActiveTab);
setTimelineCallback(buildTimeline);
setTimelineSelectCallback(selectLayer);
setPlayheadCallback(updatePlayhead);
setRebuildTimelineCallback(buildTimeline);

// Action helpers that bind renderPreview/buildLayersList/renderInspector
const actions = { renderPreview, buildLayersList, renderInspector };
const loadActions = { ...actions, loadFile: (f) => loadFile(f, actions) };

// ─── File Input ───
dom.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) loadFile(file, actions);
});

// ─── Merge Input ───
dom.mergeInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    mergeFile(file, loadActions);
    dom.mergeInput.value = '';
});

// ─── Drag & Drop ───
document.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('drag-over'); });
document.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) document.body.classList.remove('drag-over'); });
document.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith('.json') || file.name.endsWith('.tgs'))) {
        if (state.lottieData) mergeFile(file, loadActions);
        else loadFile(file, actions);
    } else {
        toast('Please drop a .json or .tgs Lottie file', 'error');
    }
});

// ─── Undo ───
function performUndo() {
    if (state.undoStack.length === 0) { toast('Nothing to undo', 'info'); return; }
    state.lottieData = JSON.parse(state.undoStack.pop());
    state.selectedLayerIndices.clear();
    state.originalColors = null;
    renderPreview();
    buildLayersList();
    renderInspector();
    dom.btnUndo.disabled = state.undoStack.length === 0;
    toast('Undo', 'info');
}

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        performUndo();
    }
});

dom.btnUndo.addEventListener('click', () => performUndo());

// Enable undo button whenever a snapshot is saved
setInterval(() => {
    if (dom.btnUndo) dom.btnUndo.disabled = state.undoStack.length === 0;
}, 500);

// ─── Init subsystems ───
initPlaybackControls();
initTabs();
initDrag();
initExport();
initTimeline();

// ─── Extend All Layers ───
dom.btnExtendAll.addEventListener('click', () => {
    if (!state.lottieData) return;
    extendAllLayers();
});

// Enable extend-all button when file is loaded
setInterval(() => {
    if (dom.btnExtendAll) dom.btnExtendAll.disabled = !state.lottieData;
}, 500);
