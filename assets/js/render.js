// Canvas rendering and stats DOM updates
import { fmt } from './units.js';

// Module-level reactive state — updated by drawBoards and drawPreviewBoard
let _liveState = null;

/**
 * Update the display options of the currently shown canvas(es) and redraw.
 * Returns true if there was a live canvas to update, false otherwise.
 */
export function updateLiveCanvas(patch) {
    if (!_liveState) return false;
    Object.assign(_liveState.state, patch);
    _liveState.redrawers.forEach(fn => fn());
    return true;
}

// ── Grain/texture drawing ──────────────────────────────────────────────────

/**
 * Pre-compute grain line positions starting from (originX, originY).
 * vertical=false → horizontal lines (varying y); vertical=true → vertical lines (varying x).
 * maxDist  — extent in the cross-direction (bh for h-lines, bw for v-lines).
 * boardSpan — length of each line          (bw for h-lines, bh for v-lines).
 * Lines are sorted ascending by position so paintGrain can break early.
 */
function buildGrain(originX, originY, maxDist, boardSpan, vertical) {
    let rng = 0x5f375a86;
    const rand = () => { rng = (Math.imul(rng, 1664525) + 1013904223) | 0; return (rng >>> 0) / 0x100000000; };
    const lines = [];
    for (let pos = 0; pos < maxDist;) {
        const gap = 4 + rand() * 6;
        lines.push({ at: pos, alpha: 0.032 + rand() * 0.088, lw: 0.45 + rand() * 1.1 });
        pos += gap;
    }
    return { lines, originX, originY, span: boardSpan, vertical };
}

/**
 * Paint grain from a pre-built pattern, clipped to (cx,cy,cw,ch).
 * Because lines originate at the board corner, grain is continuous across all pieces.
 * alphaMult scales opacity: 1.0 for board background, <1 for piece overlay.
 */
function paintGrain(ctx, grain, cx, cy, cw, ch, alphaMult) {
    ctx.save();
    ctx.beginPath(); ctx.rect(cx, cy, cw, ch); ctx.clip();
    for (const l of grain.lines) {
        const at = (grain.vertical ? grain.originX : grain.originY) + l.at;
        const alpha = Math.min(1, l.alpha * alphaMult).toFixed(3);
        ctx.strokeStyle = `rgba(100,50,8,${alpha})`;
        ctx.lineWidth = l.lw;
        ctx.beginPath();
        if (grain.vertical) {
            if (at > cx + cw) break;
            if (at < cx - 1) continue;
            ctx.moveTo(at, grain.originY);
            ctx.lineTo(at, grain.originY + grain.span);
        } else {
            if (at > cy + ch) break;
            if (at < cy - 1) continue;
            ctx.moveTo(grain.originX, at);
            ctx.lineTo(grain.originX + grain.span, at);
        }
        ctx.stroke();
    }
    ctx.restore();
}

// ── Board content drawing ──────────────────────────────────────────────────

/**
 * Render one board into ctx at the given zoom/pan transform.
 * baseScale = canvas-pixels per mm at zoom=1 pan=0.
 * showTexture = true → draw wood grain on board + pieces;
 *               rotated pieces get perpendicular grain (warm tint as directional warning).
 */
