/* Text overlay: uploaded font -> vector Lottie shape layer */

import { state, dom } from './state.js';
import {
    getStaticOrFirstKeyframe,
    getStaticOrFirstKeyframeScalar,
    hexToRgb,
    rgbToHex,
    saveSnapshot,
    toast,
} from './utils.js';
import { renderPreview } from './preview.js';

const DEFAULT_TEXT = 'Text';

const settings = {
    font: null,
    fontName: '',
    text: DEFAULT_TEXT,
    fontSize: 96,
    lineHeight: 116,
    letterSpacing: 0,
    opacity: 100,
    x: null,
    y: null,
    rotation: 0,
    color: '#ffffff',
    align: 'center',
};

let modalDom = null;
let actions = null;
let selectedOverlayLayer = null;

function getModal() {
    if (modalDom) return modalDom;
    modalDom = {
        overlay: document.getElementById('text-modal'),
        close: document.getElementById('text-modal-close'),
        cancel: document.getElementById('text-modal-cancel'),
        go: document.getElementById('text-modal-go'),
        fontInput: document.getElementById('text-font-input'),
        fontName: document.getElementById('text-font-name'),
        text: document.getElementById('text-overlay-value'),
        fontSize: document.getElementById('text-font-size'),
        lineHeight: document.getElementById('text-line-height'),
        letterSpacing: document.getElementById('text-letter-spacing'),
        opacity: document.getElementById('text-opacity'),
        x: document.getElementById('text-pos-x'),
        y: document.getElementById('text-pos-y'),
        rotation: document.getElementById('text-rotation'),
        color: document.getElementById('text-color'),
        align: document.getElementById('text-align-control'),
        info: document.getElementById('text-overlay-info'),
    };
    return modalDom;
}

export function initTextOverlay(actionFns) {
    actions = actionFns;
    const m = getModal();

    dom.btnTextOverlay.addEventListener('click', openModal);
    m.close.addEventListener('click', closeModal);
    m.cancel.addEventListener('click', closeModal);
    m.overlay.addEventListener('click', (e) => {
        if (e.target === m.overlay) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !m.overlay.classList.contains('hidden')) closeModal();
    });

    m.fontInput.addEventListener('change', loadFont);
    m.go.addEventListener('click', commitOverlay);

    for (const input of [m.text, m.fontSize, m.lineHeight, m.letterSpacing, m.opacity, m.x, m.y, m.rotation, m.color]) {
        input.addEventListener('input', () => {
            readSettingsFromForm();
            updateModalState();
        });
    }

    m.align.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-value]');
        if (!btn) return;
        m.align.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settings.align = btn.dataset.value;
        updateModalState();
    });

    setInterval(() => {
        if (dom.btnTextOverlay) dom.btnTextOverlay.disabled = !state.lottieData;
    }, 500);
}

function openModal() {
    if (!state.lottieData) {
        toast('Load a Lottie file first', 'error');
        return;
    }

    selectedOverlayLayer = getSingleSelectedTextOverlay();
    if (selectedOverlayLayer && selectedOverlayLayer._textOverlay) {
        const metadata = getTextOverlaySettings(selectedOverlayLayer);
        const keepLoadedFont = settings.font && settings.fontName === metadata.fontName;
        Object.assign(settings, metadata);
        if (!keepLoadedFont) settings.font = null;
    } else {
        settings.text = settings.text || DEFAULT_TEXT;
        settings.x = Math.round((state.lottieData.w || 512) / 2);
        settings.y = Math.round((state.lottieData.h || 512) / 2);
    }

    writeSettingsToForm();
    updateModalState();
    getModal().overlay.classList.remove('hidden');
}

function getTextOverlaySettings(layer) {
    const metadata = { ...(layer._textOverlay || {}) };
    if (layer.ks) {
        if (layer.ks.p) {
            const pos = getStaticOrFirstKeyframe(layer.ks.p);
            metadata.x = pos[0] ?? metadata.x;
            metadata.y = pos[1] ?? metadata.y;
        }
        if (layer.ks.r) metadata.rotation = getStaticOrFirstKeyframeScalar(layer.ks.r);
        if (layer.ks.o) metadata.opacity = getStaticOrFirstKeyframeScalar(layer.ks.o);
    }

    const fill = findFirstFillColor(layer.shapes);
    if (fill) metadata.color = rgbToHex(fill[0], fill[1], fill[2]);
    return metadata;
}

function findFirstFillColor(items) {
    if (!Array.isArray(items)) return null;
    for (const item of items) {
        if (item.ty === 'fl' && item.c && Array.isArray(item.c.k)) return item.c.k;
        const child = findFirstFillColor(item.it);
        if (child) return child;
    }
    return null;
}

