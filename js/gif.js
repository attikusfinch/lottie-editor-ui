/* GIF export — modal UI + offscreen lottie SVG → Image → canvas → gif.js */

import { state, dom } from './state.js';
import { toast, downloadBlob } from './utils.js';

const WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js';

// gif.js spawns a Web Worker. Browsers refuse to construct workers from a
// cross-origin URL even if CORS headers are present, so we fetch the script
// text and build a same-origin Blob URL to use as workerScript.
let cachedWorkerBlobUrl = null;
async function getWorkerBlobUrl() {
    if (cachedWorkerBlobUrl) return cachedWorkerBlobUrl;
    const res = await fetch(WORKER_URL, { mode: 'cors' });
    if (!res.ok) throw new Error(`worker fetch failed: ${res.status}`);
    const text = await res.text();
    cachedWorkerBlobUrl = URL.createObjectURL(new Blob([text], { type: 'application/javascript' }));
    return cachedWorkerBlobUrl;
}

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
        overlay      : document.getElementById('gif-modal'),
        close        : document.getElementById('gif-modal-close'),
        cancel       : document.getElementById('gif-modal-cancel'),
        go           : document.getElementById('gif-modal-go'),
        swatches     : document.getElementById('gif-bg-swatches'),
        custom       : document.getElementById('gif-bg-custom'),
        info         : document.getElementById('gif-info'),
        progressRow  : document.getElementById('gif-progress-row'),
        progressFill : document.getElementById('gif-progress-fill'),
        progressText : document.getElementById('gif-progress-text'),
        segControls  : document.querySelectorAll('#gif-modal .seg-control'),
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

