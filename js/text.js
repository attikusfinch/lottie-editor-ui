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
    fillType: 'solid',
    color: '#ffffff',
    gradientFrom: '#ffffff',
    gradientTo: '#7c3aed',
    gradientAngle: 0,
    align: 'center',
};

let modalDom = null;
let actions = null;
let selectedOverlayLayer = null;
let previewSvg = null;
let hiddenEditElement = null;
let hiddenEditVisibility = '';

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
        fillMode: document.getElementById('text-fill-control'),
        color: document.getElementById('text-color'),
        colorField: document.querySelector('.text-color-field'),
        gradientControls: document.getElementById('text-gradient-controls'),
        gradientFrom: document.getElementById('text-gradient-from'),
        gradientTo: document.getElementById('text-gradient-to'),
        gradientAngle: document.getElementById('text-gradient-angle'),
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

    for (const input of [
        m.text, m.fontSize, m.lineHeight, m.letterSpacing, m.opacity, m.x, m.y, m.rotation,
        m.color, m.gradientFrom, m.gradientTo, m.gradientAngle,
    ]) {
        input.addEventListener('input', () => {
            readSettingsFromForm();
            updateModalState();
            updateTextPreview();
        });
    }

    m.fillMode.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-value]');
        if (!btn) return;
        m.fillMode.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settings.fillType = btn.dataset.value;
        updateFillControls();
        updateModalState();
        updateTextPreview();
    });

    m.align.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-value]');
        if (!btn) return;
        m.align.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settings.align = btn.dataset.value;
        updateModalState();
        updateTextPreview();
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
        settings.fillType = settings.fillType || 'solid';
        if (!keepLoadedFont) settings.font = null;
    } else {
        settings.text = settings.text || DEFAULT_TEXT;
        settings.fillType = settings.fillType || 'solid';
        settings.x = Math.round((state.lottieData.w || 512) / 2);
        settings.y = Math.round((state.lottieData.h || 512) / 2);
    }

    writeSettingsToForm();
    updateModalState();
    updateTextPreview();
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

    const gradient = findFirstGradientFill(layer.shapes);
    if (gradient) {
        metadata.fillType = 'gradient';
        metadata.gradientFrom = gradient.from;
        metadata.gradientTo = gradient.to;
        metadata.gradientAngle = gradient.angle;
    } else {
        const fill = findFirstFillColor(layer.shapes);
        if (fill) metadata.color = rgbToHex(fill[0], fill[1], fill[2]);
        metadata.fillType = metadata.fillType || 'solid';
    }
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

function findFirstGradientFill(items) {
    if (!Array.isArray(items)) return null;
    for (const item of items) {
        if (item.ty === 'gf' && item.g && item.g.k && Array.isArray(item.g.k.k)) {
            const data = item.g.k.k;
            const stops = Math.max(2, item.g.p || Math.floor(data.length / 4));
            const lastBase = (stops - 1) * 4;
            const s = item.s && Array.isArray(item.s.k) ? item.s.k : [0, 0];
            const e = item.e && Array.isArray(item.e.k) ? item.e.k : [1, 0];
            return {
                from: rgbToHex(data[1] ?? 1, data[2] ?? 1, data[3] ?? 1),
                to: rgbToHex(data[lastBase + 1] ?? 1, data[lastBase + 2] ?? 1, data[lastBase + 3] ?? 1),
                angle: Math.round(Math.atan2((e[1] ?? 0) - (s[1] ?? 0), (e[0] ?? 1) - (s[0] ?? 0)) * 180 / Math.PI),
            };
        }
        const child = findFirstGradientFill(item.it);
        if (child) return child;
    }
    return null;
}

function closeModal() {
    removeTextPreview();
    restoreEditLayerVisibility();
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
        updateTextPreview();
        toast(`Font loaded: ${settings.fontName}`, 'success');
    } catch (err) {
        settings.font = null;
        settings.fontName = '';
        getModal().fontName.textContent = 'No font';
        updateModalState();
        updateTextPreview();
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
    settings.gradientFrom = m.gradientFrom.value || settings.color || '#ffffff';
    settings.gradientTo = m.gradientTo.value || '#7c3aed';
    settings.gradientAngle = clampNumber(m.gradientAngle.value, -36000, 36000, 0);
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
    m.gradientFrom.value = settings.gradientFrom || settings.color || '#ffffff';
    m.gradientTo.value = settings.gradientTo || '#7c3aed';
    m.gradientAngle.value = settings.gradientAngle || 0;
    m.fillMode.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === settings.fillType);
    });
    m.align.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === settings.align);
    });
    updateFillControls();
}

