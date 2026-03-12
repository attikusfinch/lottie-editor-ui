/* Pure utility functions — no side effects, no state deps */

// ─── Toast ───
export function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
        el.classList.add('toast-out');
        el.addEventListener('animationend', () => el.remove());
    }, 2500);
}

// ─── HTML Escape ───
export function escHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ─── Color Conversion (Lottie uses 0-1 range) ───

export function rgbToHex(r, g, b) {
    const to255 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
    const hex = (v) => to255(v).toString(16).padStart(2, '0');
    return '#' + hex(r) + hex(g) + hex(b);
}

export function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return [0, 0, 0];
    return [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255,
    ];
}

export const hexToRgbNorm = hexToRgb;

export function rgbToHsl(r, g, b) {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return [h, s, l];
}

export function hslToRgb(h, s, l) {
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return [r, g, b];
}

// ─── Transform Helpers ───

export function getStaticOrFirstKeyframe(prop) {
    if (prop.a === 1 && prop.k && Array.isArray(prop.k) && prop.k.length > 0) {
        const kf = prop.k[0];
        return kf.s || kf.e || [0, 0];
    }
    if (Array.isArray(prop.k)) return prop.k.slice();
    return [0, 0];
}

export function setStaticOrFirstKeyframe(prop, values) {
    if (prop.a === 1 && prop.k && Array.isArray(prop.k) && prop.k.length > 0) {
        const kf = prop.k[0];
        if (kf.s) { kf.s[0] = values[0]; kf.s[1] = values[1]; }
    } else {
        if (Array.isArray(prop.k)) { prop.k[0] = values[0]; prop.k[1] = values[1]; }
    }
}

export function getStaticOrFirstKeyframeScalar(prop) {
    if (prop.a === 1 && prop.k && Array.isArray(prop.k) && prop.k.length > 0) {
        const kf = prop.k[0];
        const val = kf.s || kf.e;
        return Array.isArray(val) ? val[0] : val;
    }
    if (Array.isArray(prop.k)) return prop.k[0];
    return prop.k;
}

export function setStaticOrFirstKeyframeScalar(prop, value) {
    if (prop.a === 1 && prop.k && Array.isArray(prop.k) && prop.k.length > 0) {
        const kf = prop.k[0];
        if (kf.s) {
            if (Array.isArray(kf.s)) kf.s[0] = value;
            else kf.s = value;
        }
    } else {
        if (Array.isArray(prop.k)) prop.k[0] = value;
        else prop.k = value;
    }
}

// ─── Undo ───
import { state } from './state.js';

export function saveSnapshot() {
    if (!state.lottieData) return;
    const snap = JSON.stringify(state.lottieData);
    if (state.undoStack.length > 0 && state.undoStack[state.undoStack.length - 1] === snap) return;
    state.undoStack.push(snap);
    if (state.undoStack.length > state.MAX_UNDO) state.undoStack.shift();
}

// ─── Blob Download ───
export function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