// ─── SVG → Image → canvas pipeline ───
// Using the SVG renderer preserves gradients, masks, and effects which the
// canvas renderer often quantizes incorrectly. We serialize each frame's SVG
// into a Blob, decode it via an Image, then draw it onto the frame canvas.
function svgToBlobUrl(svgEl, srcW, srcH) {
    const clone = svgEl.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    clone.setAttribute('width', srcW);
    clone.setAttribute('height', srcH);
    if (!clone.getAttribute('viewBox')) {
        clone.setAttribute('viewBox', `0 0 ${srcW} ${srcH}`);
    }
    const svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    return URL.createObjectURL(new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' }));
}

async function loadImage(url) {
    const img = new Image();
    img.decoding = 'sync';
    img.src = url;
    if (img.decode) {
        try { await img.decode(); return img; } catch (_) {}
    }
    return new Promise((res, rej) => {
        if (img.complete && img.naturalWidth) return res(img);
        img.onload = () => res(img);
        img.onerror = (e) => rej(new Error('image decode failed'));
    });
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

    let workerScript;
    try {
        workerScript = await getWorkerBlobUrl();
    } catch (err) {
        finishUI();
        toast('Could not load gif.worker.js: ' + err.message, 'error');
        return;
    }

    const ip = state.lottieData.ip ?? 0;
    const op = state.lottieData.op ?? 60;
    const sourceFr = state.lottieData.fr ?? 30;
    const totalSrc = Math.max(1, op - ip);
    const seconds = totalSrc / sourceFr;
    const targetFps = Math.min(settings.fps, sourceFr);
    const outFrames = Math.max(1, Math.round(seconds * targetFps));
    const srcW = state.lottieData.w || 512;
    const srcH = state.lottieData.h || 512;
    const w = Math.max(1, Math.round(srcW * settings.scale));
    const h = Math.max(1, Math.round(srcH * settings.scale));
    const delay = Math.round(1000 / targetFps);

    // ── Build offscreen SVG-renderer animation ──
    const offscreenContainer = document.createElement('div');
    offscreenContainer.style.cssText = `position:fixed; left:-99999px; top:-99999px; width:${srcW}px; height:${srcH}px; pointer-events:none; opacity:0;`;
    document.body.appendChild(offscreenContainer);

    const animDataClone = JSON.parse(JSON.stringify(state.lottieData));
    let offAnim;
    try {
        offAnim = lottie.loadAnimation({
            container: offscreenContainer,
            renderer: 'svg',
            loop: false,
            autoplay: false,
            animationData: animDataClone,
            rendererSettings: {
                preserveAspectRatio: 'xMidYMid meet',
                progressiveLoad: false,
                hideOnTransparent: true,
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
        setTimeout(res, 1500);
    });

    const offSvg = offscreenContainer.querySelector('svg');
    if (!offSvg) {
        cleanup(offscreenContainer, offAnim);
        toast('Offscreen SVG not produced by lottie', 'error');
        finishUI();
        return;
    }
    offSvg.setAttribute('width', srcW);
    offSvg.setAttribute('height', srcH);

    // ── Setup GIF encoder ──
    const transparent = settings.background === 'transparent';
    const KEY_R = 0xff, KEY_G = 0x00, KEY_B = 0xff;
    const bgColor = transparent ? '#ffffff' : settings.background;

    const gif = new GIF({
        workers: 4,
        quality: settings.quality,
        width: w,
        height: h,
        workerScript,
        transparent: transparent ? 0xff00ff : null,
        background: bgColor,
        repeat: 0,
    });

    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = w;
    frameCanvas.height = h;
    const fctx = frameCanvas.getContext('2d', { willReadFrequently: transparent });
    fctx.imageSmoothingEnabled = true;
    fctx.imageSmoothingQuality = 'high';

    // ── Frame loop ──
    setProgress(0, `Rendering 0 / ${outFrames}`);
    let blobUrl = null;
    try {
        for (let i = 0; i < outFrames; i++) {
            if (cancelRequested) break;

            const tNorm = (outFrames === 1) ? 0 : (i / (outFrames - 1));
            const srcFrame = tNorm * (totalSrc - 1);
            offAnim.goToAndStop(srcFrame, true);

            // Serialize the freshly-rendered SVG and decode into an Image.
            blobUrl = svgToBlobUrl(offSvg, srcW, srcH);
            let img;
            try {
                img = await loadImage(blobUrl);
            } catch (err) {
                URL.revokeObjectURL(blobUrl);
                blobUrl = null;
                throw err;
            }

            if (transparent) {
                fctx.clearRect(0, 0, w, h);
                fctx.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(blobUrl);
                blobUrl = null;

                // GIF only supports 1-bit alpha. Hard-cut at α = 128:
                //   α <  128 → key colour (magenta) → transparent in GIF
                //   α ≥ 128 → keep RGB as drawn, force opaque
                // No matte blend — anti-aliased edges keep their faded RGB
                // and just become slightly jagged, which is a far better
                // tradeoff than tinted fringes from compositing onto a
                // mystery colour.
                const imageData = fctx.getImageData(0, 0, w, h);
                const d = imageData.data;
                for (let p = 0; p < d.length; p += 4) {
                    if (d[p + 3] < 128) {
                        d[p]   = KEY_R;
                        d[p+1] = KEY_G;
                        d[p+2] = KEY_B;
                    } else if (d[p] === KEY_R && d[p+1] === KEY_G && d[p+2] === KEY_B) {
                        // Real pixel that happens to be pure magenta: nudge
                        // so it isn't accidentally keyed out.
                        d[p+2] = 0xfe;
                    }
                    d[p+3] = 255;
                }
                fctx.putImageData(imageData, 0, 0);
            } else {
                fctx.fillStyle = bgColor;
                fctx.fillRect(0, 0, w, h);
                fctx.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(blobUrl);
                blobUrl = null;
            }

            gif.addFrame(frameCanvas, { delay, copy: true });
            setProgress(0.5 * (i + 1) / outFrames, `Rendering ${i + 1} / ${outFrames}`);

            if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
        }
    } catch (err) {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        cleanup(offscreenContainer, offAnim);
        finishUI();
        toast('Render error: ' + err.message, 'error');
        return;
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
