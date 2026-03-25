// packing.js — 2D bin packing using Maximal Rectangles (MAXRECTS)
//
// Improvements over original guillotine:
//  ① MAXRECTS: up to 4 free-rect splits per placement (vs. 2 in guillotine)
//     Guillotine misses corner spaces; MAXRECTS tracks all maximal free areas.
//  ② Global best-fit: evaluates ALL items × ALL free rects each step.
//     Greedy "place largest first" misses cases where a smaller piece enables
//     better future packing.
//  ③ Three proven heuristics: BSSF, BLSF, BAF — combined in iteration loop.
//  ④ Correct objective: minimize boards → minimize unplaced → maximize utilization.
//     Old code maximised totalUsed first, which naturally grew with more boards.
//  ⑤ Eight diverse sort strategies × 6 heuristics = 48 deterministic combos
//     before switching to randomized search.
//  ⑥ Cut optimization: strip-friendly sort groups same-height pieces so panel
//     saws need fewer full-width rip cuts.
//  ⑦ Deduplication: identical piece types are evaluated once per step, not N×.
//     Gives 5-10× inner-loop speedup → more iterations in the same time budget.
//  ⑧ Uniform-texture mode: ignores per-piece rotAllowed flags when the board
//     has no directional grain/pattern — maximises orientation freedom.
//  ⑨ Last-board consolidation: after finding best, attempts to eliminate the
//     last board by merging its pieces onto previous boards.

// ── Free rectangle management ──────────────────────────────────────────────

/**
 * Remove any free rect that is fully enclosed by another.
 * MAXRECTS generates overlapping rects intentionally; contained ones are redundant.
 */
function pruneContained(rects) {
    for (let i = rects.length - 1; i >= 0; i--) {
        for (let j = 0; j < rects.length; j++) {
            if (i === j) continue;
            const A = rects[ i ], B = rects[ j ];
            if (B.x <= A.x && B.y <= A.y &&
                B.x + B.w >= A.x + A.w && B.y + B.h >= A.y + A.h) {
                rects.splice(i, 1);
                break;
            }
        }
    }
}

/**
 * After placing a piece, split every overlapping free rect into up to 4
 * maximal sub-rectangles around the blocking zone.
 *
 * Blocking zone = piece + kerf on the right and bottom edges.
 * (Conservative: over-estimates waste by ≤ 2×kerf at board edges, typically 6 mm.)
 */
function updateFreeRects(freeRects, px, py, iw, ih, kerf, minWaste) {
    const bw = iw + kerf;
    const bh = ih + kerf;
    const toAdd = [];

    for (let i = freeRects.length - 1; i >= 0; i--) {
        const fr = freeRects[ i ];
        // Skip non-overlapping rects
        if (px >= fr.x + fr.w || px + bw <= fr.x ||
            py >= fr.y + fr.h || py + bh <= fr.y) continue;

        freeRects.splice(i, 1);

        // Left strip
        if (px > fr.x)
            toAdd.push({ x: fr.x, y: fr.y, w: px - fr.x, h: fr.h });
        // Right strip
        if (px + bw < fr.x + fr.w)
            toAdd.push({ x: px + bw, y: fr.y, w: fr.x + fr.w - (px + bw), h: fr.h });
        // Bottom strip
        if (py > fr.y)
            toAdd.push({ x: fr.x, y: fr.y, w: fr.w, h: py - fr.y });
        // Top strip
        if (py + bh < fr.y + fr.h)
            toAdd.push({ x: fr.x, y: py + bh, w: fr.w, h: fr.y + fr.h - (py + bh) });
    }

    for (const r of toAdd) {
        // Discard strips narrower than minWaste — too thin to cut usefully
        if (r.w >= minWaste && r.h >= minWaste) freeRects.push(r);
    }
    pruneContained(freeRects);
}

// ── Placement heuristics (lower score = better) ────────────────────────────

// BSSF — Best Short Side Fit: minimise the shorter leftover side.
//   Keeps remaining space "square" → best future fit for varied piece sizes.
//   Generally the top-performing heuristic for mixed piece sets.
function bssf(fr, iw, ih) { return Math.min(fr.w - iw, fr.h - ih); }