function updateModalState() {
    const m = getModal();
    const hasFont = !!settings.font;
    const hasText = !!(settings.text || '').trim();
    updateFillControls();
    m.go.disabled = !state.lottieData || !hasFont || !hasText;
    m.go.lastChild.textContent = selectedOverlayLayer ? ' Update' : ' Add';

    if (!hasFont) {
        m.info.textContent = 'Load a TTF, OTF, or WOFF font';
    } else if (!hasText) {
        m.info.textContent = 'Enter text';
    } else {
        const lines = settings.text.split(/\r?\n/).length;
        const fillLabel = settings.fillType === 'gradient' ? 'gradient' : 'solid';
        m.info.textContent = `${settings.fontName} - ${lines} line${lines === 1 ? '' : 's'} - ${fillLabel} vector shape`;
    }
}

function updateFillControls() {
    const m = getModal();
    const isGradient = settings.fillType === 'gradient';
    m.colorField.classList.toggle('hidden', isGradient);
    m.gradientControls.classList.toggle('hidden', !isGradient);
}

function clampNumber(value, min, max, fallback) {
    const num = parseFloat(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(min, Math.min(max, num));
}

function updateTextPreview() {
    if (!state.lottieData || !settings.font || !(settings.text || '').trim()) {
        removeTextPreview();
        restoreEditLayerVisibility();
        return;
    }

    let shapes;
    try {
        shapes = buildTextShapes(settings);
    } catch (_) {
        removeTextPreview();
        restoreEditLayerVisibility();
        return;
    }

    const svg = ensureTextPreviewSvg();
    const w = state.lottieData.w || 512;
    const h = state.lottieData.h || 512;
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.replaceChildren();

    const ns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(ns, 'defs');
    const group = document.createElementNS(ns, 'g');
    group.setAttribute('transform', `translate(${settings.x} ${settings.y}) rotate(${settings.rotation || 0})`);
    group.setAttribute('opacity', String((settings.opacity ?? 100) / 100));

    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', shapes.map(shape => contourToSvgPath(shape.ks.k)).join(' '));
    if (settings.fillType === 'gradient') {
        const gradientId = 'text-preview-gradient';
        const endpoints = getGradientEndpoints(shapes, settings.gradientAngle);
        const gradient = document.createElementNS(ns, 'linearGradient');
        gradient.setAttribute('id', gradientId);
        gradient.setAttribute('gradientUnits', 'userSpaceOnUse');
        gradient.setAttribute('x1', String(endpoints.s[0]));
        gradient.setAttribute('y1', String(endpoints.s[1]));
        gradient.setAttribute('x2', String(endpoints.e[0]));
        gradient.setAttribute('y2', String(endpoints.e[1]));
        const stopA = document.createElementNS(ns, 'stop');
        stopA.setAttribute('offset', '0%');
        stopA.setAttribute('stop-color', settings.gradientFrom || settings.color || '#ffffff');
        const stopB = document.createElementNS(ns, 'stop');
        stopB.setAttribute('offset', '100%');
        stopB.setAttribute('stop-color', settings.gradientTo || '#7c3aed');
        gradient.appendChild(stopA);
        gradient.appendChild(stopB);
        defs.appendChild(gradient);
        svg.appendChild(defs);
        path.setAttribute('fill', `url(#${gradientId})`);
    } else {
        path.setAttribute('fill', settings.color || '#ffffff');
    }
    path.setAttribute('fill-rule', 'nonzero');
    group.appendChild(path);
    svg.appendChild(group);

    hideEditLayerForPreview();
}

function ensureTextPreviewSvg() {
    if (previewSvg && previewSvg.parentNode === dom.lottiePlayer) return previewSvg;
    const ns = 'http://www.w3.org/2000/svg';
    previewSvg = document.createElementNS(ns, 'svg');
    previewSvg.classList.add('text-preview-overlay');
    previewSvg.setAttribute('xmlns', ns);
    previewSvg.setAttribute('aria-hidden', 'true');
    dom.lottiePlayer.appendChild(previewSvg);
    return previewSvg;
}

function removeTextPreview() {
    if (previewSvg && previewSvg.parentNode) previewSvg.parentNode.removeChild(previewSvg);
    previewSvg = null;
}

function hideEditLayerForPreview() {
    if (!selectedOverlayLayer) return;
    if (!hiddenEditElement) {
        const entry = state.flatLayers.find(e => e.layer === selectedOverlayLayer);
        hiddenEditElement = findRenderedLayerElement(entry);
        hiddenEditVisibility = hiddenEditElement ? hiddenEditElement.style.visibility : '';
    }
    if (hiddenEditElement) hiddenEditElement.style.visibility = 'hidden';
}

function restoreEditLayerVisibility() {
    if (hiddenEditElement) hiddenEditElement.style.visibility = hiddenEditVisibility;
    hiddenEditElement = null;
    hiddenEditVisibility = '';
}

function findRenderedLayerElement(entry) {
    if (!entry || !state.anim || !state.anim.renderer || !state.anim.renderer.elements) return null;
    const { path } = entry;

    if (path[0] !== 'asset') {
        const layerArrayIndex = path[path.length - 1];
        const el = state.anim.renderer.elements[layerArrayIndex];
        return el ? (el.baseElement || el.layerElement || null) : null;
    }

    for (const el of state.anim.renderer.elements) {
        if (el && el.elements) {
            const childIdx = path[path.length - 1];
            const child = el.elements[childIdx];
            if (child) return child.baseElement || child.layerElement || null;
        }
    }
    return null;
}

function contourToSvgPath(contour) {
    const { v, i, o, c } = contour;
    if (!v || v.length === 0) return '';
    let d = `M ${fmt(v[0][0])} ${fmt(v[0][1])}`;
    const segmentCount = c ? v.length : v.length - 1;

    for (let idx = 0; idx < segmentCount; idx++) {
        const next = (idx + 1) % v.length;
        const start = v[idx];
        const end = v[next];
        const out = o[idx] || [0, 0];
        const inn = i[next] || [0, 0];

        if (isZeroHandle(out) && isZeroHandle(inn)) {
            d += ` L ${fmt(end[0])} ${fmt(end[1])}`;
        } else {
            d += ` C ${fmt(start[0] + out[0])} ${fmt(start[1] + out[1])}`;
            d += ` ${fmt(end[0] + inn[0])} ${fmt(end[1] + inn[1])}`;
            d += ` ${fmt(end[0])} ${fmt(end[1])}`;
        }
    }

    if (c) d += ' Z';
    return d;
}

function isZeroHandle(handle) {
    return Math.abs(handle[0]) < 0.001 && Math.abs(handle[1]) < 0.001;
}

function fmt(num) {
    return String(round(num));
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
                createFillItem(opts, shapes),
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
        fillType: opts.fillType,
        color: opts.color,
        gradientFrom: opts.gradientFrom,
        gradientTo: opts.gradientTo,
        gradientAngle: opts.gradientAngle,
        align: opts.align,
    };
}

