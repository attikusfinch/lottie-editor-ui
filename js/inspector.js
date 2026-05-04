/* Inspector panel — layer properties and tab management */

import { state, dom, TYPE_NAMES } from './state.js';
import {
    escHtml, rgbToHex, hexToRgb, saveSnapshot, toast,
    getStaticOrFirstKeyframe, setStaticOrFirstKeyframe,
    getStaticOrFirstKeyframeScalar, setStaticOrFirstKeyframeScalar,
} from './utils.js';
import { renderPreview, renderPreviewSilent } from './preview.js';
import { buildLayersList, updateSelectionBox } from './layers.js';
import { renderGlobalColorPalette, renderAdjustPanel, extractColors } from './colors.js';

// ─── Tab Switching ───
export function initTabs() {
    document.querySelectorAll('.inspector-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            state.currentTab = tab.dataset.tab;
            document.querySelectorAll('.inspector-tab').forEach(t => t.classList.toggle('active', t === tab));
            renderActiveTab();
        });
    });
}

export function renderActiveTab() {
    if (!state.lottieData) {
        dom.inspectorContent.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="2" opacity=".2"/>
                    <path d="M24 16v8M24 28v2" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".3"/>
                </svg>
                <p>Import .json or .tgs<br>to begin</p>
            </div>`;
        return;
    }

    switch (state.currentTab) {
        case 'colors':
            state.selectedLayerIndices.clear();
            dom.layersList.querySelectorAll('.layer-item').forEach(el => el.classList.remove('selected'));
            updateSelectionBox();
            renderGlobalColorPalette();
            break;
        case 'adjust':
            renderAdjustPanel();
            break;
        case 'inspector':
            renderInspector();
            break;
    }
}

// ─── Inspector Panel ───
export function renderInspector() {
    if (state.currentTab !== 'inspector') { renderActiveTab(); return; }

    if (state.selectedLayerIndices.size === 0) {
        dom.inspectorContent.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <circle cx="24" cy="24" r="18" stroke="currentColor" stroke-width="2" opacity=".2"/>
                    <path d="M24 16v8M24 28v2" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" opacity=".3"/>
                </svg>
                <p>Select a layer<br>to inspect</p>
            </div>`;
        return;
    }

    if (state.selectedLayerIndices.size > 1) {
        dom.inspectorContent.innerHTML = `
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                    <rect x="6" y="10" width="36" height="28" rx="4" stroke="currentColor" stroke-width="2" opacity=".3"/>
                    <path d="M6 18h36M16 10v28" stroke="currentColor" stroke-width="2" opacity=".2"/>
                </svg>
                <p>${state.selectedLayerIndices.size} layers selected<br>Drag to move all · Click ✕ to delete all</p>
            </div>`;
        return;
    }

    const firstIdx = [...state.selectedLayerIndices][0];
    const { layer } = state.flatLayers[firstIdx];
    const ks = layer.ks;
    let html = '';

    // Layer Info
    html += `
        <div class="inspector-section">
            <div class="inspector-section-title">Layer Info</div>
            <div class="inspector-row"><span class="inspector-label" style="min-width:auto;flex:1">Name</span></div>
            <input type="text" class="inspector-input" id="inp-name" value="${escHtml(layer.nm || '')}" style="margin-bottom:8px">
            <div class="inspector-row">
                <span class="inspector-label" style="min-width:50px">Type</span>
                <span style="font-size:12px;color:var(--text-secondary)">${TYPE_NAMES[layer.ty] || 'Unknown'} (${layer.ty})</span>
            </div>
        </div>`;

    // Timing (ip / op)
    const globalIp = state.lottieData.ip ?? 0;
    const globalOp = state.lottieData.op ?? 60;
    const layerIp = layer.ip ?? 0;
    const layerOp = layer.op ?? 60;
    const isFullRange = (layerIp <= globalIp && layerOp >= globalOp);
    html += `
        <div class="inspector-section">
            <div class="inspector-section-title">Timing</div>
            <div class="inspector-row">
                <span class="inspector-label" style="min-width:30px">In</span>
                <input type="number" class="inspector-input" id="inp-ip" value="${layerIp}" min="0" step="1">
            </div>
            <div class="inspector-row">
                <span class="inspector-label" style="min-width:30px">Out</span>
                <input type="number" class="inspector-input" id="inp-op" value="${layerOp}" min="0" step="1">
            </div>
            <button class="layer-extend-btn" id="btn-extend-full" ${isFullRange ? 'disabled' : ''} title="Extend layer to match animation range (${globalIp}–${globalOp})">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7h10M2 7l2-2M2 7l2 2M12 7l-2-2M12 7l-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                ${isFullRange ? '✓ Full Range' : `Extend to Full (${globalIp}–${globalOp})`}
            </button>
        </div>`;

    // Drag hint
    if (ks && ks.p) {
        html += `<div class="inspector-section" style="margin-bottom:8px">
            <div style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--bg-elevated);border-radius:var(--radius-sm)">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12M7 1l-2 2M7 1l2 2M7 13l-2-2M7 13l2-2M1 7l2-2M1 7l2 2M13 7l-2-2M13 7l-2 2" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>
                Drag on canvas to move
            </div></div>`;
    }

    // Position
    if (ks && ks.p) {
        const pos = getStaticOrFirstKeyframe(ks.p);
        html += `<div class="inspector-section"><div class="inspector-section-title">Position</div>
            <div class="inspector-row"><span class="inspector-label">X</span><input type="number" class="inspector-input" id="inp-pos-x" value="${pos[0]??0}" step="1"></div>
            <div class="inspector-row"><span class="inspector-label">Y</span><input type="number" class="inspector-input" id="inp-pos-y" value="${pos[1]??0}" step="1"></div></div>`;
    }

    // Anchor
    if (ks && ks.a) {
        const a = getStaticOrFirstKeyframe(ks.a);
        html += `<div class="inspector-section"><div class="inspector-section-title">Anchor Point</div>
            <div class="inspector-row"><span class="inspector-label">X</span><input type="number" class="inspector-input" id="inp-anchor-x" value="${a[0]??0}" step="1"></div>
            <div class="inspector-row"><span class="inspector-label">Y</span><input type="number" class="inspector-input" id="inp-anchor-y" value="${a[1]??0}" step="1"></div></div>`;
    }

    // Scale
    if (ks && ks.s) {
        const s = getStaticOrFirstKeyframe(ks.s);
        html += `<div class="inspector-section"><div class="inspector-section-title">Scale (%)</div>
            <div class="inspector-row"><span class="inspector-label">X</span><input type="number" class="inspector-input" id="inp-scale-x" value="${s[0]??100}" step="1"></div>
            <div class="inspector-row"><span class="inspector-label">Y</span><input type="number" class="inspector-input" id="inp-scale-y" value="${s[1]??100}" step="1"></div></div>`;
    }

    // Opacity
    if (ks && ks.o) {
        const o = getStaticOrFirstKeyframeScalar(ks.o);
        html += `<div class="inspector-section"><div class="inspector-section-title">Opacity</div>
            <div class="inspector-row"><span class="inspector-label">%</span><input type="number" class="inspector-input" id="inp-opacity" value="${o??100}" min="0" max="100" step="1"></div></div>`;
    }

    // Colors
    const colors = extractColors(layer);
    if (colors.length > 0) {
        html += `<div class="inspector-section"><div class="inspector-section-title">Colors</div>`;
        colors.forEach((c, ci) => {
            const hex = rgbToHex(c.color[0], c.color[1], c.color[2]);
            html += `<div class="color-row"><div class="color-swatch-wrapper"><div class="color-swatch" style="background:${hex}"></div>
                <input type="color" class="color-swatch-input" data-color-index="${ci}" value="${hex}"></div>
                <span class="color-label">${c.label}</span><span class="color-hex">${hex}</span></div>`;
        });
        html += `</div>`;
    }

    dom.inspectorContent.innerHTML = html;

    // ─── Bind Events ───
    const inpName = document.getElementById('inp-name');
    if (inpName) inpName.addEventListener('change', () => { saveSnapshot(); layer.nm = inpName.value; buildLayersList(); });

    // Timing (ip / op)
    const inpIp = document.getElementById('inp-ip');
    const inpOp = document.getElementById('inp-op');
    if (inpIp && inpOp) {
        const handleTiming = () => {
            saveSnapshot();
            layer.ip = parseInt(inpIp.value) || 0;
            layer.op = parseInt(inpOp.value) || 60;
            renderPreview();
            buildLayersList();
        };
        inpIp.addEventListener('change', handleTiming);
        inpOp.addEventListener('change', handleTiming);
    }
    const btnExtend = document.getElementById('btn-extend-full');
    if (btnExtend) {
        btnExtend.addEventListener('click', () => {
            saveSnapshot();
            layer.ip = state.lottieData.ip ?? 0;
            layer.op = state.lottieData.op ?? 60;
            renderPreview();
            buildLayersList();
            renderInspector();
            toast(`Layer extended to ${layer.ip}–${layer.op}`, 'success');
        });
    }

    if (ks && ks.p) {
        const x = document.getElementById('inp-pos-x'), y = document.getElementById('inp-pos-y');
        if (x && y) { const h = () => { saveSnapshot(); setStaticOrFirstKeyframe(ks.p, [parseFloat(x.value)||0, parseFloat(y.value)||0]); renderPreview(); }; x.addEventListener('change', h); y.addEventListener('change', h); }
    }
    if (ks && ks.a) {
        const x = document.getElementById('inp-anchor-x'), y = document.getElementById('inp-anchor-y');
        if (x && y) { const h = () => { saveSnapshot(); setStaticOrFirstKeyframe(ks.a, [parseFloat(x.value)||0, parseFloat(y.value)||0]); renderPreview(); }; x.addEventListener('change', h); y.addEventListener('change', h); }
    }
    if (ks && ks.s) {
        const x = document.getElementById('inp-scale-x'), y = document.getElementById('inp-scale-y');
        if (x && y) { const h = () => { saveSnapshot(); setStaticOrFirstKeyframe(ks.s, [parseFloat(x.value)||100, parseFloat(y.value)||100]); renderPreview(); }; x.addEventListener('change', h); y.addEventListener('change', h); }
    }
    if (ks && ks.o) {
        const inp = document.getElementById('inp-opacity');
        if (inp) inp.addEventListener('change', () => { saveSnapshot(); setStaticOrFirstKeyframeScalar(ks.o, parseFloat(inp.value)||100); renderPreview(); });
    }

    dom.inspectorContent.querySelectorAll('.color-swatch-input').forEach(inp => {
        let saved = false;
        inp.addEventListener('input', (e) => {
            if (!saved) { saveSnapshot(); saved = true; }
            const c = colors[parseInt(e.target.dataset.colorIndex)];
            if (!c) return;
            c.setter(hexToRgb(e.target.value));
            const sw = e.target.previousElementSibling; if (sw) sw.style.background = e.target.value;
            const hl = e.target.closest('.color-row').querySelector('.color-hex'); if (hl) hl.textContent = e.target.value;
            renderPreviewSilent({ stopPlayback: true });
        });
        inp.addEventListener('change', () => { saved = false; });
    });
}