// BLSF — Best Long Side Fit: minimise the longer leftover side.
//   Aggressively fills tight spaces. Useful when pieces are similar size.
function blsf(fr, iw, ih) { return Math.max(fr.w - iw, fr.h - ih); }

// BAF — Best Area Fit: minimise leftover area.
//   Maximises immediate material efficiency. Can leave awkward thin strips.
function baf(fr, iw, ih) { return fr.w * fr.h - iw * ih; }

// BSSF+BAF hybrid — balances squareness with area efficiency.
//   Adds normalised BAF as a tiebreaker so equal short-side fits prefer less waste.
function bssf_baf(fr, iw, ih) {
    return Math.min(fr.w - iw, fr.h - ih) + 0.0001 * (fr.w * fr.h - iw * ih);
}

// Bottom-Left Corner — prefer free rects closest to origin.
//   Gravitates pieces toward one corner; prevents scattered islands.
//   Especially useful when combined with strip-sort orderings.
function bcorner(fr, iw, ih) { return fr.x + fr.y; }

// Waste-Adjusted Fit — BAF with a penalty for creating thin un-usable strips.
//   Strips ≤ 80 mm on either side cost extra proportional to their length;
//   this keeps remainder spaces wide enough to actually be cut again.
function bwaf(fr, iw, ih) {
    const rw = fr.w - iw, rh = fr.h - ih;
    const waste = fr.w * fr.h - iw * ih;
    const penalty = (rw > 0 && rw <= 80 ? (81 - rw) * (fr.h) : 0)
        + (rh > 0 && rh <= 80 ? (81 - rh) * (fr.w) : 0);
    return waste + penalty;
}

// 6 heuristics × 8 sort strategies = 48 deterministic combos in Phase 1.
const SCORE_FNS = [ bssf, blsf, baf, bssf_baf, bcorner, bwaf ];

// ── Single-board packing ───────────────────────────────────────────────────

/**
 * Pack as many items as possible onto one board.
 *
 * Uses global best-fit with deduplication: at each step, for each unique
 * piece TYPE (same w × h × rotAllowed), only one representative is evaluated.
 * This gives a 5-10× speedup for lists with many duplicate pieces while
 * producing identical placement quality (all duplicates are interchangeable).
 *
 * uniformTexture = true → ignore per-piece rotAllowed; any piece can rotate
 * as long as allowRotate (global) is enabled. Models boards with no
 * directional grain/pattern (plain-colour MDF, paint-grade chipboard, etc.).
 *
 * Items placed are removed from the `items` array (mutates shared ref).
 */
