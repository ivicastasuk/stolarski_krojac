// Main UI controller – imports all modules
import { toMM, fmt } from './units.js';
import { packAll } from './packing.js';
import { save, load, clear } from './storage.js';
import { drawBoards, updateStats, drawPreviewBoard, updateLiveCanvas } from './render.js';

// ── State ──────────────────────────────────────────────────────────────────
const parts = [];           // { id, w, h, area, color, rotAllowed } – all in mm
const dimensionColors = {}; // 'WxH' → hsl color string
let seq = 1;
let currentUnit = 'mm';
let isOptimizing = false;
let showingResult = false; // true when #boards shows an optimisation result

/**
 * Rebuild a fresh preview of the current board dimensions + grain settings.
 * Called on load, reset, and whenever board dims change.
 */
function refreshCanvas() {
    const u = currentUnit;
    const boardW = toMM(document.getElementById('boardWidth').value, u);
    const boardH = toMM(document.getElementById('boardHeight').value, u);
    if (!(boardW > 0 && boardH > 0)) return;
    const showTexture = !document.getElementById('uniformTexture').checked;
    const grainAngle = parseInt(document.getElementById('grainAngle').value) || 0;
    showingResult = false;
    drawPreviewBoard(boardW, boardH, u, showTexture, grainAngle);
}

/**
 * Update grain/texture style on the current canvas without re-running optimisation.
 * If optimisation result is shown, only patches the visual state.
 * If preview is shown, fully redraws the preview.
 */
function updateCanvasStyle() {
    const showTexture = !document.getElementById('uniformTexture').checked;
    const grainAngle = parseInt(document.getElementById('grainAngle').value) || 0;
    if (!updateLiveCanvas({ showTexture, grainAngle })) {
        // No live canvas yet (e.g. on very first load before board dims filled)
        refreshCanvas();
    }
}

/**
 * Deterministic color from piece dimension key using the golden angle (137.5°).
 * Same dimensions → always same color. Golden angle maximises perceptual
 * separation between adjacent hue steps, so 50+ piece types remain distinct.
 */
function colorForKey(key) {
    let hash = 0;
    for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0;
    const hue = (hash * 137.508) % 360;
    const sat = 48 + (hash % 3) * 14;          // 48 / 62 / 76 %
    const light = 52 + ((hash >>> 8) % 3) * 9;   // 52 / 61 / 70 %
    return `hsl(${Math.round(hue)} ${sat}% ${light}%)`;
}

// ── Parts helpers ──────────────────────────────────────────────────────────
function getGrouped() {
    const grouped = {};
    for (const p of parts) {
        const key = `${p.w}x${p.h}`;
        if (!grouped[ key ]) grouped[ key ] = { w: p.w, h: p.h, qty: 0, rotAllowed: p.rotAllowed, allRot: true };
        grouped[ key ].qty++;
        if (!p.rotAllowed) grouped[ key ].allRot = false;
    }
    return grouped;
}

function addPartMM(wMM, hMM, qty, rotAllowed) {
    if (!(wMM > 0 && hMM > 0 && qty > 0)) return;
    const key = `${wMM}x${hMM}`;
    if (!dimensionColors[ key ]) dimensionColors[ key ] = colorForKey(key);
    const color = dimensionColors[ key ];
    for (let i = 0; i < qty; i++) {
        parts.push({ id: seq++, w: wMM, h: hMM, area: wMM * hMM, color, rotAllowed: !!rotAllowed });
    }
}

// ── Validation ─────────────────────────────────────────────────────────────
function validateNewPart(wMM, hMM) {
    if (!(wMM > 0 && hMM > 0)) return 'Dimenzije moraju biti pozitivne.';
    const boardWMM = toMM(document.getElementById('boardWidth').value, currentUnit);
    const boardHMM = toMM(document.getElementById('boardHeight').value, currentUnit);
    if (!(boardWMM > 0 && boardHMM > 0)) return null; // can't check without valid board
    const allowRotate = document.getElementById('allowRotate').checked;
    const fitsNormal = wMM <= boardWMM && hMM <= boardHMM;
    const fitsRotated = allowRotate && hMM <= boardWMM && wMM <= boardHMM;
    if (!fitsNormal && !fitsRotated) {
        const bw = fmt(boardWMM, currentUnit), bh = fmt(boardHMM, currentUnit);
        const pw = fmt(wMM, currentUnit), ph = fmt(hMM, currentUnit);
        return `Komad ${pw}×${ph} ${currentUnit} ne staje na tablu ${bw}×${bh} ${currentUnit}.`;
    }
    return null;
}

