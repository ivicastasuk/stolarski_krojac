// LocalStorage persistence wrapper
const KEY = 'krojac_v1';

export function save(boardSettings, partsData, unit) {
    try {
        localStorage.setItem(KEY, JSON.stringify({ boardSettings, partsData, unit }));
    } catch (_) { /* quota exceeded – ignore */ }
}

export function load() {
    try {
        const raw = localStorage.getItem(KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
}

export function clear() {
    localStorage.removeItem(KEY);
}