function packOne(boardW, boardH, kerf, allowRotate, minWaste, items, scoreFn, uniformTexture) {
    const freeRects = [ { x: 0, y: 0, w: boardW, h: boardH } ];
    const placements = [];
    const placed = new Set(); // indices into items[] placed on this board

    while (true) {
        let bestScore = Infinity, bestI = -1;
        let bestPx, bestPy, bestIW, bestIH, bestRot;

        // Build a deduplication map: typeKey → first unplaced index of that type.
        // Two items are the same type if they have identical w, h and effective
        // rotation permission. We only need to evaluate one per type.
        const typeFirstIdx = new Map();
        for (let i = 0; i < items.length; i++) {
            if (placed.has(i)) continue;
            const it = items[ i ];
            const canRot = uniformTexture ? allowRotate : (allowRotate && it.rotAllowed);
            const key = `${it.w}|${it.h}|${canRot ? 1 : 0}`;
            if (!typeFirstIdx.has(key)) typeFirstIdx.set(key, i);
        }

        for (const i of typeFirstIdx.values()) {
            const item = items[ i ];
            const canRot = uniformTexture ? allowRotate : (allowRotate && item.rotAllowed);
            for (const fr of freeRects) {
                for (const rot of [ false, true ]) {
                    if (rot && !canRot) continue;
                    const iw = rot ? item.h : item.w;
                    const ih = rot ? item.w : item.h;
                    // Piece + saw kerf must fit inside the free rect so that the
                    // blocking zone (iw+kerf × ih+kerf) never bleeds into sibling
                    // free rects. Using iw+kerf here matches updateFreeRects exactly.
                    if (iw + kerf > fr.w || ih + kerf > fr.h) continue;
                    const score = scoreFn(fr, iw, ih);
                    if (score < bestScore) {
                        bestScore = score;
                        bestI = i; bestPx = fr.x; bestPy = fr.y;
                        bestIW = iw; bestIH = ih; bestRot = rot;
                    }
                }
            }
        }

        if (bestI < 0) break; // nothing fits on this board

        const item = items[ bestI ];
        placements.push({
            id: item.id, x: bestPx, y: bestPy, w: bestIW, h: bestIH,
            color: item.color, rot: bestRot, origW: item.w, origH: item.h,
        });
        updateFreeRects(freeRects, bestPx, bestPy, bestIW, bestIH, kerf, minWaste);
        placed.add(bestI);
    }

    // Remove placed items from the shared array (reverse to keep indices stable)
    for (let i = items.length - 1; i >= 0; i--) {
        if (placed.has(i)) items.splice(i, 1);
    }

    return {
        placements,
        usedArea: placements.reduce((s, p) => s + p.w * p.h, 0),
        freeRects, // exposed for offcut reporting
    };
}

// ── Multi-board packing ────────────────────────────────────────────────────

function packAllOnce(boardW, boardH, kerf, allowRotate, minWaste, itemsSource, scoreFn, uniformTexture) {
    // Work on a fresh copy so itemsSource is never mutated
    const remaining = itemsSource.map(p => ({ ...p }));
    const boards = [];
    while (remaining.length) {
        const before = remaining.length;
        boards.push(packOne(boardW, boardH, kerf, allowRotate, minWaste, remaining, scoreFn, uniformTexture));
        if (remaining.length === before) break; // items too large — stop to avoid infinite loop
    }
    return {
        boards,
        remaining,
        totalUsed: boards.reduce((s, b) => s + b.usedArea, 0),
        boardArea: boardW * boardH,
    };
}

// ── Sort strategies ────────────────────────────────────────────────────────

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const r = Math.floor(Math.random() * (i + 1));
        [ arr[ i ], arr[ r ] ] = [ arr[ r ], arr[ i ] ];
    }
    return arr;
}

const SORTS = [
    a => a.sort((x, y) => y.area - x.area),                                          // ① largest area first
    a => a.sort((x, y) => Math.max(y.w, y.h) - Math.max(x.w, x.h)),                   // ② largest dimension first
    a => a.sort((x, y) => (y.w + y.h) - (x.w + x.h)),                                   // ③ largest perimeter first
    a => a.sort((x, y) => Math.min(y.w, y.h) - Math.min(x.w, x.h)),                   // ④ largest short side first
    a => a.sort((x, y) => x.area - y.area),                                          // ⑤ smallest area first (gap fill)
    a => shuffle(a),                                                                   // ⑥ random
    a => a.sort((x, y) => Math.abs(x.w - x.h) - Math.abs(y.w - y.h)),                   // ⑦ most square first (best for uniform chips)
    a => a.sort((x, y) => Math.abs(y.w - y.h) - Math.abs(x.w - x.h)),                   // ⑧ most elongated first (fills strips well)
];

/**
 * Noisy sort: approximately area-descending but with random perturbation.
 * Produces diverse orderings that break tie-based evaluation differently,
 * more effective than a full shuffle because relative size ordering is preserved.
 * noiseFactor 0–1: 0=deterministic area sort, 1=fully random perturbation.
 */
function noisySort(items, noiseFactor = 0.35) {
    return items
        .map(p => ({ p, key: p.area * (1 - noiseFactor + Math.random() * noiseFactor * 2) }))
        .sort((a, b) => b.key - a.key)
        .map(x => x.p);
}