function validateBoard() {
    const boardW = toMM(document.getElementById('boardWidth').value, currentUnit);
    const boardH = toMM(document.getElementById('boardHeight').value, currentUnit);
    if (!(boardW > 0 && boardH > 0)) return 'Dimenzije ploce moraju biti pozitivne.';
    const kerf = toMM(document.getElementById('kerf').value, currentUnit);
    if (kerf < 0) return 'Kerf ne moze biti negativan.';
    // Warn (non-blocking) for unrealistic kerf values
    const kerfWarnEl = document.getElementById('board-warn');
    if (kerfWarnEl) {
        if (kerf > 15) {
            kerfWarnEl.textContent = `⚠ Kerf ${fmt(kerf, currentUnit)} ${currentUnit} je neobično velik za testersku ploču. Proverite unos.`;
            kerfWarnEl.hidden = false;
        } else {
            kerfWarnEl.textContent = '';
            kerfWarnEl.hidden = true;
        }
    }
    return null;
}

// ── Error display ──────────────────────────────────────────────────────────
function showError(id, msg) {
    const el = document.getElementById(id);
    el.textContent = msg;
    el.hidden = false;
}

function clearError(id) {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.hidden = true; }
}

// ── Parts list rendering ───────────────────────────────────────────────────
function renderParts() {
    const list = document.getElementById('parts-list');
    list.innerHTML = '';
    const grouped = getGrouped();

    Object.entries(grouped)
        .sort(([ , a ], [ , b ]) => b.w * b.h - a.w * a.h)
        .forEach(([ , v ]) => {
            const row = document.createElement('div');
            row.className = 'part-row';
            const rotLabel = v.allRot ? 'rot' : (v.rotAllowed ? 'mix' : 'fix');
            row.innerHTML = `
                <span>${fmt(v.w, currentUnit)}</span>
                <span>${fmt(v.h, currentUnit)}</span>
                <span>${v.qty}</span>
                <span>${rotLabel}</span>`;

            const editBtn = document.createElement('button');
            editBtn.textContent = '✎'; editBtn.className = 'edit-btn'; editBtn.title = 'Izmeni';
            editBtn.onclick = () => startEdit(row, v);

            const delBtn = document.createElement('button');
            delBtn.textContent = '×'; delBtn.title = 'Ukloni';
            delBtn.onclick = () => {
                for (let i = parts.length - 1; i >= 0; i--) {
                    if (parts[ i ].w === v.w && parts[ i ].h === v.h) parts.splice(i, 1);
                }
                renderParts();
                persistState();
            };

            row.appendChild(editBtn);
            row.appendChild(delBtn);
            list.appendChild(row);
        });
}