function closeModal() {
    getModal().overlay.classList.add('hidden');
}

async function loadFont(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!window.opentype || typeof window.opentype.parse !== 'function') {
        toast('opentype.js did not load. Check your connection.', 'error');
        return;
    }

    try {
        const buffer = await file.arrayBuffer();
        const font = window.opentype.parse(buffer);
        settings.font = font;
        settings.fontName = getFontDisplayName(font, file.name);
        const m = getModal();
        m.fontName.textContent = settings.fontName;
        m.info.textContent = 'Font loaded';
        updateModalState();
        toast(`Font loaded: ${settings.fontName}`, 'success');
    } catch (err) {
        settings.font = null;
        settings.fontName = '';
        getModal().fontName.textContent = 'No font';
        updateModalState();
        toast('Font parse failed. Use TTF, OTF, or WOFF.', 'error');
        console.error('Font parse failed:', err);
    } finally {
        e.target.value = '';
    }
}

function getFontDisplayName(font, fallback) {
    const names = font.names || {};
    const full = names.fullName && (names.fullName.en || Object.values(names.fullName)[0]);
    const family = names.fontFamily && (names.fontFamily.en || Object.values(names.fontFamily)[0]);
    return full || family || fallback.replace(/\.[^.]+$/, '');
}

function getSingleSelectedTextOverlay() {
    if (state.selectedLayerIndices.size !== 1) return null;
    const idx = [...state.selectedLayerIndices][0];
    const entry = state.flatLayers[idx];
    if (!entry || !entry.layer || !entry.layer._isTextOverlay) return null;
    return entry.layer;
}

function readSettingsFromForm() {
    const m = getModal();
    settings.text = m.text.value;
    settings.fontSize = clampNumber(m.fontSize.value, 1, 10000, 96);
    settings.lineHeight = clampNumber(m.lineHeight.value, 1, 10000, Math.round(settings.fontSize * 1.2));
    settings.letterSpacing = clampNumber(m.letterSpacing.value, -10000, 10000, 0);
    settings.opacity = clampNumber(m.opacity.value, 0, 100, 100);
    settings.x = clampNumber(m.x.value, -100000, 100000, Math.round((state.lottieData.w || 512) / 2));
    settings.y = clampNumber(m.y.value, -100000, 100000, Math.round((state.lottieData.h || 512) / 2));
    settings.rotation = clampNumber(m.rotation.value, -36000, 36000, 0);
    settings.color = m.color.value || '#ffffff';
}

function writeSettingsToForm() {
    const m = getModal();
    m.fontName.textContent = settings.fontName || 'No font';
    m.text.value = settings.text || DEFAULT_TEXT;
    m.fontSize.value = Math.round(settings.fontSize || 96);
    m.lineHeight.value = Math.round(settings.lineHeight || (settings.fontSize || 96) * 1.2);
    m.letterSpacing.value = settings.letterSpacing || 0;
    m.opacity.value = settings.opacity ?? 100;
    m.x.value = Math.round(settings.x ?? (state.lottieData.w || 512) / 2);
    m.y.value = Math.round(settings.y ?? (state.lottieData.h || 512) / 2);
    m.rotation.value = settings.rotation || 0;
    m.color.value = settings.color || '#ffffff';
    m.align.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === settings.align);
    });
}

function updateModalState() {
    const m = getModal();
    const hasFont = !!settings.font;
    const hasText = !!(settings.text || '').trim();
    m.go.disabled = !state.lottieData || !hasFont || !hasText;
    m.go.lastChild.textContent = selectedOverlayLayer ? ' Update' : ' Add';

    if (!hasFont) {
        m.info.textContent = 'Load a TTF, OTF, or WOFF font';
    } else if (!hasText) {
        m.info.textContent = 'Enter text';
    } else {
        const lines = settings.text.split(/\r?\n/).length;
        m.info.textContent = `${settings.fontName} - ${lines} line${lines === 1 ? '' : 's'} - vector shape`;
    }
}

function clampNumber(value, min, max, fallback) {
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, num));
}