function drawBoardContent(ctx, cw, ch, zoom, panX, panY, baseScale,
    board, boardW, boardH, unit, showTexture, showCuts, grainAngle) {
    ctx.clearRect(0, 0, cw, ch);
    ctx.save();
    ctx.translate(panX, panY);
    ctx.scale(zoom, zoom);

    const OFF = 10;
    const bw = boardW * baseScale;
    const bh = boardH * baseScale;

    // Grain patterns — origin at board corner so grain flows continuously across all pieces.
    // grainAngle 0 = horizontal lines, 90 = vertical lines.
    const grainV = showTexture && (grainAngle === 90);
    const grain = showTexture ? buildGrain(OFF, OFF, grainV ? bw : bh, grainV ? bh : bw, grainV) : null;
    const grainPerp = showTexture ? buildGrain(OFF, OFF, grainV ? bh : bw, grainV ? bw : bh, !grainV) : null;

    // Board background
    if (showTexture) {
        ctx.fillStyle = '#edd9a3';
        ctx.fillRect(OFF, OFF, bw, bh);
        paintGrain(ctx, grain, OFF, OFF, bw, bh, 1.0);
    } else {
        ctx.fillStyle = '#f9fafb';
        ctx.fillRect(OFF, OFF, bw, bh);
    }

    // Board border
    ctx.strokeStyle = '#1f2933';
    ctx.lineWidth = 1.5 / zoom;
    ctx.strokeRect(OFF, OFF, bw, bh);

    ctx.font = `${Math.max(7, 9 / zoom)}px system-ui`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    board.placements.forEach(p => {
        const px = OFF + p.x * baseScale;
        const py = OFF + p.y * baseScale;
        const pw = p.w * baseScale;
        const ph = p.h * baseScale;

        ctx.fillStyle = p.color;
        ctx.fillRect(px, py, pw, ph);

        if (showTexture) {
            if (p.rot) {
                // Rotated piece: perpendicular grain + warm tint = directional mismatch warning
                ctx.fillStyle = 'rgba(155,78,8,0.09)';
                ctx.fillRect(px, py, pw, ph);
                paintGrain(ctx, grainPerp, px, py, pw, ph, 0.85);
            } else {
                paintGrain(ctx, grain, px, py, pw, ph, 0.6);
            }
        }

        ctx.strokeStyle = 'rgba(0,0,0,.38)';
        ctx.lineWidth = 0.8 / zoom;
        ctx.strokeRect(px, py, pw, ph);

        const label = `${fmt(p.w, unit)}×${fmt(p.h, unit)}${p.rot ? '*' : ''}`;
        if (pw > 28 / zoom && ph > 13 / zoom) {
            ctx.fillStyle = 'rgba(0,0,0,0.78)';
            ctx.fillText(label, px + pw / 2, py + ph / 2);
        }
    });

    // Cut guide lines for panel-saw workflow
    if (showCuts && board.placements.length > 0) {
        const yLines = new Set();
        const xLines = new Set();
        board.placements.forEach(p => {
            const yBot = Math.round(p.y + p.h);
            const xRight = Math.round(p.x + p.w);
            if (yBot < boardH - 1) yLines.add(yBot);
            if (xRight < boardW - 1) xLines.add(xRight);
        });
        ctx.save();
        ctx.lineWidth = 1.2 / zoom;
        ctx.setLineDash([ 5 / zoom, 3 / zoom ]);
        ctx.strokeStyle = 'rgba(30, 100, 220, 0.65)';
        for (const y of yLines) {
            const ky = OFF + y * baseScale;
            ctx.beginPath(); ctx.moveTo(OFF, ky); ctx.lineTo(OFF + bw, ky); ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(200, 90, 0, 0.55)';
        for (const x of xLines) {
            const kx = OFF + x * baseScale;
            ctx.beginPath(); ctx.moveTo(kx, OFF); ctx.lineTo(kx, OFF + bh); ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.restore();
    }

    ctx.restore();
}

// ── Canvas interactivity ──────────────────────────────────────────────────

// Single shared tooltip element, lazily created once
let _tooltip = null;
function getTooltip() {
    if (!_tooltip) {
        _tooltip = document.createElement('div');
        _tooltip.className = 'canvas-tooltip';
        _tooltip.hidden = true;
        document.body.appendChild(_tooltip);
    }
    return _tooltip;
}

/**
 * Attach zoom (scroll), pan (drag), hover-tooltip, and double-click-reset to a canvas.
 * Uses Pointer Capture API — drag continues outside canvas bounds without leaking
 * global document/window listeners.
 */
function makeInteractive(canvas, baseScale, board, boardW, boardH, unit, getOpts) {
    const CW = canvas.width;
    const CH = canvas.height;
    let zoom = 1, panX = 0, panY = 0;
    let dragging = false, lastMX = 0, lastMY = 0;

    const ctx = canvas.getContext('2d');
    const tooltip = getTooltip();

    function redraw() {
        const { showTexture, showCuts, grainAngle } = getOpts();
        drawBoardContent(ctx, CW, CH, zoom, panX, panY, baseScale,
            board, boardW, boardH, unit, showTexture, showCuts, grainAngle);
    }

    // Convert client coords → canvas pixel coords (accounts for CSS scaling)
    function canvasPt(e) {
        const r = canvas.getBoundingClientRect();
        return {
            cx: (e.clientX - r.left) * (CW / r.width),
            cy: (e.clientY - r.top) * (CH / r.height),
        };
    }

    // Return the placement under canvas point, or null
    function hitTest(cx, cy) {
        const OFF = 10;
        const bx = ((cx - panX) / zoom - OFF) / baseScale;
        const by = ((cy - panY) / zoom - OFF) / baseScale;
        for (const p of board.placements) {
            if (bx >= p.x && bx <= p.x + p.w && by >= p.y && by <= p.y + p.h) return p;
        }
        return null;
    }

    // Scroll → zoom centered on cursor
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const { cx, cy } = canvasPt(e);
        const factor = e.deltaY > 0 ? 1.13 : 1 / 1.13;
        const nz = Math.max(0.4, Math.min(10, zoom * factor));
        panX = cx - (cx - panX) * (nz / zoom);
        panY = cy - (cy - panY) * (nz / zoom);
        zoom = nz;
        redraw();
    }, { passive: false });

    // Double-click → reset view
    canvas.addEventListener('dblclick', () => {
        zoom = 1; panX = 0; panY = 0;
        redraw();
    });

    // Pointer capture: drag-pan works even when cursor leaves canvas
    canvas.addEventListener('pointerdown', e => {
        canvas.setPointerCapture(e.pointerId);
        dragging = true;
        lastMX = e.clientX; lastMY = e.clientY;
        canvas.style.cursor = 'grabbing';
        tooltip.hidden = true;
    });

    canvas.addEventListener('pointerup', e => {
        canvas.releasePointerCapture(e.pointerId);
        dragging = false;
        canvas.style.cursor = 'crosshair';
    });

    canvas.addEventListener('pointermove', e => {
        if (dragging) {
            const r = canvas.getBoundingClientRect();
            panX += (e.clientX - lastMX) * (CW / r.width);
            panY += (e.clientY - lastMY) * (CH / r.height);
            lastMX = e.clientX; lastMY = e.clientY;
            redraw();
            return;
        }
        // Hover: show piece tooltip
        const { cx, cy } = canvasPt(e);
        const hit = hitTest(cx, cy);
        if (hit) {
            tooltip.hidden = false;
            const rotNote = hit.rot
                ? '<br><em class="tooltip-rot">↻ Rotiran — žica ide poprečno</em>'
                : '';
            tooltip.innerHTML =
                `<strong>${fmt(hit.origW, unit)}×${fmt(hit.origH, unit)} ${unit}</strong>` +
                rotNote +
                `<br>Pos: ${fmt(hit.x, unit)}, ${fmt(hit.y, unit)} ${unit}` +
                `<br>Površina: ${(hit.w * hit.h / 1e6).toFixed(4)} m²`;
            tooltip.style.left = Math.min(e.clientX + 16, window.innerWidth - 220) + 'px';
            tooltip.style.top = Math.max(8, e.clientY - 10) + 'px';
        } else {
            tooltip.hidden = true;
        }
    });

    canvas.addEventListener('pointerleave', () => { tooltip.hidden = true; });

    canvas.style.cursor = 'crosshair';
    redraw();
    return redraw;
}