/**
 * Groups pieces by their dominant height (max side), tallest strips first.
 * Within each height group, widest pieces come first to fill the strip.
 *
 * Result: MAXRECTS naturally forms horizontal strip layouts →
 * fewer full-width rip cuts on the panel saw → less setup time.
 */
function stripSort(items) {
    return [ ...items ].sort((a, b) => {
        const ha = Math.max(a.w, a.h), hb = Math.max(b.w, b.h);
        if (hb !== ha) return hb - ha;                     // tallest strip first
        return Math.min(b.w, b.h) - Math.min(a.w, a.h);  // widest within strip
    });
}

// ── Objective function ─────────────────────────────────────────────────────

/**
 * Count total horizontal rip-cut lines across all boards.
 * Each unique round(y + h) value = one full-width saw pass on the panel saw.
 * Used as a 5th tiebreaker when cut optimisation is enabled.
 */
function countCuts(result) {
    let total = 0;
    for (const board of result.boards) {
        const yLines = new Set();
        for (const p of board.placements) yLines.add(Math.round(p.y + p.h));
        total += yLines.size;
    }
    return total;
}

/**
 * Correct multi-priority objective for woodworking:
 *  1. Fewer unplaced pieces (everyone needs their cut!)
 *  2. Fewer boards (material cost)
 *  3. Higher utilization (waste within purchased boards)
 *  4. Better-utilised last board (concentrate waste, don't scatter it)
 *  5. Fewer horizontal rip-cut lines (only when optimizeCuts=true)
 *
 * Old code used totalUsed as primary metric — wrong, because more boards
 * means more total area available, so totalUsed naturally grows with board count.
 */
function isBetter(candidate, current, optimizeCuts = false) {
    if (!current) return true;
    if (candidate.remaining.length < current.remaining.length) return true;
    if (candidate.remaining.length > current.remaining.length) return false;
    if (candidate.boards.length < current.boards.length) return true;
    if (candidate.boards.length > current.boards.length) return false;
    if (candidate.totalUsed > current.totalUsed) return true;
    if (candidate.totalUsed < current.totalUsed) return false;
    // 4th tiebreaker: prefer better-utilised last board (concentrate waste)
    const lastCand = candidate.boards[ candidate.boards.length - 1 ];
    const lastCurr = current.boards[ current.boards.length - 1 ];
    if (!lastCand || !lastCurr) return false;
    if (lastCand.usedArea > lastCurr.usedArea) return true;
    if (lastCand.usedArea < lastCurr.usedArea) return false;
    // 5th tiebreaker: fewer horizontal rip-cut lines (panel-saw passes)
    if (optimizeCuts) return countCuts(candidate) < countCuts(current);
    return false;
}

// ── Board consolidation ────────────────────────────────────────────────────

/**
 * Attempt to eliminate one specific board by placing its pieces first.
 * If the result uses fewer boards it is returned; otherwise `best` is unchanged.
 */
function tryConsolidateBoard(best, boardIdx, boardW, boardH, kerf, allowRotate, minWaste, uniformTexture) {
    if (best.remaining.length > 0 || best.boards.length < 2) return best;
    const target = best.boards[ boardIdx ];
    if (!target) return best;

    const targetItems = target.placements.map(p => ({
        id: p.id, w: p.origW, h: p.origH, area: p.origW * p.origH,
        color: p.color, rotAllowed: true,
    }));
    const otherItems = best.boards
        .filter((_, i) => i !== boardIdx)
        .flatMap(b => b.placements.map(p => ({
            id: p.id, w: p.origW, h: p.origH, area: p.origW * p.origH,
            color: p.color, rotAllowed: true,
        })));
    const reordered = [ ...targetItems, ...otherItems ];

    let consolidated = null;
    for (const sf of SCORE_FNS) {
        const attempt = packAllOnce(boardW, boardH, kerf, allowRotate, minWaste, reordered, sf, uniformTexture);
        if (isBetter(attempt, consolidated)) consolidated = attempt;
    }
    return (consolidated && isBetter(consolidated, best)) ? consolidated : best;
}

