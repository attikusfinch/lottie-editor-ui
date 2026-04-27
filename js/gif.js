/* GIF export — modal UI + offscreen lottie canvas → gif.js encoder */

import { state, dom } from './state.js';
import { toast, downloadBlob } from './utils.js';

const WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js';

const settings = {
    background: 'transparent',
    quality: 10,
    scale: 1,
    fps: 30,
};

let modalDom = null;
let cancelRequested = false;
let busy = false;

function getModal() {
    if (modalDom) return modalDom;
    modalDom = {
        overlay   : document.getElementById('gif-modal'),
        close     : document.getElementById('gif-modal-close'),
        cancel    : document.getElementById('gif-modal-cancel'),
        go        : document.getElementById('gif-modal-go'),
        swatches  : document.getElementById('gif-bg-swatches'),
        custom    : document.getElementById('gif-bg-custom'),
        info      : document.getElementById('gif-info'),
        progressRow : document.getElementById('gif-progress-row'),
        progressFill: document.getElementById('gif-progress-fill'),
        progressText: document.getElementById('gif-progress-text'),
        segControls : document.querySelectorAll('#gif-modal .seg-control'),
    };
    return modalDom;
}

export function initGifExport() {
    const m = getModal();

    document.getElementById('export-gif').addEventListener('click', () => {
        if (!state.lottieData) return;
        dom.exportDropdown.classList.remove('open');
        openModal();
    });

    m.close.addEventListener('click', closeModal);
    m.cancel.addEventListener('click', () => {
        if (busy) { cancelRequested = true; return; }
        closeModal();
    });
    m.overlay.addEventListener('click', (e) => {
        if (e.target === m.overlay && !busy) closeModal();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !m.overlay.classList.contains('hidden') && !busy) closeModal();
    });

    // Background swatches
    m.swatches.addEventListener('click', (e) => {
        const btn = e.target.closest('.bg-swatch');
        if (!btn) return;
        if (btn.classList.contains('bg-swatch-custom')) return; // handled by input
        m.swatches.querySelectorAll('.bg-swatch').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        settings.background = btn.dataset.bg;
        updateInfo();
    });
    m.custom.addEventListener('input', (e) => {
        m.swatches.querySelectorAll('.bg-swatch').forEach(b => b.classList.remove('active'));
        m.custom.parentElement.classList.add('active');
        settings.background = e.target.value;
        updateInfo();
    });

    // Segmented controls
    m.segControls.forEach(seg => {
        seg.addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-value]');
            if (!btn) return;
            seg.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const name = seg.dataset.name;
            const val = parseFloat(btn.dataset.value);
            settings[name] = val;
            updateInfo();
        });
    });

    // Convert
    m.go.addEventListener('click', startEncoding);
}

function openModal() {
    const m = getModal();
    m.overlay.classList.remove('hidden');
    m.progressRow.classList.add('hidden');
    m.go.disabled = false;
    m.cancel.textContent = 'Cancel';
    busy = false;
    cancelRequested = false;
    updateInfo();
}

function closeModal() {
    const m = getModal();
    m.overlay.classList.add('hidden');
}

function updateInfo() {
    const m = getModal();
    if (!state.lottieData) { m.info.textContent = '—'; return; }
    const ip = state.lottieData.ip ?? 0;
    const op = state.lottieData.op ?? 60;
    const fr = state.lottieData.fr ?? 30;
    const totalSrc = Math.max(1, op - ip);
    const seconds = totalSrc / fr;
    const w = Math.round((state.lottieData.w || 512) * settings.scale);
    const h = Math.round((state.lottieData.h || 512) * settings.scale);
    const outFps = Math.min(settings.fps, fr);
    const outFrames = Math.max(1, Math.round(seconds * outFps));
    m.info.textContent = `${w} × ${h}  ·  ${outFrames} frames @ ${outFps}fps  ·  ${seconds.toFixed(2)}s`;
}

function setProgress(p, text) {
    const m = getModal();
    m.progressFill.style.width = (Math.max(0, Math.min(1, p)) * 100).toFixed(1) + '%';
    if (text) m.progressText.textContent = text;
}