// ── Preview board (shown on load, reset, dimension change) ─────────────────

/**
 * Draw a single empty board in #boards as a live-interactive preview.
 * Called before any optimisation run, and whenever board dimensions change.
 * Replaces any existing canvas content.
 */
export function drawPreviewBoard(boardW, boardH, unit, showTexture, grainAngle) {
    if (!(boardW > 0 && boardH > 0)) return;
    const container = document.getElementById('boards');
    container.innerHTML = '';
    getTooltip().hidden = true;
    document.getElementById('legend').innerHTML = '';

    const CW = 700, CH = 480;
    const baseScale = Math.min((CW - 20) / boardW, (CH - 20) / boardH);

    const canvas = document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    canvas.className = 'board-canvas';
    container.appendChild(canvas);

    const hint = document.createElement('div');
    hint.className = 'canvas-hint';
    hint.textContent = 'Pregled ploče — pokrenite Optimizuj za raspored komada';
    container.appendChild(hint);

    const state = { showTexture, showCuts: false, grainAngle };
    const emptyBoard = { placements: [], freeRects: [] };
    const redraw = makeInteractive(canvas, baseScale, emptyBoard, boardW, boardH, unit, () => state);
    _liveState = { state, redrawers: [ redraw ] };
}

/**
 * @param {boolean} showTexture — true when board has directional grain/pattern
 *   (i.e. the "Jednobojna ploča" checkbox is NOT checked)
 */
