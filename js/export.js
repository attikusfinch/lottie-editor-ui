/* Export functionality: JSON, TGS, SVG, PNG */

import { state, dom } from './state.js';
import { toast, downloadBlob } from './utils.js';
import { getJsonByteLength, optimizeLottieData } from './optimizer.js';

export function initExport() {
    dom.btnExport.addEventListener('click', (e) => {
        if (!state.lottieData) return;
        e.stopPropagation();
        dom.exportDropdown.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        if (!dom.exportDropdown.contains(e.target)) {
            dom.exportDropdown.classList.remove('open');
        }
    });

    function getBaseName() {
        return (dom.fileNameLabel.textContent || 'animation').replace(/\.json$|\.tgs$/i, '');
    }

    function sizeLabel(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
    }

    function makeOptimizedJson() {
        const rawJson = JSON.stringify(state.lottieData);
        const optimizedJson = JSON.stringify(optimizeLottieData(state.lottieData));
        return { rawJson, optimizedJson };
    }

    function toastOptimized(kind, rawSize, optimizedSize) {
        const saved = rawSize > 0 ? Math.max(0, 1 - optimizedSize / rawSize) : 0;
        toast(`Exported optimized ${kind}: ${sizeLabel(optimizedSize)} (${Math.round(saved * 100)}% smaller)`, 'success');
    }

    // ── JSON ──
    document.getElementById('export-json').addEventListener('click', () => {
        if (!state.lottieData) return;
        dom.exportDropdown.classList.remove('open');
        const json = JSON.stringify(state.lottieData, null, 2);
        downloadBlob(new Blob([json], { type: 'application/json' }), getBaseName() + '_edited.json');
        toast('Exported raw JSON', 'success');
    });

    document.getElementById('export-json-optimized').addEventListener('click', () => {
        if (!state.lottieData) return;
        dom.exportDropdown.classList.remove('open');
        try {
            const { rawJson, optimizedJson } = makeOptimizedJson();
            downloadBlob(new Blob([optimizedJson], { type: 'application/json' }), getBaseName() + '_optimized.json');
            toastOptimized('JSON', getJsonByteLength(rawJson), getJsonByteLength(optimizedJson));
        } catch (err) {
            toast('Optimized JSON export failed: ' + err.message, 'error');
        }
    });

    // ── TGS ──
    document.getElementById('export-tgs').addEventListener('click', () => {
        if (!state.lottieData) return;
        dom.exportDropdown.classList.remove('open');
        try {
            const json = JSON.stringify(state.lottieData);
            const compressed = pako.gzip(json);
            downloadBlob(new Blob([compressed], { type: 'application/gzip' }), getBaseName() + '.tgs');
            toast('Exported raw TGS', 'success');
        } catch (err) {
            toast('TGS export failed: ' + err.message, 'error');
        }
    });

    document.getElementById('export-tgs-optimized').addEventListener('click', () => {
        if (!state.lottieData) return;
        dom.exportDropdown.classList.remove('open');
        try {
            const { rawJson, optimizedJson } = makeOptimizedJson();
            const rawCompressed = pako.gzip(rawJson);
            const compressed = pako.gzip(optimizedJson);
            downloadBlob(new Blob([compressed], { type: 'application/gzip' }), getBaseName() + '_optimized.tgs');
            toastOptimized('TGS', rawCompressed.length, compressed.length);
        } catch (err) {
            toast('Optimized TGS export failed: ' + err.message, 'error');
        }
    });

    // ── SVG ──
    document.getElementById('export-svg').addEventListener('click', () => {
        if (!state.lottieData || !state.anim) return;
        dom.exportDropdown.classList.remove('open');
        try {
            const wasPlaying = state.isPlaying;
            if (wasPlaying) state.anim.pause();

            const svgEl = dom.lottiePlayer.querySelector('svg');
            if (!svgEl) { toast('No SVG found in player', 'error'); return; }

            const clone = svgEl.cloneNode(true);
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
            const w = state.lottieData.w || 512, h = state.lottieData.h || 512;
            clone.setAttribute('width', w);
            clone.setAttribute('height', h);
            clone.setAttribute('viewBox', `0 0 ${w} ${h}`);

            const svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + clone.outerHTML;
            const frameNum = Math.floor(state.anim.currentFrame);
            downloadBlob(new Blob([svgString], { type: 'image/svg+xml' }), getBaseName() + `_frame${frameNum}.svg`);
            toast(`Exported SVG (frame ${frameNum})`, 'success');
            if (wasPlaying) state.anim.play();
        } catch (err) {
            toast('SVG export failed: ' + err.message, 'error');
        }
    });

    // ── PNG ──
    document.getElementById('export-png').addEventListener('click', () => {
        if (!state.lottieData || !state.anim) return;
        dom.exportDropdown.classList.remove('open');
        try {
            const wasPlaying = state.isPlaying;
            if (wasPlaying) state.anim.pause();

            const svgEl = dom.lottiePlayer.querySelector('svg');
            if (!svgEl) { toast('No SVG found in player', 'error'); return; }

            const w = state.lottieData.w || 512, h = state.lottieData.h || 512;
            const clone = svgEl.cloneNode(true);
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
            clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
            clone.setAttribute('width', w);
            clone.setAttribute('height', h);
            clone.setAttribute('viewBox', `0 0 ${w} ${h}`);

            const svgString = new XMLSerializer().serializeToString(clone);
            const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
            const svgUrl = URL.createObjectURL(svgBlob);

            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = 2;
                canvas.width = w * scale;
                canvas.height = h * scale;
                const ctx = canvas.getContext('2d');
                ctx.scale(scale, scale);
                ctx.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(svgUrl);

                canvas.toBlob((blob) => {
                    const frameNum = Math.floor(state.anim.currentFrame);
                    downloadBlob(blob, getBaseName() + `_frame${frameNum}.png`);
                    toast(`Exported PNG (frame ${frameNum}, ${w * scale}×${h * scale})`, 'success');
                    if (wasPlaying) state.anim.play();
                }, 'image/png');
            };
            img.onerror = () => {
                URL.revokeObjectURL(svgUrl);
                toast('PNG export failed: could not render SVG', 'error');
                if (wasPlaying) state.anim.play();
            };
            img.src = svgUrl;
        } catch (err) {
            toast('PNG export failed: ' + err.message, 'error');
        }
    });
}