function startEdit(row, data) {
    if (row.classList.contains('editing')) return;
    row.classList.add('editing');
    row.innerHTML = '';

    const wIn = document.createElement('input'); wIn.type = 'number'; wIn.value = fmt(data.w, currentUnit); wIn.className = 'small-input'; wIn.min = 0; wIn.step = 'any';
    const hIn = document.createElement('input'); hIn.type = 'number'; hIn.value = fmt(data.h, currentUnit); hIn.className = 'small-input'; hIn.min = 0; hIn.step = 'any';
    const qIn = document.createElement('input'); qIn.type = 'number'; qIn.value = data.qty; qIn.className = 'small-input'; qIn.min = 1;
    const rotSel = document.createElement('select');
    rotSel.innerHTML = '<option value="rot">rot</option><option value="fix">fix</option>';
    rotSel.value = data.allRot ? 'rot' : 'fix';

    row.appendChild(wIn); row.appendChild(hIn); row.appendChild(qIn); row.appendChild(rotSel);

    const saveBtn = document.createElement('button'); saveBtn.textContent = '✔'; saveBtn.className = 'save-btn';
    const cancelBtn = document.createElement('button'); cancelBtn.textContent = '↺'; cancelBtn.className = 'cancel-btn';

    saveBtn.onclick = () => {
        const newWMM = toMM(wIn.value, currentUnit);
        const newHMM = toMM(hIn.value, currentUnit);
        const newQ = +qIn.value;
        const newRot = rotSel.value === 'rot';
        if (!(newWMM > 0 && newHMM > 0 && newQ > 0)) { renderParts(); return; }
        // Validate dimensions fit the board (same rules as addPartBtn)
        const editErr = validateNewPart(newWMM, newHMM);
        if (editErr) {
            let errEl = row.querySelector('.edit-error');
            if (!errEl) {
                errEl = document.createElement('div');
                errEl.className = 'edit-error';
                row.appendChild(errEl);
            }
            errEl.textContent = editErr;
            return;
        }
        for (let i = parts.length - 1, removed = 0; i >= 0 && removed < data.qty; i--) {
            if (parts[ i ].w === data.w && parts[ i ].h === data.h) { parts.splice(i, 1); removed++; }
        }
        addPartMM(newWMM, newHMM, newQ, newRot);
        renderParts();
        persistState();
    };
    cancelBtn.onclick = () => renderParts();

    row.appendChild(saveBtn);
    row.appendChild(cancelBtn);
}

// ── Unit management ────────────────────────────────────────────────────────
function updateUnitLabels() {
    const u = currentUnit;
    document.getElementById('board-fieldset-legend').textContent = `Dimenzije osnovne ploce (${u})`;
    document.getElementById('parts-fieldset-legend').textContent = `Komadi za isecanje (${u})`;
    document.getElementById('partWidth').placeholder = `sirina (${u})`;
    document.getElementById('partHeight').placeholder = `visina (${u})`;
}

function convertBoardInputs(oldUnit, newUnit) {
    [ 'boardWidth', 'boardHeight', 'kerf', 'minWaste' ].forEach(id => {
        const el = document.getElementById(id);
        if (el.value) el.value = fmt(toMM(el.value, oldUnit), newUnit);
    });
}

// ── Persistence ────────────────────────────────────────────────────────────
function persistState() {
    const u = currentUnit;
    const boardSettings = {
        boardWidthMM: toMM(document.getElementById('boardWidth').value, u),
        boardHeightMM: toMM(document.getElementById('boardHeight').value, u),
        kerfMM: toMM(document.getElementById('kerf').value, u),
        minWasteMM: toMM(document.getElementById('minWaste').value, u),
        allowRotate: document.getElementById('allowRotate').checked,
        uniformTexture: document.getElementById('uniformTexture').checked,
        grainAngle: parseInt(document.getElementById('grainAngle').value) || 0,
        strategy: document.getElementById('strategy').value,
        iterations: +document.getElementById('iterations').value || 60,
        optimizeCuts: document.getElementById('optimizeCuts').checked,
    };
    const partsData = Object.values(getGrouped()).map(g => ({
        wMM: g.w, hMM: g.h, qty: g.qty, rotAllowed: g.allRot,
    }));
    save(boardSettings, partsData, u);
}

function loadFromStorage() {
    const state = load();
    if (!state) return false;

    currentUnit = state.unit || 'mm';
    document.getElementById('unit').value = currentUnit;
    updateUnitLabels();

    const s = state.boardSettings;
    document.getElementById('boardWidth').value = fmt(s.boardWidthMM, currentUnit);
    document.getElementById('boardHeight').value = fmt(s.boardHeightMM, currentUnit);
    document.getElementById('kerf').value = fmt(s.kerfMM, currentUnit);
    document.getElementById('minWaste').value = fmt(s.minWasteMM, currentUnit);
    document.getElementById('allowRotate').checked = s.allowRotate;
    document.getElementById('uniformTexture').checked = s.uniformTexture ?? true;
    document.getElementById('grainAngle').value = s.grainAngle ?? 0;
    document.getElementById('strategy').value = s.strategy;
    document.getElementById('iterations').value = s.iterations;
    document.getElementById('optimizeCuts').checked = s.optimizeCuts ?? true;
    toggleIterBox();
    toggleGrainDir();

    for (const p of state.partsData) {
        addPartMM(p.wMM, p.hMM, p.qty, p.rotAllowed);
    }
    return true;
}

