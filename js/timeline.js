/* AE-style timeline — layer bars, ruler, playhead, drag to retime */

import { state, dom } from './state.js';
import { saveSnapshot } from './utils.js';
import { renderPreviewSilent } from './preview.js';

const FRAME_WIDTH_DEFAULT = 6;   // px per frame
const FRAME_WIDTH_MIN = 0.5;
const FRAME_WIDTH_MAX = 40;
const ROW_HEIGHT = 24;
const SNAP_PX = 6;

let frameWidth = FRAME_WIDTH_DEFAULT;
let selectLayerFn = null;
let rebuildLayerListFn = null; // used after rename

// drag-local rAF state
let pendingEvent = null;
let rafId = 0;

// snap guide element (lazy)
let snapGuideEl = null;
let tooltipEl = null;

export function setTimelineSelectCallback(fn) { selectLayerFn = fn; }
export function setTimelineRebuildCallback(fn) { rebuildLayerListFn = fn; }

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

    dom.tlZoomIn.addEventListener('click', () => setFrameWidth(frameWidth * 1.4));
    dom.tlZoomOut.addEventListener('click', () => setFrameWidth(frameWidth / 1.4));
    dom.tlZoomFit.addEventListener('click', fitToWidth);

    // Ctrl/Cmd+wheel to zoom over the tracks area (anchored on cursor frame)
    dom.timelineTracksWrap.addEventListener('wheel', (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        const rect = dom.timelineTracksWrap.getBoundingClientRect();
        const cursorX = e.clientX - rect.left + dom.timelineTracksWrap.scrollLeft;
        const cursorFrame = cursorX / frameWidth;
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        setFrameWidth(frameWidth * factor);
        const newX = cursorFrame * frameWidth;
        dom.timelineTracksWrap.scrollLeft = newX - (e.clientX - rect.left);
    }, { passive: false });

    // Ruler drag-to-scrub via pointer capture
    dom.timelineRuler.addEventListener('pointerdown', (e) => {
        if (!state.anim || !state.lottieData) return;
        e.preventDefault();
        dom.timelineRuler.setPointerCapture(e.pointerId);
        rulerScrubAt(e.clientX);
        const onMove = (ev) => schedule(ev, (pe) => rulerScrubAt(pe.clientX));
        const onUp = (ev) => {
            dom.timelineRuler.releasePointerCapture(e.pointerId);
            dom.timelineRuler.removeEventListener('pointermove', onMove);
            dom.timelineRuler.removeEventListener('pointerup', onUp);
            dom.timelineRuler.removeEventListener('pointercancel', onUp);
            cancelScheduled();
        };
        dom.timelineRuler.addEventListener('pointermove', onMove);
        dom.timelineRuler.addEventListener('pointerup', onUp);
        dom.timelineRuler.addEventListener('pointercancel', onUp);
    });

    // Sync names scroll with tracks vertical scroll
    dom.timelineTracksWrap.addEventListener('scroll', () => {
        dom.timelineNames.scrollTop = dom.timelineTracksWrap.scrollTop;
    });
}

function rulerScrubAt(clientX) {
    if (!state.anim || !state.lottieData) return;
    const rect = dom.timelineRuler.getBoundingClientRect();
    const x = clientX - rect.left + dom.timelineTracksWrap.scrollLeft;
    const ip = state.lottieData.ip ?? 0;
    const op = state.lottieData.op ?? 60;
    const frameRel = Math.max(0, Math.min(op - ip, x / frameWidth));
    state.anim.goToAndStop(frameRel, true);
    state.isPlaying = false;
    if (dom.iconPlay && dom.iconPause) {
        dom.iconPlay.classList.remove('hidden');
        dom.iconPause.classList.add('hidden');
    }
    if (dom.scrubber) dom.scrubber.value = Math.floor(frameRel);
    if (dom.frameLabel) dom.frameLabel.textContent = `${Math.floor(frameRel)} / ${Math.floor(op - ip)}`;
    updatePlayhead();
}

// ─── rAF throttling helpers ───
function schedule(ev, cb) {
    pendingEvent = ev;
    if (!rafId) {
        rafId = requestAnimationFrame(() => {
            rafId = 0;
            const pe = pendingEvent;
            pendingEvent = null;
            if (pe) cb(pe);
        });
    }
}
function cancelScheduled() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    pendingEvent = null;
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
        hideSnapGuide();
        hideTooltip();
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

    for (let f = 0; f <= total; f += step) {
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

        const span = document.createElement('span');
        span.className = 'tl-name-text';
        span.textContent = entry.layer.nm || `Layer ${entry.layer.ind ?? idx}`;
        row.appendChild(span);
        row.title = span.textContent;

        row.addEventListener('click', (e) => {
            if (selectLayerFn) selectLayerFn(idx, e);
        });
        row.addEventListener('dblclick', (e) => {
            e.preventDefault();
            beginRename(row, span, entry);
        });
        el.appendChild(row);
    });
}

