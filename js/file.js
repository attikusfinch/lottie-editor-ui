/* File loading, merging, and data sanitization */

import { state, dom } from './state.js';
import { toast, saveSnapshot } from './utils.js';

// ─── Read .json or .tgs file ───
export function readLottieFile(file, callback) {
    if (file.name.endsWith('.tgs')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const raw = new Uint8Array(ev.target.result);
                let jsonStr;
                try {
                    jsonStr = pako.ungzip(raw, { to: 'string' });
                } catch (gzipErr) {
                    jsonStr = new TextDecoder('utf-8').decode(raw);
                }
                callback(JSON.parse(jsonStr));
            } catch (err) {
                console.error('TGS parse error:', err);
                toast('Failed to read TGS: ' + err.message, 'error');
            }
        };
        reader.readAsArrayBuffer(file);
    } else {
        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                callback(JSON.parse(ev.target.result));
            } catch (err) {
                console.error('JSON parse error:', err);
                toast('Failed to parse JSON: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    }
}

// ─── Load File ───
export function loadFile(file, { renderPreview, buildLayersList, renderInspector }) {
    readLottieFile(file, (data) => {
        try {
            if (!data || typeof data !== 'object') throw new Error('Parsed data is not a valid object');
            state.lottieData = data;

            if (!state.lottieData.layers) state.lottieData.layers = [];
            if (!Array.isArray(state.lottieData.layers)) throw new Error('Invalid Lottie: layers is not an array');
            if (!state.lottieData.w) state.lottieData.w = 512;
            if (!state.lottieData.h) state.lottieData.h = 512;
            if (!state.lottieData.fr) state.lottieData.fr = 30;
            if (state.lottieData.ip === undefined) state.lottieData.ip = 0;
            if (state.lottieData.op === undefined) state.lottieData.op = 60;
            if (!state.lottieData.v) state.lottieData.v = '5.5.2';
            if (!state.lottieData.assets) state.lottieData.assets = [];

            dom.fileNameLabel.textContent = file.name;
            dom.btnExport.disabled = false;
            state.selectedLayerIndices.clear();
            state.undoStack.length = 0;
            state.originalColors = null;
            state.savedAdjust = { hue: 0, sat: 0, light: 0 };
            state.savedGroupAdjust = {};
            toast(`Loaded "${file.name}"`, 'success');
            renderPreview();
            buildLayersList();
            renderInspector();
        } catch (err) {
            console.error('Load error:', err);
            toast('Failed to load: ' + err.message, 'error');
        }
    });
}

// ─── Merge File ───
export function mergeFile(file, { loadFile: loadFn, renderPreview, buildLayersList, renderInspector }) {
    if (!state.lottieData) {
        loadFn(file);
        return;
    }
    readLottieFile(file, (incoming) => {
        try {
            if (!incoming.layers || !Array.isArray(incoming.layers)) throw new Error('Invalid Lottie: no layers array');
            saveSnapshot();
            mergeLottie(incoming, file.name);
            toast(`Merged "${file.name}" (${incoming.layers.length} layers)`, 'success');
            renderPreview();
            buildLayersList();
            renderInspector();
        } catch (err) {
            toast('Merge failed: ' + err.message, 'error');
        }
    });
}

// ─── Merge Logic with Auto-Grouping ───
function mergeLottie(incoming, fileName) {
    let maxInd = 0;
    function findMaxInd(layers) {
        for (const l of layers) {
            if (l.ind !== undefined && l.ind > maxInd) maxInd = l.ind;
        }
    }
    findMaxInd(state.lottieData.layers);
    if (state.lottieData.assets) {
        for (const a of state.lottieData.assets) {
            if (a.layers) findMaxInd(a.layers);
        }
    }

    // Create Null parent for existing layers (if not already grouped)
    const existingName = (dom.fileNameLabel.textContent || 'Original').replace(/\.json$/i, '').replace(/\.tgs$/i, '');
    const hasExistingGroup = state.lottieData.layers.some(l => l._isGroup);

    if (!hasExistingGroup) {
        const groupInd = maxInd + 1;
        maxInd = groupInd;
        const existingGroup = {
            ty: 3, nm: existingName, ind: groupInd,
            ip: state.lottieData.ip || 0, op: state.lottieData.op || 60,
            ks: { o:{a:0,k:100}, r:{a:0,k:0}, p:{a:0,k:[0,0,0]}, a:{a:0,k:[0,0,0]}, s:{a:0,k:[100,100,100]} },
            _isGroup: true,
        };
        for (const l of state.lottieData.layers) {
            if (l.parent === undefined) l.parent = groupInd;
        }
        state.lottieData.layers.unshift(existingGroup);
    }

    maxInd = 0;
    findMaxInd(state.lottieData.layers);
    const indOffset = maxInd + 1;
    const assetPrefix = '_m' + Date.now() + '_';

    // Null parent for incoming
    const incomingGroupInd = indOffset;
    const cleanName = fileName.replace(/\.json$/i, '').replace(/\.tgs$/i, '');
    const incomingGroup = {
        ty: 3, nm: cleanName, ind: incomingGroupInd,
        ip: incoming.ip || 0, op: incoming.op || 60,
        ks: { o:{a:0,k:100}, r:{a:0,k:0}, p:{a:0,k:[0,0,0]}, a:{a:0,k:[0,0,0]}, s:{a:0,k:[100,100,100]} },
        _isGroup: true,
    };

    const clonedLayers = JSON.parse(JSON.stringify(incoming.layers));
    for (const layer of clonedLayers) {
        if (layer.ind !== undefined) layer.ind += indOffset + 1;
        if (layer.parent !== undefined) layer.parent += indOffset + 1;
        else layer.parent = incomingGroupInd;
        if (layer.ty === 0 && layer.refId) layer.refId = assetPrefix + layer.refId;
        if (layer.ty === 2 && layer.refId) layer.refId = assetPrefix + layer.refId;
    }

    if (incoming.assets && incoming.assets.length > 0) {
        if (!state.lottieData.assets) state.lottieData.assets = [];
        for (const asset of incoming.assets) {
            const cloned = JSON.parse(JSON.stringify(asset));
            cloned.id = assetPrefix + cloned.id;
            if (cloned.layers) {
                for (const l of cloned.layers) {
                    if (l.ind !== undefined) l.ind += indOffset + 1;
                    if (l.parent !== undefined) l.parent += indOffset + 1;
                    if (l.ty === 0 && l.refId) l.refId = assetPrefix + l.refId;
                    if (l.ty === 2 && l.refId) l.refId = assetPrefix + l.refId;
                }
            }
            state.lottieData.assets.push(cloned);
        }
    }

    if (incoming.w > state.lottieData.w) state.lottieData.w = incoming.w;
    if (incoming.h > state.lottieData.h) state.lottieData.h = incoming.h;
    if (incoming.ip < state.lottieData.ip) state.lottieData.ip = incoming.ip;
    if (incoming.op > state.lottieData.op) state.lottieData.op = incoming.op;
    if (incoming.fr && incoming.fr > (state.lottieData.fr || 30)) state.lottieData.fr = incoming.fr;

    state.lottieData.layers.push(incomingGroup, ...clonedLayers);
}

// ─── Data Sanitizer ───
export function sanitizeLottieData(data) {
    delete data.tgs;
    if (!data.v) data.v = '5.5.2';
    if (!data.fr) data.fr = 30;
    if (data.ip === undefined) data.ip = 0;
    if (data.op === undefined) data.op = 60;
    if (!data.w) data.w = 512;
    if (!data.h) data.h = 512;
    if (!data.assets) data.assets = [];
    if (!data.layers) data.layers = [];

    sanitizeLayers(data.layers);
    for (const asset of data.assets) {
        if (asset.layers) sanitizeLayers(asset.layers);
    }
}

function sanitizeLayers(layers) {
    for (const layer of layers) {
        if (!layer.nm) layer.nm = 'Layer ' + (layer.ind !== undefined ? layer.ind : '?');
        if (layer.ty === 4 && !layer.shapes) layer.shapes = [];
        if (layer.ty === 0 && !layer.refId) layer.refId = '';
        if (layer.ty === 2 && !layer.refId) layer.refId = '';
        if (!layer.ks) {
            layer.ks = {
                o: { a: 0, k: 100 },
                r: { a: 0, k: 0 },
                p: { a: 0, k: [0, 0, 0] },
                a: { a: 0, k: [0, 0, 0] },
                s: { a: 0, k: [100, 100, 100] },
            };
        }
        if (layer.ip === undefined) layer.ip = 0;
        if (layer.op === undefined) layer.op = 60;
    }
}