// ── Progress bar ───────────────────────────────────────────────────────────
function setProgress(pct) {
    const wrap = document.getElementById('progress-wrap');
    const bar = document.getElementById('progress-bar');
    const label = document.getElementById('progress-pct');
    if (pct <= 0) {
        wrap.hidden = true;
    } else {
        wrap.hidden = false;
        bar.style.width = pct + '%';
        label.textContent = pct + '%';
    }
}

// ── UI helpers ─────────────────────────────────────────────────────────────
function toggleIterBox() {
    document.getElementById('iterBox').style.display =
        document.getElementById('strategy').value === 'advanced' ? '' : 'none';
}

function toggleGrainDir() {
    document.getElementById('grainDirBox').style.display =
        document.getElementById('uniformTexture').checked ? 'none' : '';
}

// ── Event wiring ───────────────────────────────────────────────────────────

// Unit change
document.getElementById('unit').addEventListener('change', e => {
    const newUnit = e.target.value;
    convertBoardInputs(currentUnit, newUnit);
    currentUnit = newUnit;
    updateUnitLabels();
    renderParts();
    persistState();
});

// Strategy toggle
document.getElementById('strategy').addEventListener('change', () => {
    toggleIterBox();
    persistState();
});

// Grain direction visibility
document.getElementById('uniformTexture').addEventListener('change', () => {
    toggleGrainDir();
    updateCanvasStyle();
});

// Live grain-angle update on canvas
document.getElementById('grainAngle').addEventListener('change', updateCanvasStyle);

// Board dimension live preview (input = every keystroke)
[ 'boardWidth', 'boardHeight' ].forEach(id =>
    document.getElementById(id).addEventListener('input', refreshCanvas)
);

// Persist board settings on change
[ 'boardWidth', 'boardHeight', 'kerf', 'minWaste', 'allowRotate', 'uniformTexture', 'grainAngle', 'iterations', 'optimizeCuts' ]
    .forEach(id => document.getElementById(id).addEventListener('change', persistState));

// Add part button
document.getElementById('addPartBtn').addEventListener('click', () => {
    clearError('parts-error');
    const wMM = toMM(document.getElementById('partWidth').value, currentUnit);
    const hMM = toMM(document.getElementById('partHeight').value, currentUnit);
    const qty = +document.getElementById('partQty').value;
    const rot = document.getElementById('partRot').checked;

    const err = validateNewPart(wMM, hMM) ?? (qty < 1 ? 'Kolicina mora biti najmanje 1.' : null);
    if (err) { showError('parts-error', err); return; }

    addPartMM(wMM, hMM, qty, rot);
    renderParts();
    persistState();

    document.getElementById('partWidth').value = '';
    document.getElementById('partHeight').value = '';
    document.getElementById('partQty').value = '1';
    document.getElementById('partWidth').focus();
});

// Enter key in part inputs triggers add
[ 'partWidth', 'partHeight', 'partQty' ].forEach(id => {
    document.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); document.getElementById('addPartBtn').click(); }
    });
});

// ── Batch CSV import ───────────────────────────────────────────────────────

document.getElementById('importCsvBtn').addEventListener('click', () => {
    document.getElementById('importFileInput').click();
});