function beginRename(row, span, entry) {
    const current = entry.layer.nm || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tl-rename-input';
    input.value = current;
    row.replaceChild(input, span);
    input.focus();
    input.select();

    const commit = (save) => {
        if (!input.parentNode) return;
        if (save) {
            const v = input.value.trim();
            if (v && v !== current) {
                saveSnapshot();
                entry.layer.nm = v;
                span.textContent = v;
                row.title = v;
                if (rebuildLayerListFn) rebuildLayerListFn();
                else row.replaceChild(span, input);
                return;
            }
        }
        span.textContent = current;
        row.replaceChild(span, input);
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(true); }
        else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', () => commit(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('mousedown', (e) => e.stopPropagation());
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

// ─── Snap target collection ───
function collectSnapTargets(excludeLayer) {
    const ip = state.lottieData.ip ?? 0;
    const op = state.lottieData.op ?? 60;
    const targets = new Set([ip, op]);

    if (state.anim) {
        const ph = ip + Math.round(state.anim.currentFrame || 0);
        targets.add(ph);
    }

    for (const entry of state.flatLayers) {
        if (entry.layer === excludeLayer) continue;
        if (entry.layer.ip !== undefined) targets.add(Math.round(entry.layer.ip));
        if (entry.layer.op !== undefined) targets.add(Math.round(entry.layer.op));
    }
    return Array.from(targets);
}

function snapFrame(frame, targets, enabled) {
    if (!enabled) return { frame, snapped: false };
    const px = frame * frameWidth;
    let best = null, bestDist = Infinity;
    for (const t of targets) {
        const d = Math.abs(t * frameWidth - px);
        if (d < bestDist && d <= SNAP_PX) { best = t; bestDist = d; }
    }
    return best !== null ? { frame: best, snapped: true, target: best } : { frame, snapped: false };
}

// ─── Drag on bars ───
function attachBarDrag(bar, label, handleL, handleR, entry, idx, globalIp, globalOp) {
    let mode = null;
    let pointerId = -1;
    let startX = 0;
    let startIp = 0;
    let startOp = 0;
    let moved = false;
    let snapshotTaken = false;
    let snapTargets = [];

    const layer = entry.layer;

    const apply = (ev) => {
        const snapEnabled = !(ev.ctrlKey || ev.metaKey);
        const dx = ev.clientX - startX;
        if (!moved && Math.abs(dx) < 1) return;

        if (!snapshotTaken) { saveSnapshot(); snapshotTaken = true; }
        moved = true;

        const rawDf = dx / frameWidth;
        let df = Math.round(rawDf);
        let snappedTarget = null;

        if (mode === 'move') {
            let ipCandidate = startIp + df;
            let opCandidate = startOp + df;
            // try snapping either edge whichever is closer
            const snapIp = snapFrame(ipCandidate, snapTargets, snapEnabled);
            const snapOp = snapFrame(opCandidate, snapTargets, snapEnabled);
            if (snapIp.snapped && (!snapOp.snapped || Math.abs(snapIp.frame - ipCandidate) <= Math.abs(snapOp.frame - opCandidate))) {
                const delta = snapIp.frame - ipCandidate;
                ipCandidate += delta; opCandidate += delta;
                snappedTarget = snapIp.frame;
            } else if (snapOp.snapped) {
                const delta = snapOp.frame - opCandidate;
                ipCandidate += delta; opCandidate += delta;
                snappedTarget = snapOp.frame;
            }
            layer.ip = ipCandidate;
            layer.op = opCandidate;
        } else if (mode === 'left') {
            let ipCandidate = Math.min(startOp - 1, startIp + df);
            const s = snapFrame(ipCandidate, snapTargets, snapEnabled);
            if (s.snapped && s.frame < startOp) { ipCandidate = s.frame; snappedTarget = s.frame; }
            layer.ip = ipCandidate;
        } else if (mode === 'right') {
            let opCandidate = Math.max(startIp + 1, startOp + df);
            const s = snapFrame(opCandidate, snapTargets, snapEnabled);
            if (s.snapped && s.frame > startIp) { opCandidate = s.frame; snappedTarget = s.frame; }
            layer.op = opCandidate;
        }

        const lIp = layer.ip, lOp = layer.op;
        bar.style.left = ((lIp - globalIp) * frameWidth) + 'px';
        bar.style.width = Math.max(2, (lOp - lIp) * frameWidth) + 'px';
        label.textContent = `${lIp}–${lOp}`;
        bar.title = `${layer.nm || 'layer'}  ·  ${lIp}–${lOp}  (${lOp - lIp}f)`;
        const isShort = (lIp > globalIp || lOp < globalOp);
        bar.classList.toggle('short', isShort);

        if (snappedTarget !== null) showSnapGuide(snappedTarget - globalIp);
        else hideSnapGuide();

        showTooltip(ev.clientX, ev.clientY, layer, lIp, lOp);
    };

    const begin = (e, m) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        mode = m;
        pointerId = e.pointerId;
        startX = e.clientX;
        startIp = layer.ip ?? globalIp;
        startOp = layer.op ?? globalOp;
        moved = false;
        snapshotTaken = false;
        snapTargets = collectSnapTargets(layer);

        try { bar.setPointerCapture(pointerId); } catch (_) {}

        if (selectLayerFn && !state.selectedLayerIndices.has(idx)) {
            selectLayerFn(idx, e);
        }

        bar.addEventListener('pointermove', onMove);
        bar.addEventListener('pointerup', onUp);
        bar.addEventListener('pointercancel', onUp);
    };

    const onMove = (e) => schedule(e, apply);

    const onUp = (e) => {
        try { bar.releasePointerCapture(pointerId); } catch (_) {}
        bar.removeEventListener('pointermove', onMove);
        bar.removeEventListener('pointerup', onUp);
        bar.removeEventListener('pointercancel', onUp);
        cancelScheduled();
        hideSnapGuide();
        hideTooltip();
        if (moved) renderPreviewSilent();
        mode = null;
        pointerId = -1;
    };

    bar.addEventListener('pointerdown', (e) => {
        if (e.target === handleL || e.target === handleR) return;
        begin(e, 'move');
    });
    handleL.addEventListener('pointerdown', (e) => begin(e, 'left'));
    handleR.addEventListener('pointerdown', (e) => begin(e, 'right'));
}