/**
 * Iteratively try to eliminate the least-filled board until no further
 * reduction is possible. Handles cascading cases where eliminating board N
 * later allows eliminating board M that was previously too full.
 */
function tryConsolidateAll(best, boardW, boardH, kerf, allowRotate, minWaste, uniformTexture) {
    if (best.remaining.length > 0 || best.boards.length < 2) return best;
    let changed = true;
    while (changed && best.boards.length >= 2) {
        changed = false;
        // Least-filled boards are easiest to eliminate — try them first
        const order = best.boards
            .map((b, i) => ({ i, usedArea: b.usedArea }))
            .sort((a, b) => a.usedArea - b.usedArea);
        for (const { i } of order) {
            const attempt = tryConsolidateBoard(best, i, boardW, boardH, kerf, allowRotate, minWaste, uniformTexture);
            if (attempt !== best) { best = attempt; changed = true; break; }
        }
    }
    return best;
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function packAll(
    boardW, boardH, kerf, allowRotate, minWaste,
    strategy, iterations, partsArr, optimizeCuts, uniformTexture, onProgress
) {
    if (strategy === 'basic') {
        // Quick mode: try all 3 core heuristics with largest-area-first sort, return best.
        onProgress(100);
        const base = partsArr.map(p => ({ ...p }));
        base.sort((a, b) => b.area - a.area);
        let best = null;
        for (const sf of [ bssf, blsf, baf ]) {
            const res = packAllOnce(boardW, boardH, kerf, allowRotate, minWaste, base, sf, uniformTexture);
            if (isBetter(res, best)) best = res;
        }
        return tryConsolidateAll(best, boardW, boardH, kerf, allowRotate, minWaste, uniformTexture);
    }

    let best = null;
    const base = partsArr.map(p => ({ ...p }));
    const CHUNK = 5;
    const DETERMINISTIC = SORTS.length * SCORE_FNS.length; // 8 × 6 = 48 combos

    for (let iter = 0; iter < iterations; iter += CHUNK) {
        const end = Math.min(iter + CHUNK, iterations);

        for (let i = iter; i < end; i++) {
            const scoreFn = SCORE_FNS[ i % SCORE_FNS.length ];
            let items;

            if (i < DETERMINISTIC) {
                // Phase 1: exhaust all deterministic sort × heuristic combos (48 total)
                items = base.map(p => ({ ...p }));
                SORTS[ Math.floor(i / SCORE_FNS.length) % SORTS.length ](items);
            } else if (optimizeCuts && i % 3 === 0) {
                // Phase 2 (optimizeCuts=on): strip-sort with a small random perturbation
                // so repeated passes aren’t identical (3 items swapped at random).
                items = stripSort(base);
                for (let k = 0; k < 3; k++) {
                    const a = Math.floor(Math.random() * items.length);
                    const b = Math.floor(Math.random() * items.length);
                    [ items[ a ], items[ b ] ] = [ items[ b ], items[ a ] ];
                }
            } else {
                // Phase 2: noisy-sort — approximately area-descending with random perturbation.
                // Unlike a full shuffle this preserves relative size ordering, which keeps
                // evaluation diversity (different types win ties) while staying sensible.
                items = noisySort(base, 0.25 + 0.15 * (i % 3));
            }

            const res = packAllOnce(boardW, boardH, kerf, allowRotate, minWaste, items, scoreFn, uniformTexture);
            if (isBetter(res, best, optimizeCuts)) best = res;
        }

        onProgress(Math.round(end / iterations * 100));
        await new Promise(resolve => setTimeout(resolve, 0)); // yield to browser
    }

    if (!best) {
        const items = base.map(p => ({ ...p }));
        items.sort((a, b) => b.area - a.area);
        best = packAllOnce(boardW, boardH, kerf, allowRotate, minWaste, items, bssf, uniformTexture);
    }

    // Post-optimisation: iteratively try to eliminate any sparse board
    best = tryConsolidateAll(best, boardW, boardH, kerf, allowRotate, minWaste, uniformTexture);

    return best;
}