function commitOverlay() {
    if (!state.lottieData) return;
    readSettingsFromForm();
    if (!settings.font) {
        toast('Load a font first', 'error');
        return;
    }
    if (!settings.text.trim()) {
        toast('Enter text first', 'error');
        return;
    }

    let shapes;
    try {
        shapes = buildTextShapes(settings);
    } catch (err) {
        toast('Text conversion failed: ' + err.message, 'error');
        console.error('Text conversion failed:', err);
        return;
    }

    saveSnapshot();
    let layer = selectedOverlayLayer;
    if (layer) {
        applyTextLayerData(layer, shapes, settings);
        toast('Text overlay updated', 'success');
    } else {
        layer = createTextLayer(shapes, settings);
        state.lottieData.layers.unshift(layer);
        toast('Text overlay added on top', 'success');
    }

    closeModal();
    renderPreview();
    actions.buildLayersList();
    if (actions.renderInspector) actions.renderInspector();

    if (actions.selectLayer) {
        const idx = state.flatLayers.findIndex(entry => entry.layer === layer);
        if (idx >= 0) actions.selectLayer(idx);
    }
}

function createTextLayer(shapes, opts) {
    const layer = {
        ddd: 0,
        ind: nextLayerIndex(),
        ty: 4,
        nm: makeLayerName(opts.text),
        sr: 1,
        ks: {
            o: { a: 0, k: opts.opacity },
            r: { a: 0, k: opts.rotation },
            p: { a: 0, k: [opts.x, opts.y, 0] },
            a: { a: 0, k: [0, 0, 0] },
            s: { a: 0, k: [100, 100, 100] },
        },
        ao: 0,
        shapes: [],
        ip: state.lottieData.ip ?? 0,
        op: state.lottieData.op ?? 60,
        st: 0,
        bm: 0,
        _isTextOverlay: true,
        _textOverlay: {},
    };
    applyTextLayerData(layer, shapes, opts);
    return layer;
}

function applyTextLayerData(layer, shapes, opts) {
    layer.nm = makeLayerName(opts.text);
    layer.ty = 4;
    layer.ks.o = { a: 0, k: opts.opacity };
    layer.ks.r = { a: 0, k: opts.rotation };
    layer.ks.p = { a: 0, k: [opts.x, opts.y, 0] };
    layer.shapes = [
        {
            ty: 'gr',
            it: [
                ...shapes,
                {
                    ty: 'fl',
                    c: { a: 0, k: [...hexToRgb(opts.color), 1] },
                    o: { a: 0, k: 100 },
                    r: 1,
                    bm: 0,
                    nm: 'Fill',
                    mn: 'ADBE Vector Graphic - Fill',
                    hd: false,
                },
                {
                    ty: 'tr',
                    p: { a: 0, k: [0, 0] },
                    a: { a: 0, k: [0, 0] },
                    s: { a: 0, k: [100, 100] },
                    r: { a: 0, k: 0 },
                    o: { a: 0, k: 100 },
                    sk: { a: 0, k: 0 },
                    sa: { a: 0, k: 0 },
                    nm: 'Transform',
                },
            ],
            nm: 'Text Paths',
            np: shapes.length + 2,
            cix: 2,
            bm: 0,
            hd: false,
        },
    ];
    layer._isTextOverlay = true;
    layer._textOverlay = {
        fontName: opts.fontName,
        text: opts.text,
        fontSize: opts.fontSize,
        lineHeight: opts.lineHeight,
        letterSpacing: opts.letterSpacing,
        opacity: opts.opacity,
        x: opts.x,
        y: opts.y,
        rotation: opts.rotation,
        color: opts.color,
        align: opts.align,
    };
}

function makeLayerName(text) {
    const clean = (text || DEFAULT_TEXT).replace(/\s+/g, ' ').trim().slice(0, 28);
    return `Text: ${clean || DEFAULT_TEXT}`;
}

function nextLayerIndex() {
    let maxInd = 0;
    function scan(layers) {
        if (!Array.isArray(layers)) return;
        for (const layer of layers) {
            if (Number.isFinite(layer.ind)) maxInd = Math.max(maxInd, layer.ind);
        }
    }
    scan(state.lottieData.layers);
    for (const asset of state.lottieData.assets || []) scan(asset.layers);
    return maxInd + 1;
}

function buildTextShapes(opts) {
    const contours = [];
    const lines = opts.text.replace(/\r\n/g, '\n').split('\n');
    const scale = opts.fontSize / opts.font.unitsPerEm;

    lines.forEach((line, lineIndex) => {
        const advance = getLineAdvance(opts.font, line, scale, opts.letterSpacing);
        const offsetX = opts.align === 'center' ? -advance / 2 : opts.align === 'right' ? -advance : 0;
        const baseline = lineIndex * opts.lineHeight;
        appendLineContours(contours, opts.font, line, offsetX, baseline, scale, opts.fontSize, opts.letterSpacing);
    });

    if (contours.length === 0) throw new Error('no drawable glyphs');
    centerContours(contours);

    return contours.map((contour, index) => ({
        ty: 'sh',
        ix: index + 1,
        ks: { a: 0, k: contour },
        nm: `Path ${index + 1}`,
        mn: 'ADBE Vector Shape - Group',
        hd: false,
    }));
}