// ─── Snap guide ───
function ensureSnapGuide() {
    if (snapGuideEl) return snapGuideEl;
    snapGuideEl = document.createElement('div');
    snapGuideEl.className = 'tl-snap-guide';
    dom.timelineTracks.appendChild(snapGuideEl);
    return snapGuideEl;
}
function showSnapGuide(frameRel) {
    const el = ensureSnapGuide();
    el.style.left = (frameRel * frameWidth) + 'px';
    el.style.display = 'block';
}
function hideSnapGuide() {
    if (snapGuideEl) snapGuideEl.style.display = 'none';
}

// ─── Trim tooltip ───
function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'tl-trim-tooltip';
    document.body.appendChild(tooltipEl);
    return tooltipEl;
}
function showTooltip(x, y, layer, lIp, lOp) {
    const el = ensureTooltip();
    const fr = state.lottieData?.fr ?? 30;
    const len = lOp - lIp;
    const secs = (len / fr).toFixed(2);
    el.textContent = `in ${lIp}  ·  out ${lOp}  ·  ${len}f  ·  ${secs}s`;
    el.style.display = 'block';
    el.style.left = (x + 14) + 'px';
    el.style.top = (y - 30) + 'px';
}
function hideTooltip() {
    if (tooltipEl) tooltipEl.style.display = 'none';
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

// ─── Public helpers for keyboard shortcuts ───
export function trimInToCTI() {
    if (!state.anim || !state.lottieData) return false;
    const cf = Math.round(state.anim.currentFrame || 0);
    const ip = state.lottieData.ip ?? 0;
    const absFrame = ip + cf;
    let any = false;
    const indices = state.selectedLayerIndices.size > 0
        ? [...state.selectedLayerIndices]
        : [];
    if (indices.length === 0) return false;

    saveSnapshot();
    for (const i of indices) {
        const entry = state.flatLayers[i];
        if (!entry) continue;
        const op = entry.layer.op ?? (state.lottieData.op ?? 60);
        if (absFrame < op) {
            entry.layer.ip = absFrame;
            any = true;
        }
    }
    if (any) { renderPreviewSilent(); buildTimeline(); }
    return any;
}

export function trimOutToCTI() {
    if (!state.anim || !state.lottieData) return false;
    const cf = Math.round(state.anim.currentFrame || 0);
    const ip = state.lottieData.ip ?? 0;
    const absFrame = ip + cf;
    const indices = state.selectedLayerIndices.size > 0
        ? [...state.selectedLayerIndices]
        : [];
    if (indices.length === 0) return false;

    saveSnapshot();
    let any = false;
    for (const i of indices) {
        const entry = state.flatLayers[i];
        if (!entry) continue;
        const ipLayer = entry.layer.ip ?? (state.lottieData.ip ?? 0);
        if (absFrame > ipLayer) {
            entry.layer.op = absFrame;
            any = true;
        }
    }
    if (any) { renderPreviewSilent(); buildTimeline(); }
    return any;
}