document.getElementById('importFileInput').addEventListener('change', e => {
    const file = e.target.files[ 0 ];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
        const text = ev.target.result;
        const errors = [];
        let imported = 0;
        const lines = text.split(/\r?\n/);
        for (let li = 0; li < lines.length; li++) {
            const line = lines[ li ].trim();
            if (!line || line.startsWith('#')) continue; // blank / comment
            // Support comma, semicolon, or tab separators
            const cols = line.split(/[;,\t]/).map(c => c.trim());
            const w = parseFloat(cols[ 0 ]);
            const h = parseFloat(cols[ 1 ]);
            if (isNaN(w) || isNaN(h)) continue; // skip header rows
            if (w <= 0 || h <= 0) { errors.push(`Red ${li + 1}: dimenzije moraju biti pozitivne.`); continue; }
            const qty = cols[ 2 ] ? Math.max(1, parseInt(cols[ 2 ]) || 1) : 1;
            const rotRaw = (cols[ 3 ] || 'rot').toLowerCase();
            const rot = [ 'rot', 'da', '1', 'true', 'yes', 'd' ].includes(rotRaw);
            const wMM = toMM(w, currentUnit);
            const hMM = toMM(h, currentUnit);
            const err = validateNewPart(wMM, hMM);
            if (err) { errors.push(`Red ${li + 1} (${w}×${h}): ${err}`); continue; }
            addPartMM(wMM, hMM, qty, rot);
            imported++;
        }
        renderParts();
        persistState();
        clearError('parts-error');
        const infoEl = document.getElementById('parts-info');
        if (errors.length && imported === 0) {
            showError('parts-error', `Uvoz neuspešan: ${errors.join(' | ')}`);
        } else {
            infoEl.textContent = `Uvezeno ${imported} vrsta komada.` +
                (errors.length ? ` (${errors.length} redova preskočeno: ${errors.join('; ')})` : '');
            infoEl.hidden = false;
            setTimeout(() => { infoEl.hidden = true; }, 4000);
        }
        e.target.value = ''; // reset so same file can be re-imported
    };
    reader.readAsText(file);
});

// Optimization form submit
document.getElementById('input-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (isOptimizing) return;
    clearError('board-error');
    clearError('parts-error');

    const boardErr = validateBoard();
    if (boardErr) { showError('board-error', boardErr); return; }
    if (parts.length === 0) { showError('parts-error', 'Dodajte bar jedan komad.'); return; }

    const u = currentUnit;
    const boardW = toMM(document.getElementById('boardWidth').value, u);
    const boardH = toMM(document.getElementById('boardHeight').value, u);
    const kerf = toMM(document.getElementById('kerf').value, u);
    const minWaste = toMM(document.getElementById('minWaste').value, u);
    const allowRotate = document.getElementById('allowRotate').checked;
    const uniformTexture = document.getElementById('uniformTexture').checked;
    const grainAngle = parseInt(document.getElementById('grainAngle').value) || 0;
    const strategy = document.getElementById('strategy').value;
    const iterations = Math.min(+document.getElementById('iterations').value || 60, 500);
    const optimizeCuts = document.getElementById('optimizeCuts').checked;

    isOptimizing = true;
    const submitBtn = e.target.querySelector('[type=submit]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Optimizujem…';
    setProgress(1);

    try {
        const res = await packAll(boardW, boardH, kerf, allowRotate, minWaste, strategy, iterations, parts, optimizeCuts, uniformTexture, setProgress);
        drawBoards(res, boardW, boardH, u, dimensionColors, !uniformTexture, optimizeCuts, grainAngle);
        updateStats(res, u);
        showingResult = true;
        window.currentResult = { res, boardW, boardH, kerf, minWaste, allowRotate, strategy, iterations, parts: [ ...parts ] };
    } finally {
        isOptimizing = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Optimizuj';
        setProgress(0);
    }

    persistState();
});

// Export JSON
document.getElementById('exportJsonBtn').addEventListener('click', () => {
    if (!window.currentResult) return;
    const blob = new Blob([ JSON.stringify(window.currentResult, null, 2) ], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'krojac_rezultat.json';
    a.click();
});

// Print
document.getElementById('printBtn').addEventListener('click', () => window.print());

// Reset
document.getElementById('resetBtn').addEventListener('click', () => {
    parts.length = 0;
    seq = 1;
    for (const k in dimensionColors) delete dimensionColors[ k ];
    renderParts();
    document.getElementById('stats').innerHTML = '';
    clearError('board-error');
    clearError('parts-error');
    clear();
    window.currentResult = null;
    showingResult = false;
    refreshCanvas();
});

// ── Init ───────────────────────────────────────────────────────────────────
toggleIterBox();
toggleGrainDir();
updateUnitLabels();

if (!loadFromStorage()) {
    // Default demo parts
    addPartMM(500, 400, 4, true);
    addPartMM(600, 300, 6, true);
    addPartMM(350, 450, 8, false);
}
renderParts();
refreshCanvas();
