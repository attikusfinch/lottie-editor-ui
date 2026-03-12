/* Export functionality: JSON, TGS, SVG, PNG */

import { state, dom } from './state.js';
import { toast, downloadBlob } from './utils.js';

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
        return (dom.fileNameLabel.textContent || 'animation').replace(/\.json$/i, '');
    }

    // ── JSON ──
    document.getElementById('export-json').addEventListener('click', () => {
        if (!state.lottieData) return;
        dom.exportDropdown.classList.remove('open');
        const json = JSON.stringify(state.lottieData, null, 2);
        downloadBlob(new Blob([json], { type: 'application/json' }), getBaseName() + '_edited.json');
        toast('Exported JSON', 'success');
    });

    // ── TGS ──
    document.getElementById('export-tgs').addEventListener('click', () => {
        if (!state.lottieData) return;
        dom.exportDropdown.classList.remove('open');
        try {
            const json = JSON.stringify(state.lottieData);
            const compressed = pako.gzip(json);
            downloadBlob(new Blob([compressed], { type: 'application/gzip' }), getBaseName() + '.tgs');
            toast('Exported TGS', 'success');
        } catch (err) {
            toast('TGS export failed: ' + err.message, 'error');
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
