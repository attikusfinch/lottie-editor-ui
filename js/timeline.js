/* AE-style timeline — layer bars, ruler, playhead, drag to retime */

import { state, dom } from './state.js';
import { saveSnapshot } from './utils.js';
import { renderPreviewSilent } from './preview.js';

const FRAME_WIDTH_DEFAULT = 6;   // px per frame
const FRAME_WIDTH_MIN = 0.5;
const FRAME_WIDTH_MAX = 40;
const ROW_HEIGHT = 24;

let frameWidth = FRAME_WIDTH_DEFAULT;
let selectLayerFn = null;

export function setTimelineSelectCallback(fn) { selectLayerFn = fn; }

// ─── DOM init ───
export function initTimelineDom() {
    dom.timelinePanel    = document.getElementById('timeline-panel');
    dom.timelineToggle   = document.getElementById('btn-timeline-toggle');
    dom.timelineInfo     = document.getElementById('timeline-info');
    dom.timelineBody     = document.getElementById('timeline-body');
    dom.timelineNames    = document.getElementById('timeline-names');
    dom.timelineTracksWrap = document.getElementById('timeline-tracks-wrap');
    dom.timelineRuler    = document.getElementById('timeline-ruler');
    dom.timelineTracks   = document.getElementById('timeline-tracks');
    dom.timelinePlayhead = document.getElementById('timeline-playhead');
    dom.tlZoomIn         = document.getElementById('tl-zoom-in');
    dom.tlZoomOut        = document.getElementById('tl-zoom-out');
    dom.tlZoomFit        = document.getElementById('tl-zoom-fit');
}

// ─── Init listeners (once) ───
export function initTimeline() {
    dom.timelineToggle.addEventListener('click', () => {
        dom.timelinePanel.classList.toggle('collapsed');
    });

    dom.tlZoomIn.addEventListener('click', () => {
        setFrameWidth(frameWidth * 1.4);
    });
    dom.tlZoomOut.addEventListener('click', () => {
        setFrameWidth(frameWidth / 1.4);
    });
    dom.tlZoomFit.addEventListener('click', fitToWidth);

    // Ctrl+wheel to zoom over the tracks area
    dom.timelineTracksWrap.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        setFrameWidth(frameWidth * factor);
    }, { passive: false });

    // Click/drag the ruler to scrub
    const rulerScrub = (e) => {
        if (!state.anim || !state.lottieData) return;
        const rect = dom.timelineRuler.getBoundingClientRect();
        const x = e.clientX - rect.left + dom.timelineTracksWrap.scrollLeft;
        const ip = state.lottieData.ip ?? 0;
        const op = state.lottieData.op ?? 60;
        const frameAbs = ip + Math.max(0, Math.min(op - ip, x / frameWidth));
        const frameRel = frameAbs - ip;
        state.anim.goToAndStop(frameRel, true);
        state.isPlaying = false;
        const iconPlay = dom.iconPlay, iconPause = dom.iconPause;
        if (iconPlay && iconPause) {
            iconPlay.classList.remove('hidden');
            iconPause.classList.add('hidden');
        }
        if (dom.scrubber) dom.scrubber.value = Math.floor(frameRel);
        if (dom.frameLabel) dom.frameLabel.textContent = `${Math.floor(frameRel)} / ${Math.floor(op - ip)}`;
        updatePlayhead();
    };
    dom.timelineRuler.addEventListener('mousedown', (e) => {
        rulerScrub(e);
        const onMove = (ev) => rulerScrub(ev);
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });

    // Keep names column scroll synced with tracks vertical scroll (if any)
    dom.timelineTracksWrap.addEventListener('scroll', () => {
        dom.timelineNames.scrollTop = dom.timelineTracksWrap.scrollTop;
    });
}

// ─── Zoom helpers ───
function setFrameWidth(fw) {
    frameWidth = Math.max(FRAME_WIDTH_MIN, Math.min(FRAME_WIDTH_MAX, fw));
    buildTimeline();
}

function fitToWidth() {
    if (!state.lottieData) return;
    const ip = state.lottieData.ip ?? 0;
    const op = state.lottieData.op ?? 60;
    const total = Math.max(1, op - ip);
    const avail = dom.timelineTracksWrap.clientWidth - 8;
    setFrameWidth(avail / total);
}

// ─── Main build ───
export function buildTimeline() {
    if (!dom.timelinePanel) return;

    if (!state.lottieData || !state.flatLayers || state.flatLayers.length === 0) {
        dom.timelinePanel.classList.add('hidden');
        return;
    }

    dom.timelinePanel.classList.remove('hidden');

    const ip = state.lottieData.ip ?? 0;
    const op = state.lottieData.op ?? 60;
    const total = Math.max(1, op - ip);
    const fr = state.lottieData.fr ?? 30;

    if (dom.timelineInfo) {
        dom.timelineInfo.textContent = `${ip}–${op}  ·  ${total}f  ·  ${fr}fps`;
    }

    const innerWidth = Math.max(total * frameWidth, dom.timelineTracksWrap.clientWidth);

    buildRuler(ip, op, innerWidth);
    buildNames();
    buildTracks(ip, op, innerWidth);
    updatePlayhead();
}

function buildRuler(ip, op, innerWidth) {
    const ruler = dom.timelineRuler;
    ruler.innerHTML = '';
    ruler.style.width = innerWidth + 'px';

    const step = chooseTickStep(frameWidth);
    const majorEvery = 5;

    const total = op - ip;
    const start = 0;
    const end = total;

    for (let f = start; f <= end; f += step) {
        const tick = document.createElement('div');
        const isMajor = ((f / step) % majorEvery === 0);
        tick.className = 'tl-tick' + (isMajor ? ' major' : '');
        tick.style.left = (f * frameWidth) + 'px';
        if (isMajor) {
            const label = document.createElement('span');
            label.className = 'tl-tick-label';
            label.textContent = (ip + f);
            tick.appendChild(label);
        }
        ruler.appendChild(tick);
    }
}

