/* Color extraction, global palette, HSL adjust with per-group sliders */

import { state, dom } from './state.js';
import { rgbToHex, hexToRgb, hexToRgbNorm, rgbToHsl, hslToRgb, saveSnapshot, escHtml } from './utils.js';
import { renderPreview } from './preview.js';

// ─── Color Extraction ───

export function extractColors(layer) {
    const colors = [];

    function walkShapes(shapes, prefix) {
        if (!shapes || !Array.isArray(shapes)) return;
        for (const shape of shapes) {
            if (shape.ty === 'gr' && shape.it) {
                walkShapes(shape.it, prefix + (shape.nm ? shape.nm + ' > ' : ''));
            }
            if (shape.ty === 'fl' && shape.c) {
                const c = getColorValue(shape.c);
                if (c) colors.push({ label: prefix + (shape.nm || 'Fill'), color: c, setter: (rgb) => setColorValue(shape.c, rgb) });
            }
            if (shape.ty === 'st' && shape.c) {
                const c = getColorValue(shape.c);
                if (c) colors.push({ label: prefix + (shape.nm || 'Stroke'), color: c, setter: (rgb) => setColorValue(shape.c, rgb) });
            }
            if ((shape.ty === 'gf' || shape.ty === 'gs') && shape.g && shape.g.k) {
                const gType = shape.ty === 'gf' ? 'GFill' : 'GStroke';
                extractGradientStops(shape.g.k, shape.g.p || 0, prefix + (shape.nm || gType), colors);
            }
        }
    }

    if (layer.shapes) walkShapes(layer.shapes, '');

    if (layer.ty === 1 && layer.sc) {
        const rgb = hexToRgbNorm(layer.sc);
        if (rgb) colors.push({ label: 'Solid Color', color: rgb, setter: (rgbVal) => { layer.sc = rgbToHex(rgbVal[0], rgbVal[1], rgbVal[2]); } });
    }

    if (layer.ef && Array.isArray(layer.ef)) walkEffects(layer.ef, '', colors);

    return colors;
}

function extractGradientStops(gk, numStops, labelPrefix, colors) {
    let data;
    if (gk.a === 1 && Array.isArray(gk.k) && gk.k.length > 0) {
        data = gk.k[0].s || gk.k[0].e || gk.k;
    } else {
        data = gk.k;
    }
    if (!Array.isArray(data)) return;
    const stopCount = numStops || Math.floor(data.length / 4);
    for (let i = 0; i < stopCount; i++) {
        const base = i * 4;
        if (base + 3 >= data.length) break;
        const stopIdx = i;
        colors.push({
            label: labelPrefix + ' #' + (i + 1),
            color: [data[base + 1], data[base + 2], data[base + 3]],
            setter: ((idx) => (rgb) => {
                let arr;
                if (gk.a === 1 && Array.isArray(gk.k) && gk.k.length > 0) arr = gk.k[0].s || gk.k[0].e || gk.k;
                else arr = gk.k;
                const b = idx * 4;
                arr[b + 1] = rgb[0]; arr[b + 2] = rgb[1]; arr[b + 3] = rgb[2];
            })(stopIdx),
        });
    }
}

function walkEffects(effects, prefix, colors) {
    for (const ef of effects) {
        const efName = prefix + (ef.nm || 'Effect') + ' > ';
        if (ef.v && ef.v.k) {
            const val = getColorValue(ef.v);
            if (val) colors.push({ label: efName + 'Color', color: val, setter: (rgb) => setColorValue(ef.v, rgb) });
        }
        if (ef.ef && Array.isArray(ef.ef)) walkEffects(ef.ef, efName, colors);
    }
}

function getColorValue(cProp) {
    if (!cProp) return null;
    let k;
    if (cProp.a === 1 && Array.isArray(cProp.k) && cProp.k.length > 0) {
        k = cProp.k[0].s || cProp.k[0].e;
    } else {
        k = cProp.k;
    }
    if (!Array.isArray(k) || k.length < 3) return null;
    return [k[0], k[1], k[2]];
}

function setColorValue(cProp, rgb) {
    if (!cProp) return;
    if (cProp.a === 1 && Array.isArray(cProp.k) && cProp.k.length > 0) {
        for (const k of cProp.k) {
            if (k.s) { k.s[0] = rgb[0]; k.s[1] = rgb[1]; k.s[2] = rgb[2]; }
            if (k.e) { k.e[0] = rgb[0]; k.e[1] = rgb[1]; k.e[2] = rgb[2]; }
        }
    } else if (Array.isArray(cProp.k)) {
        cProp.k[0] = rgb[0]; cProp.k[1] = rgb[1]; cProp.k[2] = rgb[2];
    }
}

// ─── Global Color Palette ───