export function drawBoards(result, boardW, boardH, unit, dimensionColors, showTexture, showCuts, grainAngle) {
    const container = document.getElementById('boards');
    container.innerHTML = '';
    getTooltip().hidden = true;
    const legend = document.getElementById('legend');
    legend.innerHTML = '';
    const uniqueDims = {};
    const state = { showTexture, showCuts, grainAngle };
    const redrawers = [];
    function redrawAll() { redrawers.forEach(fn => fn()); }

    result.boards.forEach((board, index) => {
        const wrap = document.createElement('div');
        wrap.className = 'board-wrap';

        const title = document.createElement('h3');
        title.textContent = `Tabla ${index + 1}`;
        wrap.appendChild(title);

        // Fixed canvas resolution 700×480; CSS scales it via max-width:100%
        const CW = 700, CH = 480;
        const baseScale = Math.min((CW - 20) / boardW, (CH - 20) / boardH);

        const canvas = document.createElement('canvas');
        canvas.width = CW;
        canvas.height = CH;
        canvas.className = 'board-canvas';
        wrap.appendChild(canvas);

        const hint = document.createElement('div');
        hint.className = 'canvas-hint';
        hint.textContent = 'točkić = zum  ·  prevuci = pomeraj  ·  2× klik = reset  ·  prelazak = detalji';
        wrap.appendChild(hint);

        board.placements.forEach(p => {
            const key = `${p.origW}x${p.origH}`;
            if (!uniqueDims[ key ]) {
                uniqueDims[ key ] = {
                    color: dimensionColors[ key ] || p.color,
                    dim: `${fmt(p.origW, unit)}×${fmt(p.origH, unit)} ${unit}`,
                    count: 0,
                };
            }
            uniqueDims[ key ].count++;
        });

        const usedPercent = (board.usedArea / (boardW * boardH) * 100).toFixed(1);
        const meta = document.createElement('div');
        meta.className = 'board-meta';

        // Offcut reporting: free rects large enough to be reusable
        const MIN_OFFCUT = 150;
        const offcuts = (board.freeRects || [])
            .filter(r => r.w >= MIN_OFFCUT && r.h >= MIN_OFFCUT)
            .sort((a, b) => b.w * b.h - a.w * a.h)
            .slice(0, 4);
        const offcutHTML = offcuts.length
            ? `<br><span class="offcut-label">Korisni ostaci:</span> ${offcuts.map(r =>
                `${Math.round(r.w)}×${Math.round(r.h)}`).join(', ')}`
            : '';

        // Count unique cut lines per board (independent of showCuts visual toggle).
        // Each unique y+h value = one horizontal (rip) pass across the full width.
        // Each unique x+w value = one vertical (cross) cut.
        // Board edges are not cuts — exclude values equal to board dimensions.
        const hCutSet = new Set(board.placements.map(p => Math.round(p.y + p.h)));
        hCutSet.delete(Math.round(boardH));
        const hCuts = hCutSet.size;

        const vCutSet = new Set(board.placements.map(p => Math.round(p.x + p.w)));
        vCutSet.delete(Math.round(boardW));
        const vCuts = vCutSet.size;

        const totalCuts = hCuts + vCuts;
        const cutsHTML = board.placements.length > 0
            ? `<br><span class="cuts-summary">✂ <strong>${totalCuts}</strong> ${totalCuts === 1 ? 'rez' : totalCuts <= 4 ? 'reza' : 'rezova'} &nbsp;`
            + `<span class="cuts-detail">(${hCuts} horizontalni + ${vCuts} vertikalni)</span></span>`
            : '';

        meta.innerHTML = `Iskorišćenje: <strong>${usedPercent}%</strong> (${(board.usedArea / 1e6).toFixed(4)} m²)${offcutHTML}${cutsHTML}`;
        wrap.appendChild(meta);
        container.appendChild(wrap);

        redrawers.push(makeInteractive(canvas, baseScale, board, boardW, boardH, unit, () => state));
    });

    // Expose live state so external code can patch texture/cuts/grain without re-running
    _liveState = { state, redrawers };

    Object.values(uniqueDims)
        .sort((a, b) => b.count - a.count)
        .forEach(d => {
            const div = document.createElement('div');
            div.className = 'item';
            div.innerHTML = `<span class="swatch" style="background:${d.color}"></span>${d.dim} (${d.count})`;
            legend.appendChild(div);
        });

    // Live-toggle controls — texture and cut lines can be shown/hidden without re-running
    if (showTexture || showCuts) {
        const controls = document.createElement('div');
        controls.className = 'legend-controls';
        const mkToggle = (labelHTML, onChange) => {
            const lbl = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = true;
            cb.addEventListener('change', () => onChange(cb.checked));
            lbl.appendChild(cb);
            const sp = document.createElement('span');
            sp.innerHTML = ' ' + labelHTML;
            lbl.appendChild(sp);
            return lbl;
        };
        if (showTexture) controls.appendChild(mkToggle(
            'Šare <em style="color:#8b4513">(kose = rotirani komad)</em>',
            v => { state.showTexture = v; redrawAll(); }
        ));
        if (showCuts) controls.appendChild(mkToggle(
            '<span style="color:rgba(30,100,220,.9);font-weight:600">━━</span>' +
            ' <span style="color:rgba(200,90,0,.9);font-weight:600">━━</span> Rezovi',
            v => { state.showCuts = v; redrawAll(); }
        ));
        legend.appendChild(controls);
    }
}