function chooseTickStep(fw) {
    if (fw >= 24) return 1;
    if (fw >= 12) return 2;
    if (fw >= 6)  return 5;
    if (fw >= 3)  return 10;
    if (fw >= 1.5) return 25;
    return 50;
}

function buildNames() {
    const el = dom.timelineNames;
    el.innerHTML = '';
    state.flatLayers.forEach((entry, idx) => {
        const row = document.createElement('div');
        row.className = 'timeline-name-row';
        if (state.selectedLayerIndices.has(idx)) row.classList.add('selected');
        row.style.paddingLeft = (10 + (entry.depth || 0) * 10) + 'px';
        row.textContent = entry.layer.nm || `Layer ${entry.layer.ind ?? idx}`;
        row.title = row.textContent;
        row.addEventListener('click', (e) => {
            if (selectLayerFn) selectLayerFn(idx, e);
        });
        el.appendChild(row);
    });
}

function buildTracks(ip, op, innerWidth) {
    const tracks = dom.timelineTracks;
    tracks.innerHTML = '';
    tracks.style.width = innerWidth + 'px';
    tracks.style.height = (state.flatLayers.length * ROW_HEIGHT) + 'px';

    state.flatLayers.forEach((entry, idx) => {
        const row = document.createElement('div');
        row.className = 'timeline-track-row';
        if (state.selectedLayerIndices.has(idx)) row.classList.add('selected');
        row.style.top = (idx * ROW_HEIGHT) + 'px';
        row.style.position = 'absolute';
        row.style.left = '0';
        row.style.right = '0';
        row.style.height = ROW_HEIGHT + 'px';

        const layer = entry.layer;
        const lIp = layer.ip ?? ip;
        const lOp = layer.op ?? op;
        const isShort = (lIp > ip || lOp < op);

        const bar = document.createElement('div');
        bar.className = 'tl-bar' + (isShort ? ' short' : '');
        bar.style.left = ((lIp - ip) * frameWidth) + 'px';
        bar.style.width = Math.max(2, (lOp - lIp) * frameWidth) + 'px';
        bar.title = `${layer.nm || 'layer'}  ·  ${lIp}–${lOp}  (${lOp - lIp}f)`;

        const label = document.createElement('span');
        label.className = 'tl-bar-label';
        label.textContent = `${lIp}–${lOp}`;
        bar.appendChild(label);

        const handleL = document.createElement('div');
        handleL.className = 'tl-handle tl-handle-l';
        bar.appendChild(handleL);

        const handleR = document.createElement('div');
        handleR.className = 'tl-handle tl-handle-r';
        bar.appendChild(handleR);

        attachBarDrag(bar, label, handleL, handleR, entry, idx, ip, op);

        row.appendChild(bar);
        tracks.appendChild(row);
    });
}

// ─── Drag on bars ───
function attachBarDrag(bar, label, handleL, handleR, entry, idx, globalIp, globalOp) {
    let mode = null;
    let startX = 0;
    let startIp = 0;
    let startOp = 0;
    let moved = false;
    let snapshotTaken = false;

    const layer = entry.layer;

    const begin = (e, m) => {
        e.preventDefault();
        e.stopPropagation();
        mode = m;
        startX = e.clientX;
        startIp = layer.ip ?? globalIp;
        startOp = layer.op ?? globalOp;
        moved = false;
        snapshotTaken = false;

        if (selectLayerFn && !state.selectedLayerIndices.has(idx)) {
            selectLayerFn(idx, e);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    };

    const onMove = (e) => {
        const dx = e.clientX - startX;
        if (Math.abs(dx) < 1 && !moved) return;

        if (!snapshotTaken) { saveSnapshot(); snapshotTaken = true; }
        moved = true;

        const df = Math.round(dx / frameWidth);

        if (mode === 'move') {
            layer.ip = startIp + df;
            layer.op = startOp + df;
        } else if (mode === 'left') {
            layer.ip = Math.min(startOp - 1, startIp + df);
        } else if (mode === 'right') {
            layer.op = Math.max(startIp + 1, startOp + df);
        }

        const lIp = layer.ip;
        const lOp = layer.op;
        bar.style.left = ((lIp - globalIp) * frameWidth) + 'px';
        bar.style.width = Math.max(2, (lOp - lIp) * frameWidth) + 'px';
        label.textContent = `${lIp}–${lOp}`;
        bar.title = `${layer.nm || 'layer'}  ·  ${lIp}–${lOp}  (${lOp - lIp}f)`;

        const isShort = (lIp > globalIp || lOp < globalOp);
        bar.classList.toggle('short', isShort);
    };

    const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (moved) {
            renderPreviewSilent();
        }
        mode = null;
    };

    bar.addEventListener('mousedown', (e) => {
        if (e.target === handleL || e.target === handleR) return;
        begin(e, 'move');
    });
    handleL.addEventListener('mousedown', (e) => begin(e, 'left'));
    handleR.addEventListener('mousedown', (e) => begin(e, 'right'));
}

// ─── Playhead ───
export function updatePlayhead() {
    if (!dom.timelinePlayhead) return;
    if (!state.lottieData || !state.anim) {
        dom.timelinePlayhead.style.display = 'none';
        return;
    }
    dom.timelinePlayhead.style.display = 'block';
    const cf = state.anim.currentFrame || 0;
    dom.timelinePlayhead.style.left = (cf * frameWidth) + 'px';
}