export function renderGlobalColorPalette() {
    const allColors = [];
    state.flatLayers.forEach((entry, idx) => {
        extractColors(entry.layer).forEach(c => {
            allColors.push({ ...c, layerName: entry.layer.nm || `Layer ${idx}`, layerIndex: idx });
        });
    });

    if (allColors.length === 0) {
        dom.inspectorContent.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="2" opacity=".2"/>
                    <path d="M24 16v8M24 28v2" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".3"/>
                </svg>
                <p>No editable colors<br>found in layers</p>
            </div>`;
        return;
    }

    const colorGroups = new Map();
    allColors.forEach(c => {
        const hex = rgbToHex(c.color[0], c.color[1], c.color[2]);
        if (!colorGroups.has(hex)) colorGroups.set(hex, { hex, entries: [] });
        colorGroups.get(hex).entries.push(c);
    });

    const uniqueColors = Array.from(colorGroups.values());
    let html = `<div class="inspector-section"><div class="inspector-section-title">🎨 Colors — ${uniqueColors.length} unique / ${allColors.length} total</div>`;

    uniqueColors.forEach((group, gi) => {
        const layerNames = [...new Set(group.entries.map(e => e.layerName))];
        const tooltipText = escHtml(layerNames.slice(0, 5).join(', ') + (layerNames.length > 5 ? ` +${layerNames.length - 5} more` : ''));
        html += `
            <div class="color-row" title="${tooltipText}">
                <div class="color-swatch-wrapper">
                    <div class="color-swatch" style="background:${group.hex}"></div>
                    <input type="color" class="color-swatch-input" data-group-idx="${gi}" value="${group.hex}">
                </div>
                <span class="color-hex">${group.hex}</span>
                <span class="color-count">${group.entries.length}×</span>
            </div>`;
    });
    html += '</div>';
    dom.inspectorContent.innerHTML = html;

    dom.inspectorContent.querySelectorAll('.color-swatch-input').forEach(inp => {
        let snapshotSaved = false;
        inp.addEventListener('input', (e) => {
            if (!snapshotSaved) { saveSnapshot(); snapshotSaved = true; }
            const gi = parseInt(e.target.dataset.groupIdx);
            const group = uniqueColors[gi];
            if (!group) return;
            const rgb = hexToRgb(e.target.value);
            group.entries.forEach(entry => entry.setter(rgb));
            const swatch = e.target.previousElementSibling;
            if (swatch) swatch.style.background = e.target.value;
            const hexLabel = e.target.closest('.color-row').querySelector('.color-hex');
            if (hexLabel) hexLabel.textContent = e.target.value;
            group.hex = e.target.value;
            renderPreview();
        });
        inp.addEventListener('change', () => { snapshotSaved = false; });
    });
}

// ─── HSL Adjust ───

const HUE_GROUPS = [
    { key: 'reds',    label: '🔴 Reds',    from: 345, to: 15 },
    { key: 'oranges', label: '🟠 Oranges', from: 15,  to: 45 },
    { key: 'yellows', label: '🟡 Yellows', from: 45,  to: 75 },
    { key: 'greens',  label: '🟢 Greens',  from: 75,  to: 165 },
    { key: 'cyans',   label: '🩵 Cyans',   from: 165, to: 195 },
    { key: 'blues',   label: '🔵 Blues',    from: 195, to: 255 },
    { key: 'purples', label: '🟣 Purples', from: 255, to: 345 },
];
const NEUTRAL_KEY = 'neutrals';

function getHueGroup(r, g, b) {
    const [h, s] = rgbToHsl(r, g, b);
    if (s < 0.08) return NEUTRAL_KEY;
    const deg = h * 360;
    for (const grp of HUE_GROUPS) {
        if (grp.from > grp.to) {
            if (deg >= grp.from || deg < grp.to) return grp.key;
        } else {
            if (deg >= grp.from && deg < grp.to) return grp.key;
        }
    }
    return NEUTRAL_KEY;
}

export function captureOriginalColors() {
    state.originalColors = [];
    state.flatLayers.forEach(entry => {
        extractColors(entry.layer).forEach(c => {
            state.originalColors.push({
                color: [c.color[0], c.color[1], c.color[2]],
                setter: c.setter,
                group: getHueGroup(c.color[0], c.color[1], c.color[2]),
            });
        });
    });
}

function applyAllAdjustments() {
    if (!state.originalColors) return;
    const { hue: gH, sat: gS, light: gL } = state.savedAdjust;
    state.originalColors.forEach(oc => {
        const ga = state.savedGroupAdjust[oc.group] || { hue: 0, sat: 0, light: 0 };
        const totalH = gH + ga.hue, totalS = gS + ga.sat, totalL = gL + ga.light;
        const [h, s, l] = rgbToHsl(oc.color[0], oc.color[1], oc.color[2]);
        let newH = (h + totalH / 360) % 1; if (newH < 0) newH += 1;
        let newS = Math.max(0, Math.min(1, s + totalS / 100));
        let newL = Math.max(0, Math.min(1, l + totalL / 100));
        oc.setter(hslToRgb(newH, newS, newL));
    });
}

export function renderAdjustPanel() {
    if (!state.lottieData || state.flatLayers.length === 0) {
        dom.inspectorContent.innerHTML = `<div class="empty-state"><p>Import .json or .tgs first</p></div>`;
        return;
    }

    if (!state.originalColors) captureOriginalColors();

    const groupCounts = {};
    state.originalColors.forEach(oc => { groupCounts[oc.group] = (groupCounts[oc.group] || 0) + 1; });

    const activeGroups = HUE_GROUPS.filter(g => groupCounts[g.key]);
    if (groupCounts[NEUTRAL_KEY]) activeGroups.push({ key: NEUTRAL_KEY, label: '⚪ Neutrals' });

    let html = `
        <div class="inspector-section">
            <div class="inspector-section-title">🌈 Global</div>
            <div class="adjust-section">
                <div class="adjust-row"><span class="adjust-label">H</span>
                    <input type="range" class="adjust-slider" id="adj-hue" min="-180" max="180" value="${state.savedAdjust.hue}" step="1">
                    <span class="adjust-value" id="adj-hue-val">${state.savedAdjust.hue}°</span></div>
                <div class="adjust-row"><span class="adjust-label">S</span>
                    <input type="range" class="adjust-slider" id="adj-sat" min="-100" max="100" value="${state.savedAdjust.sat}" step="1">
                    <span class="adjust-value" id="adj-sat-val">${state.savedAdjust.sat}%</span></div>
                <div class="adjust-row"><span class="adjust-label">L</span>
                    <input type="range" class="adjust-slider" id="adj-light" min="-100" max="100" value="${state.savedAdjust.light}" step="1">
                    <span class="adjust-value" id="adj-light-val">${state.savedAdjust.light}%</span></div>
                <button class="adjust-reset-btn" id="adj-reset">Reset All</button>
            </div>
        </div>`;

    activeGroups.forEach(grp => {
        const ga = state.savedGroupAdjust[grp.key] || { hue: 0, sat: 0, light: 0 };
        html += `
        <div class="inspector-section">
            <div class="inspector-section-title">${grp.label} <span class="color-count" style="margin-left:4px">${groupCounts[grp.key] || 0}×</span></div>
            <div class="adjust-section">
                <div class="adjust-row"><span class="adjust-label">H</span>
                    <input type="range" class="adjust-slider group-slider" data-group="${grp.key}" data-axis="hue" min="-180" max="180" value="${ga.hue}" step="1">
                    <span class="adjust-value">${ga.hue}°</span></div>
                <div class="adjust-row"><span class="adjust-label">S</span>
                    <input type="range" class="adjust-slider group-slider" data-group="${grp.key}" data-axis="sat" min="-100" max="100" value="${ga.sat}" step="1">
                    <span class="adjust-value">${ga.sat}%</span></div>
                <div class="adjust-row"><span class="adjust-label">L</span>
                    <input type="range" class="adjust-slider group-slider" data-group="${grp.key}" data-axis="light" min="-100" max="100" value="${ga.light}" step="1">
                    <span class="adjust-value">${ga.light}%</span></div>
            </div>
        </div>`;
    });

    dom.inspectorContent.innerHTML = html;

    // Bind global
    const hS = document.getElementById('adj-hue'), sS = document.getElementById('adj-sat'), lS = document.getElementById('adj-light');
    const hV = document.getElementById('adj-hue-val'), sV = document.getElementById('adj-sat-val'), lV = document.getElementById('adj-light-val');
    let snapshotSaved = false;

    function doAdjust() {
        if (!snapshotSaved) { saveSnapshot(); snapshotSaved = true; }
        state.savedAdjust.hue = parseInt(hS.value);
        state.savedAdjust.sat = parseInt(sS.value);
        state.savedAdjust.light = parseInt(lS.value);
        hV.textContent = state.savedAdjust.hue + '°';
        sV.textContent = state.savedAdjust.sat + '%';
        lV.textContent = state.savedAdjust.light + '%';
        applyAllAdjustments();
        renderPreview();
    }

    hS.addEventListener('input', doAdjust);
    sS.addEventListener('input', doAdjust);
    lS.addEventListener('input', doAdjust);

    document.getElementById('adj-reset').addEventListener('click', () => {
        hS.value = 0; sS.value = 0; lS.value = 0;
        state.savedAdjust = { hue: 0, sat: 0, light: 0 };
        state.savedGroupAdjust = {};
        snapshotSaved = false;
        captureOriginalColors();
        dom.inspectorContent.querySelectorAll('.group-slider').forEach(sl => {
            sl.value = 0;
            const valSpan = sl.nextElementSibling;
            if (valSpan) valSpan.textContent = sl.dataset.axis === 'hue' ? '0°' : '0%';
        });
        doAdjust();
    });

    // Bind per-group
    dom.inspectorContent.querySelectorAll('.group-slider').forEach(sl => {
        sl.addEventListener('input', () => {
            if (!snapshotSaved) { saveSnapshot(); snapshotSaved = true; }
            const grpKey = sl.dataset.group, axis = sl.dataset.axis;
            if (!state.savedGroupAdjust[grpKey]) state.savedGroupAdjust[grpKey] = { hue: 0, sat: 0, light: 0 };
            state.savedGroupAdjust[grpKey][axis] = parseInt(sl.value);
            const valSpan = sl.nextElementSibling;
            if (valSpan) valSpan.textContent = sl.value + (axis === 'hue' ? '°' : '%');
            applyAllAdjustments();
            renderPreview();
        });
    });
}