function createFillItem(opts, shapes) {
    if (opts.fillType === 'gradient') {
        const from = hexToRgb(opts.gradientFrom || opts.color || '#ffffff');
        const to = hexToRgb(opts.gradientTo || '#7c3aed');
        const endpoints = getGradientEndpoints(shapes, opts.gradientAngle);
        return {
            ty: 'gf',
            o: { a: 0, k: 100 },
            r: 1,
            bm: 0,
            g: {
                p: 2,
                k: { a: 0, k: [0, from[0], from[1], from[2], 1, to[0], to[1], to[2]] },
            },
            s: { a: 0, k: endpoints.s },
            e: { a: 0, k: endpoints.e },
            t: 1,
            nm: 'Gradient Fill',
            mn: 'ADBE Vector Graphic - G-Fill',
            hd: false,
        };
    }

    return {
        ty: 'fl',
        c: { a: 0, k: [...hexToRgb(opts.color), 1] },
        o: { a: 0, k: 100 },
        r: 1,
        bm: 0,
        nm: 'Fill',
        mn: 'ADBE Vector Graphic - Fill',
        hd: false,
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

function getGradientEndpoints(shapes, angleDeg = 0) {
    const bounds = getShapesBounds(shapes);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const len = Math.max(1, Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2);
    const rad = (angleDeg || 0) * Math.PI / 180;
    const dx = Math.cos(rad) * len;
    const dy = Math.sin(rad) * len;
    return {
        s: [round(cx - dx), round(cy - dy)],
        e: [round(cx + dx), round(cy + dy)],
    };
}

function getShapesBounds(shapes) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const shape of shapes) {
        const contour = shape && shape.ks && shape.ks.k;
        if (!contour || !Array.isArray(contour.v)) continue;
        for (const [x, y] of contour.v) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
    }
    if (minX === Infinity) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
    return { minX, minY, maxX, maxY };
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