async function startEncoding() {
    if (busy) return;
    if (!state.lottieData) { toast('No animation loaded', 'error'); return; }
    if (typeof window.GIF !== 'function') {
        toast('gif.js failed to load. Check your connection.', 'error');
        return;
    }

    const m = getModal();
    busy = true;
    cancelRequested = false;
    m.progressRow.classList.remove('hidden');
    m.go.disabled = true;
    m.cancel.textContent = 'Stop';
    setProgress(0, 'Preparing…');

    const ip = state.lottieData.ip ?? 0;
    const op = state.lottieData.op ?? 60;
    const sourceFr = state.lottieData.fr ?? 30;
    const totalSrc = Math.max(1, op - ip);
    const seconds = totalSrc / sourceFr;
    const targetFps = Math.min(settings.fps, sourceFr);
    const outFrames = Math.max(1, Math.round(seconds * targetFps));
    const w = Math.max(1, Math.round((state.lottieData.w || 512) * settings.scale));
    const h = Math.max(1, Math.round((state.lottieData.h || 512) * settings.scale));
    const delay = Math.round(1000 / targetFps);

    // ── Build offscreen canvas-renderer animation ──
    const offscreenContainer = document.createElement('div');
    offscreenContainer.style.cssText = `position:fixed; left:-99999px; top:-99999px; width:${w}px; height:${h}px; pointer-events:none; opacity:0;`;
    document.body.appendChild(offscreenContainer);

    const animDataClone = JSON.parse(JSON.stringify(state.lottieData));
    let offAnim;
    try {
        offAnim = lottie.loadAnimation({
            container: offscreenContainer,
            renderer: 'canvas',
            loop: false,
            autoplay: false,
            animationData: animDataClone,
            rendererSettings: {
                clearCanvas: true,
                preserveAspectRatio: 'xMidYMid meet',
            },
        });
    } catch (err) {
        cleanup(offscreenContainer, null);
        toast('Failed to init lottie: ' + err.message, 'error');
        finishUI();
        return;
    }

    await new Promise((res) => {
        if (offAnim.isLoaded) return res();
        offAnim.addEventListener('DOMLoaded', res);
        setTimeout(res, 1500); // safety
    });

    // Force the canvas size to scaled dimensions
    const lottieCanvas = offscreenContainer.querySelector('canvas');
    if (lottieCanvas) {
        lottieCanvas.width = w;
        lottieCanvas.height = h;
        lottieCanvas.style.width = w + 'px';
        lottieCanvas.style.height = h + 'px';
        offAnim.resize();
    }

    // ── Setup GIF encoder ──
    const transparent = settings.background === 'transparent';
    // Use a sentinel color unlikely to appear in animation (bright magenta) for transparent matte
    const TRANSPARENT_KEY = '#ff00ff';
    const bgColor = transparent ? TRANSPARENT_KEY : settings.background;

    const gif = new GIF({
        workers: 4,
        quality: settings.quality,
        width: w,
        height: h,
        workerScript: WORKER_URL,
        transparent: transparent ? 0xff00ff : null,
        background: bgColor,
        repeat: 0, // loop forever
    });

    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = w;
    frameCanvas.height = h;
    const fctx = frameCanvas.getContext('2d');

    // ── Frame loop ──
    // lottie's goToAndStop(value, true) renders synchronously, so we don't
    // need to wait for rAF — and shouldn't, because background tabs throttle
    // it heavily, which would stall the export.
    setProgress(0, `Rendering 0 / ${outFrames}`);
    for (let i = 0; i < outFrames; i++) {
        if (cancelRequested) break;
        const tNorm = (outFrames === 1) ? 0 : (i / (outFrames - 1));
        const srcFrame = tNorm * (totalSrc - 1);
        offAnim.goToAndStop(srcFrame, true);

        // Composite onto bg canvas
        fctx.save();
        fctx.globalCompositeOperation = 'source-over';
        fctx.fillStyle = bgColor;
        fctx.fillRect(0, 0, w, h);
        if (lottieCanvas) {
            try { fctx.drawImage(lottieCanvas, 0, 0, w, h); } catch (_) {}
        }
        fctx.restore();

        gif.addFrame(frameCanvas, { delay, copy: true });
        setProgress(0.5 * (i + 1) / outFrames, `Rendering ${i + 1} / ${outFrames}`);

        // Yield to UI so progress + cancel can update
        if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    if (cancelRequested) {
        cleanup(offscreenContainer, offAnim);
        finishUI();
        toast('GIF export cancelled', 'info');
        return;
    }

    // ── Encode ──
    setProgress(0.5, 'Encoding…');
    gif.on('progress', (p) => {
        if (cancelRequested) return;
        setProgress(0.5 + p * 0.5, `Encoding ${(p * 100).toFixed(0)}%`);
    });
    gif.on('finished', (blob) => {
        cleanup(offscreenContainer, offAnim);
        if (cancelRequested) { finishUI(); toast('GIF export cancelled', 'info'); return; }
        const baseName = (dom.fileNameLabel.textContent || 'animation').replace(/\.json$|\.tgs$/i, '');
        downloadBlob(blob, baseName + '.gif');
        const sizeKb = (blob.size / 1024).toFixed(1);
        toast(`Exported GIF (${w}×${h}, ${sizeKb} KB)`, 'success');
        finishUI();
        closeModal();
    });
    gif.on('abort', () => {
        cleanup(offscreenContainer, offAnim);
        finishUI();
    });

    try {
        gif.render();
    } catch (err) {
        cleanup(offscreenContainer, offAnim);
        finishUI();
        toast('GIF encode error: ' + err.message, 'error');
    }
}

function cleanup(container, anim) {
    try { if (anim) anim.destroy(); } catch (_) {}
    try { if (container && container.parentNode) container.parentNode.removeChild(container); } catch (_) {}
}

function finishUI() {
    busy = false;
    cancelRequested = false;
    const m = getModal();
    m.go.disabled = false;
    m.cancel.textContent = 'Cancel';
    m.progressRow.classList.add('hidden');
    setProgress(0, 'Preparing…');
}
