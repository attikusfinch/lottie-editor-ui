/* Preview rendering, playback controls, frame markers */

import { state, dom } from './state.js';
import { toast, saveSnapshot } from './utils.js';
import { sanitizeLottieData } from './file.js';

let updateSelectionBoxFn = null;
export function setUpdateSelectionBox(fn) { updateSelectionBoxFn = fn; }

// ─── Main Render ───
export function renderPreview() {
    if (state.anim) {
        state.anim.destroy();
        state.anim = null;
    }
    dom.lottiePlayer.innerHTML = '';

    if (!state.lottieData) {
        dom.previewEmpty.classList.remove('hidden');
        dom.playbackControls.classList.add('hidden');
        dom.trimControls.classList.add('hidden');
        return;
    }

    dom.previewEmpty.classList.add('hidden');
    dom.playbackControls.classList.remove('hidden');
    dom.trimControls.classList.remove('hidden');

    // Update trim inputs
    dom.trimIn.value = Math.floor(state.lottieData.ip || 0);
    dom.trimOut.value = Math.floor(state.lottieData.op || 60);

    const w = state.lottieData.w || 512;
    const h = state.lottieData.h || 512;
    const maxW = dom.lottiePlayer.parentElement.clientWidth - 40;
    const maxH = dom.lottiePlayer.parentElement.clientHeight - 40;
    state.previewScale = Math.min(1, maxW / w, maxH / h);
    dom.lottiePlayer.style.width = (w * state.previewScale) + 'px';
    dom.lottiePlayer.style.height = (h * state.previewScale) + 'px';

    updateFrameBoundaryMarkers(w, h);

    const animData = JSON.parse(JSON.stringify(state.lottieData));
    sanitizeLottieData(animData);

    try {
        state.anim = lottie.loadAnimation({
            container: dom.lottiePlayer,
            renderer: 'svg',
            loop: state.isLooping,
            autoplay: true,
            animationData: animData,
        });
    } catch (err) {
        console.error('lottie.loadAnimation error:', err);
        toast('Lottie render error: ' + err.message, 'error');
        return;
    }

    state.isPlaying = true;
    updatePlayPauseIcon();

    const totalFrames = state.anim.totalFrames || 0;
    dom.scrubber.max = Math.floor(totalFrames);

    state.anim.addEventListener('enterFrame', () => {
        const cf = Math.floor(state.anim.currentFrame);
        dom.scrubber.value = cf;
        dom.frameLabel.textContent = `${cf} / ${Math.floor(totalFrames)}`;
        if (updateSelectionBoxFn) updateSelectionBoxFn();
    });

    requestAnimationFrame(() => { if (updateSelectionBoxFn) updateSelectionBoxFn(); });
}

// ─── Silent Re-render (during drag) ───
export function renderPreviewSilent() {
    if (!state.anim || !state.lottieData) return;
    const currentFrame = state.anim.currentFrame;
    state.anim.destroy();
    dom.lottiePlayer.innerHTML = '';

    const animData = JSON.parse(JSON.stringify(state.lottieData));
    sanitizeLottieData(animData);

    try {
        state.anim = lottie.loadAnimation({
            container: dom.lottiePlayer,
            renderer: 'svg',
            loop: state.isLooping,
            autoplay: false,
            animationData: animData,
        });
    } catch (err) {
        console.error('lottie silent render error:', err);
        return;
    }

    state.anim.goToAndStop(currentFrame, true);

    const totalFrames = state.anim.totalFrames || 0;
    state.anim.addEventListener('enterFrame', () => {
        const cf = Math.floor(state.anim.currentFrame);
        dom.scrubber.value = cf;
        dom.frameLabel.textContent = `${cf} / ${Math.floor(totalFrames)}`;
    });
}

// ─── Frame Boundary Markers ───
function updateFrameBoundaryMarkers(w, h) {
    dom.previewContainer.querySelectorAll('.frame-corner-tr, .frame-corner-bl, .frame-size-label').forEach(el => el.remove());

    requestAnimationFrame(() => {
        const playerRect = dom.lottiePlayer.getBoundingClientRect();
        const containerRect = dom.previewContainer.getBoundingClientRect();

        const top = playerRect.top - containerRect.top;
        const left = playerRect.left - containerRect.left;
        const right = left + playerRect.width;
        const bottom = top + playerRect.height;

        const trCorner = document.createElement('div');
        trCorner.className = 'frame-corner-tr';
        trCorner.style.top = (top - 1) + 'px';
        trCorner.style.left = (right - 12 + 1) + 'px';
        dom.previewContainer.appendChild(trCorner);

        const blCorner = document.createElement('div');
        blCorner.className = 'frame-corner-bl';
        blCorner.style.top = (bottom - 12 + 1) + 'px';
        blCorner.style.left = (left - 1) + 'px';
        dom.previewContainer.appendChild(blCorner);

        const sizeLabel = document.createElement('div');
        sizeLabel.className = 'frame-size-label';
        sizeLabel.textContent = `${w} × ${h}`;
        sizeLabel.style.top = (bottom + 6) + 'px';
        sizeLabel.style.left = (left + playerRect.width / 2) + 'px';
        sizeLabel.style.transform = 'translateX(-50%)';
        dom.previewContainer.appendChild(sizeLabel);
    });
}

// ─── Playback Controls ───
export function updatePlayPauseIcon() {
    dom.iconPlay.classList.toggle('hidden', state.isPlaying);
    dom.iconPause.classList.toggle('hidden', !state.isPlaying);
}

export function initPlaybackControls() {
    dom.btnPlayPause.addEventListener('click', () => {
        if (!state.anim) return;
        if (state.isPlaying) {
            state.anim.pause();
            state.isPlaying = false;
        } else {
            state.anim.play();
            state.isPlaying = true;
        }
        updatePlayPauseIcon();
    });

    dom.scrubber.addEventListener('input', () => {
        if (!state.anim) return;
        const frame = parseInt(dom.scrubber.value);
        state.anim.goToAndStop(frame, true);
        state.isPlaying = false;
        updatePlayPauseIcon();
    });

    dom.btnLoop.addEventListener('click', () => {
        state.isLooping = !state.isLooping;
        dom.btnLoop.classList.toggle('active', state.isLooping);
        if (state.anim) state.anim.loop = state.isLooping;
    });

    // ─── Trim ───
    dom.btnTrimApply.addEventListener('click', () => {
        if (!state.lottieData) return;
        const inFrame = parseInt(dom.trimIn.value) || 0;
        const outFrame = parseInt(dom.trimOut.value) || 0;
        if (outFrame <= inFrame) {
            toast('Out frame must be greater than In frame', 'error');
            return;
        }
        // Save for undo
        saveSnapshot();
        state.lottieData.ip = inFrame;
        state.lottieData.op = outFrame;
        renderPreview();
        toast(`Trimmed: ${inFrame} → ${outFrame} (${outFrame - inFrame} frames)`, 'success');
    });
}
