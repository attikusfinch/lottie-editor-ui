/* Conservative Lottie export optimizer */

const DEFAULT_DROP_KEYS = new Set([
    'mn', // After Effects match-name metadata; not needed for playback.
]);

const DEFAULT_FALSE_KEYS = new Set(['hd', 'ddd']);
const DEFAULT_ZERO_KEYS = new Set(['ao', 'bm', 'td', 'st']);
const DEFAULT_ONE_KEYS = new Set(['sr']);
const OPTIONAL_EMPTY_ARRAY_KEYS = new Set(['assets', 'chars', 'markers']);

export function optimizeLottieData(data, options = {}) {
    const precision = Number.isFinite(options.precision) ? options.precision : 3;
    const optimized = cleanValue(data, precision, '');
    if (optimized && typeof optimized === 'object') {
        optimized.meta = {
            ...(optimized.meta || {}),
            optimizer: 'lottie-editor',
        };
    }
    return optimized;
}

export function getJsonByteLength(json) {
    return new TextEncoder().encode(json).length;
}

function cleanValue(value, precision, key) {
    if (typeof value === 'number') return roundNumber(value, precision);
    if (typeof value === 'string') return value;
    if (typeof value === 'boolean' || value === null) return value;

    if (Array.isArray(value)) {
        return value.map(item => cleanValue(item, precision, key));
    }

    if (!value || typeof value !== 'object') return value;

    const out = {};
    for (const [childKey, childValue] of Object.entries(value)) {
        if (shouldSkipKey(childKey)) continue;

        const cleaned = cleanValue(childValue, precision, childKey);
        if (shouldDropValue(childKey, cleaned)) continue;
        out[childKey] = cleaned;
    }
    return out;
}

function shouldSkipKey(key) {
    return key.startsWith('_') || DEFAULT_DROP_KEYS.has(key);
}

function shouldDropValue(key, value) {
    if (value === undefined) return true;
    if (DEFAULT_FALSE_KEYS.has(key) && value === false) return true;
    if (DEFAULT_ZERO_KEYS.has(key) && value === 0) return true;
    if (DEFAULT_ONE_KEYS.has(key) && value === 1) return true;
    if (OPTIONAL_EMPTY_ARRAY_KEYS.has(key) && Array.isArray(value) && value.length === 0) return true;
    if (key === 'meta' && value && typeof value === 'object' && Object.keys(value).length === 0) return true;
    return false;
}

function roundNumber(value, precision) {
    if (!Number.isFinite(value)) return 0;
    if (Number.isInteger(value)) return value;
    const factor = 10 ** precision;
    const rounded = Math.round(value * factor) / factor;
    return Object.is(rounded, -0) ? 0 : rounded;
}
