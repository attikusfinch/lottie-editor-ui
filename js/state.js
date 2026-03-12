/* Shared application state — imported by all modules */

export const state = {
    lottieData: null,
    anim: null,
    selectedLayerIndices: new Set(),
    flatLayers: [],
    isPlaying: true,
    isLooping: true,

    // Undo
    undoStack: [],
    MAX_UNDO: 50,

    // Drag
    isDragging: false,
    dragStartMouseX: 0,
    dragStartMouseY: 0,
    dragStartLayerX: 0,
    dragStartLayerY: 0,
    dragLayerEntry: null,
    dragEntries: [],
    previewScale: 1,

    // Selection
    selectionBox: null,

    // Inspector tabs
    currentTab: 'colors',
    originalColors: null,
    savedAdjust: { hue: 0, sat: 0, light: 0 },
    savedGroupAdjust: {},
    collapsedLayers: new Set(), // layer indices that are collapsed in tree
};

/* DOM references — populated once at init */
export const dom = {};

export function initDom() {
    dom.fileInput        = document.getElementById('file-input');
    dom.btnExport        = document.getElementById('btn-export');
    dom.fileNameLabel    = document.getElementById('file-name');
    dom.layersList       = document.getElementById('layers-list');
    dom.layerCount       = document.getElementById('layer-count');
    dom.inspectorContent = document.getElementById('inspector-content');
    dom.lottiePlayer     = document.getElementById('lottie-player');
    dom.previewEmpty     = document.getElementById('preview-empty');
    dom.previewContainer = document.getElementById('preview-container');
    dom.playbackControls = document.getElementById('playback-controls');
    dom.btnPlayPause     = document.getElementById('btn-play-pause');
    dom.iconPlay         = document.getElementById('icon-play');
    dom.iconPause        = document.getElementById('icon-pause');
    dom.scrubber         = document.getElementById('scrubber');
    dom.frameLabel       = document.getElementById('frame-label');
    dom.btnLoop          = document.getElementById('btn-loop');
    dom.exportDropdown   = document.getElementById('export-dropdown');
    dom.mergeInput       = document.getElementById('merge-input');
    dom.btnUndo          = document.getElementById('btn-undo');
}

/* Layer type constants */
export const TYPE_NAMES = {
    0: 'Precomp', 1: 'Solid', 2: 'Image', 3: 'Null',
    4: 'Shape', 5: 'Text', 6: 'Audio', 13: 'Camera',
};

export const TYPE_ICONS = {
    0: '📦', 1: '⬛', 2: '🖼', 3: '◻️',
    4: '✦', 5: 'T', 6: '🔊', 13: '📷',
};
