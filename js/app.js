/* Lottie Editor — Entry Point */

import { state, initDom, dom } from './state.js';
import { toast, saveSnapshot } from './utils.js';
import { loadFile, mergeFile } from './file.js';
import { renderPreview, initPlaybackControls, setUpdateSelectionBox, setPlayheadCallback, setRebuildTimelineCallback } from './preview.js';
import { buildLayersList, initDrag, updateSelectionBox, setInspectorCallbacks, setTimelineCallback, extendAllLayers, selectLayer } from './layers.js';
import { renderInspector, renderActiveTab, initTabs } from './inspector.js';
import { initExport } from './export.js';
import { initGifExport } from './gif.js';
import { initTextOverlay } from './text.js';
import { initTimelineDom, initTimeline, buildTimeline, updatePlayhead, setTimelineSelectCallback, setTimelineRebuildCallback, trimInToCTI, trimOutToCTI } from './timeline.js';

// ─── Initialize ───
initDom();
initTimelineDom();

// Wire callbacks to break circular deps
setUpdateSelectionBox(updateSelectionBox);
setInspectorCallbacks(renderInspector, renderActiveTab);
setTimelineCallback(buildTimeline);
setTimelineSelectCallback(selectLayer);
setTimelineRebuildCallback(buildLayersList);
setPlayheadCallback(updatePlayhead);
setRebuildTimelineCallback(buildTimeline);

// Action helpers that bind renderPreview/buildLayersList/renderInspector
const actions = { renderPreview, buildLayersList, renderInspector, selectLayer };
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

function isEditingInput(target) {
    if (!target) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function stepFrame(delta) {
    if (!state.anim || !state.lottieData) return;
    const ip = state.lottieData.ip ?? 0;
    const op = state.lottieData.op ?? 60;
    const total = op - ip;
    const cf = state.anim.currentFrame || 0;
    const next = Math.max(0, Math.min(total, cf + delta));
    state.anim.goToAndStop(next, true);
    state.isPlaying = false;
    if (dom.iconPlay && dom.iconPause) {
        dom.iconPlay.classList.remove('hidden');
        dom.iconPause.classList.add('hidden');
    }
    if (dom.scrubber) dom.scrubber.value = Math.floor(next);
    if (dom.frameLabel) dom.frameLabel.textContent = `${Math.floor(next)} / ${Math.floor(total)}`;
    updatePlayhead();
}

function jumpTo(frame) {
    if (!state.anim || !state.lottieData) return;
    const op = state.lottieData.op ?? 60;
    const ip = state.lottieData.ip ?? 0;
    const clamped = Math.max(0, Math.min(op - ip, frame));
    state.anim.goToAndStop(clamped, true);
    state.isPlaying = false;
    if (dom.iconPlay && dom.iconPause) {
        dom.iconPlay.classList.remove('hidden');
        dom.iconPause.classList.add('hidden');
    }
    if (dom.scrubber) dom.scrubber.value = Math.floor(clamped);
    if (dom.frameLabel) dom.frameLabel.textContent = `${Math.floor(clamped)} / ${Math.floor(op - ip)}`;
    updatePlayhead();
}

function togglePlayPause() {
    if (!state.anim) return;
    if (state.isPlaying) { state.anim.pause(); state.isPlaying = false; }
    else                 { state.anim.play();  state.isPlaying = true;  }
    if (dom.iconPlay && dom.iconPause) {
        dom.iconPlay.classList.toggle('hidden', state.isPlaying);
        dom.iconPause.classList.toggle('hidden', !state.isPlaying);
    }
}

document.addEventListener('keydown', (e) => {
    if (isEditingInput(e.target)) return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        performUndo();
        return;
    }

    if (!state.lottieData) return;

    switch (e.key) {
        case ' ':
            e.preventDefault();
            togglePlayPause();
            break;
        case ',':
            e.preventDefault();
            stepFrame(e.shiftKey ? -10 : -1);
            break;
        case '.':
            e.preventDefault();
            stepFrame(e.shiftKey ? 10 : 1);
            break;
        case 'Home':
            e.preventDefault();
            jumpTo(0);
            break;
        case 'End': {
            e.preventDefault();
            const ip = state.lottieData.ip ?? 0;
            const op = state.lottieData.op ?? 60;
            jumpTo(op - ip);
            break;
        }
        case '[':
            e.preventDefault();
            if (trimInToCTI()) toast('Layer in → playhead', 'info');
            break;
        case ']':
            e.preventDefault();
            if (trimOutToCTI()) toast('Layer out → playhead', 'info');
            break;
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
initGifExport();
initTextOverlay(actions);
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