export function updateStats(result, unit) {
    const el = document.getElementById('stats');
    const boardsCount = result.boards.length;
    const totalBoardArea = boardsCount * result.boardArea;
    const percent = (result.totalUsed / totalBoardArea * 100).toFixed(2);
    const unplaced = result.remaining.length;

    // Build detailed list of unplaced pieces grouped by dimension
    let unplacedHTML = '';
    if (unplaced > 0) {
        const groups = {};
        for (const p of result.remaining) {
            const key = `${p.w}×${p.h}`;
            groups[ key ] = (groups[ key ] || 0) + 1;
        }
        const detail = Object.entries(groups)
            .map(([ dim, qty ]) => qty > 1 ? `${dim} (×${qty})` : dim)
            .join(', ');
        unplacedHTML = ` <span class="warn">⚠ Nisu postavljeni: ${detail}</span>`;
    }

    // Aggregate offcut summary across all boards
    const MIN_OFFCUT = 150;
    let totalOffcuts = 0;
    for (const b of result.boards) {
        totalOffcuts += (b.freeRects || []).filter(r => r.w >= MIN_OFFCUT && r.h >= MIN_OFFCUT).length;
    }
    const offcutSummary = totalOffcuts > 0
        ? `<br>Korisnih ostataka: <strong>${totalOffcuts}</strong> (prikazani ispod svake table)`
        : '';

    el.innerHTML =
        `<strong>Ukupno tabli:</strong> ${boardsCount}<br>` +
        `<strong>Ukupno iskorišćenje:</strong> ${percent}%<br>` +
        `Utrošen materijal: ${(result.totalUsed / 1e6).toFixed(4)} m² / ${(totalBoardArea / 1e6).toFixed(4)} m²<br>` +
        `Nepostavljeni komadi: ${unplaced}${unplacedHTML}` +
        offcutSummary;
}