function getLineAdvance(font, line, scale, letterSpacing) {
    const glyphs = font.stringToGlyphs(line);
    let x = 0;
    for (let i = 0; i < glyphs.length; i++) {
        const glyph = glyphs[i];
        x += (glyph.advanceWidth || 0) * scale;
        if (i < glyphs.length - 1) {
            x += font.getKerningValue(glyph, glyphs[i + 1]) * scale + letterSpacing;
        }
    }
    return x;
}

function appendLineContours(contours, font, line, startX, baseline, scale, fontSize, letterSpacing) {
    const glyphs = font.stringToGlyphs(line);
    let x = startX;
    for (let i = 0; i < glyphs.length; i++) {
        const glyph = glyphs[i];
        const path = glyph.getPath(x, baseline, fontSize);
        contours.push(...pathCommandsToContours(path.commands));
        x += (glyph.advanceWidth || 0) * scale;
        if (i < glyphs.length - 1) {
            x += font.getKerningValue(glyph, glyphs[i + 1]) * scale + letterSpacing;
        }
    }
}

function pathCommandsToContours(commands) {
    const contours = [];
    let current = null;
    let point = [0, 0];

    const finish = () => {
        if (!current || current.v.length < 2) return;
        removeDuplicateClosingPoint(current);
        contours.push(current);
    };

    const ensureCurrent = () => {
        if (!current) {
            current = emptyContour();
            current.v.push([0, 0]);
            current.i.push([0, 0]);
            current.o.push([0, 0]);
        }
    };

    for (const cmd of commands) {
        if (cmd.type === 'M') {
            finish();
            current = emptyContour();
            point = [cmd.x, cmd.y];
            current.v.push(point.slice());
            current.i.push([0, 0]);
            current.o.push([0, 0]);
        } else if (cmd.type === 'L') {
            ensureCurrent();
            point = addSegment(current, point, [cmd.x, cmd.y], null, null);
        } else if (cmd.type === 'C') {
            ensureCurrent();
            point = addSegment(current, point, [cmd.x, cmd.y], [cmd.x1, cmd.y1], [cmd.x2, cmd.y2]);
        } else if (cmd.type === 'Q') {
            ensureCurrent();
            const c1 = [
                point[0] + (2 / 3) * (cmd.x1 - point[0]),
                point[1] + (2 / 3) * (cmd.y1 - point[1]),
            ];
            const end = [cmd.x, cmd.y];
            const c2 = [
                end[0] + (2 / 3) * (cmd.x1 - end[0]),
                end[1] + (2 / 3) * (cmd.y1 - end[1]),
            ];
            point = addSegment(current, point, end, c1, c2);
        } else if (cmd.type === 'Z') {
            if (current) current.c = true;
        }
    }
    finish();
    return contours;
}

function emptyContour() {
    return { i: [], o: [], v: [], c: false };
}

function addSegment(contour, from, to, c1, c2) {
    const last = contour.v.length - 1;
    if (c1) contour.o[last] = [round(c1[0] - from[0]), round(c1[1] - from[1])];
    contour.v.push([to[0], to[1]]);
    contour.i.push(c2 ? [round(c2[0] - to[0]), round(c2[1] - to[1])] : [0, 0]);
    contour.o.push([0, 0]);
    return to;
}

function removeDuplicateClosingPoint(contour) {
    if (!contour.c || contour.v.length < 2) return;
    const first = contour.v[0];
    const lastIndex = contour.v.length - 1;
    const last = contour.v[lastIndex];
    if (Math.abs(first[0] - last[0]) > 0.001 || Math.abs(first[1] - last[1]) > 0.001) return;
    contour.i[0] = contour.i[lastIndex];
    contour.v.pop();
    contour.i.pop();
    contour.o.pop();
}

function centerContours(contours) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const contour of contours) {
        for (const [x, y] of contour.v) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }
    const dx = -(minX + maxX) / 2;
    const dy = -(minY + maxY) / 2;
    for (const contour of contours) {
        contour.v = contour.v.map(([x, y]) => [round(x + dx), round(y + dy)]);
        contour.i = contour.i.map(([x, y]) => [round(x), round(y)]);
        contour.o = contour.o.map(([x, y]) => [round(x), round(y)]);
    }
}

function round(num) {
    return Math.round(num * 1000) / 1000;
}
