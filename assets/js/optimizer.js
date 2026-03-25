// Simple 2D Guillotine bin packing heuristic for board cutting optimization
// Language: Serbian labels, internal English variable names

(function () {
    const parts = []; // {id,w,h,area,color,rotAllowed}
    const dimensionColors = {}; // key original orientation => color
    let seq = 1;
    function randomColor() { const h = Math.floor(Math.random() * 360); return `hsl(${h} 65% 65%)`; }

    function addPart(w, h, qty, rotAllowed = true) {
        if (!(w > 0 && h > 0 && qty > 0)) return;
        const key = w + 'x' + h;
        if (!dimensionColors[ key ]) dimensionColors[ key ] = randomColor();
        for (let i = 0; i < qty; i++) {
            const color = dimensionColors[ key ];
            parts.push({ id: seq++, w: +w, h: +h, area: w * h, color, rotAllowed: !!rotAllowed });
        }
        renderParts();
    }

    function renderParts() {
        const list = document.getElementById('parts-list');
        list.innerHTML = '';
        // group by dimension
        const grouped = {};
        for (const p of parts) {
            const key = p.w + 'x' + p.h;
            grouped[ key ] = grouped[ key ] || { w: p.w, h: p.h, qty: 0, rotMixed: false, rotAllowed: p.rotAllowed };
            grouped[ key ].qty++;
            if (!grouped[ key ].rotAllowed || !p.rotAllowed) { grouped[ key ].rotMixed = true; }
        }
        Object.entries(grouped).sort((a, b) => b[ 1 ].w * b[ 1 ].h - a[ 1 ].w * a[ 1 ].h).forEach(([ k, v ]) => {
            const row = document.createElement('div');
            row.className = 'part-row';
            const rotLabel = v.rotMixed ? 'mix' : (v.rotAllowed ? 'rot' : 'fix');
            row.innerHTML = `<span>${v.w}</span><span>${v.h}</span><span>${v.qty}</span><span>${rotLabel}</span>`;
            const editBtn = document.createElement('button'); editBtn.textContent = '✎'; editBtn.className = 'edit-btn'; editBtn.title = 'Izmeni';
            const delBtn = document.createElement('button'); delBtn.textContent = 'x'; delBtn.title = 'Ukloni ovu dimenziju';
            delBtn.onclick = () => { for (let i = parts.length - 1; i >= 0; i--) { if (parts[ i ].w === v.w && parts[ i ].h === v.h) { parts.splice(i, 1); } } renderParts(); };
            editBtn.onclick = () => startEdit(row, v);
            row.appendChild(editBtn);
            row.appendChild(delBtn);
            list.appendChild(row);
        });
    }

    function startEdit(row, data) {
        if (row.classList.contains('editing')) return;
        row.classList.add('editing');
        row.innerHTML = '';
        // inputs
        const wInput = document.createElement('input'); wInput.type = 'number'; wInput.value = data.w; wInput.className = 'small-input'; wInput.min = 10;
        const hInput = document.createElement('input'); hInput.type = 'number'; hInput.value = data.h; hInput.className = 'small-input'; hInput.min = 10;
        const qInput = document.createElement('input'); qInput.type = 'number'; qInput.value = data.qty; qInput.className = 'small-input'; qInput.min = 1;
        const rotSelect = document.createElement('select'); rotSelect.innerHTML = '<option value="rot">rot</option><option value="fix">fix</option>';
        rotSelect.value = data.rotMixed ? 'rot' : (data.rotAllowed ? 'rot' : 'fix');
        row.appendChild(wInput); row.appendChild(hInput); row.appendChild(qInput); row.appendChild(rotSelect);
        const save = document.createElement('button'); save.textContent = '✔'; save.className = 'save-btn';
        const cancel = document.createElement('button'); cancel.textContent = '↺'; cancel.className = 'cancel-btn';
        save.onclick = () => {
            const newW = +wInput.value; const newH = +hInput.value; const newQ = +qInput.value; const newRot = rotSelect.value === 'rot';
            if (!(newW > 0 && newH > 0 && newQ > 0)) { renderParts(); return; }
            // remove old group entries
            for (let i = parts.length - 1, removed = 0; i >= 0 && removed < data.qty; i--) {
                if (parts[ i ].w === data.w && parts[ i ].h === data.h) { parts.splice(i, 1); removed++; }
            }
            // add new
            addPart(newW, newH, newQ, newRot);
        };
        cancel.onclick = () => renderParts();
        row.appendChild(save);
        row.appendChild(cancel);
    }

    // Single-board pack (internal) returns placements + leftover items
    function packOne(boardW, boardH, kerf, allowRotateGlobal, minWaste, items) {
        const freeRects = [ { x: 0, y: 0, w: boardW, h: boardH } ];
        const placements = [];
        function evaluateSplit(fr, iw, ih) {
            const rw = fr.w - iw - kerf; const rh = fr.h - ih - kerf;
            const variants = [];
            // vertical-first
            const v = []; if (rw > 0) v.push({ x: fr.x + iw + kerf, y: fr.y, w: rw, h: fr.h }); if (rh > 0) v.push({ x: fr.x, y: fr.y + ih + kerf, w: iw, h: rh }); variants.push(v);
            // horizontal-first
            const h = []; if (rh > 0) h.push({ x: fr.x, y: fr.y + ih + kerf, w: fr.w, h: rh }); if (rw > 0) h.push({ x: fr.x + iw + kerf, y: fr.y, w: rw, h: ih }); variants.push(h);
            function score(list) { if (!list.length) return 1e12; const total = list.reduce((s, r) => s + r.w * r.h, 0); const skinny = list.reduce((s, r) => s + Math.abs(r.w - r.h) / (r.w + r.h), 0) / list.length; return total + skinny * (fr.w * fr.h * 0.05); }
            let best = { rects: [], score: 1e18 };
            for (const varr of variants) { const s = score(varr); if (s < best.score) best = { rects: varr, score: s }; }
            return best;
        }
        function splitFreeRect(fr, iw, ih, variantRects) {
            const idx = freeRects.indexOf(fr); if (idx >= 0) freeRects.splice(idx, 1);
            for (const r of variantRects) { if (r.w > minWaste && r.h > minWaste) freeRects.push(r); }
            // remove contained
            for (let i = 0; i < freeRects.length; i++) {
                for (let j = i + 1; j < freeRects.length; j++) {
                    const A = freeRects[ i ], B = freeRects[ j ];
                    if (A.x >= B.x && A.y >= B.y && A.x + A.w <= B.x + B.w && A.y + A.h <= B.y + B.h) { freeRects.splice(i, 1); i--; break; }
                    if (B.x >= A.x && B.y >= A.y && B.x + B.w <= A.x + A.w && B.y + B.h <= A.y + A.h) { freeRects.splice(j, 1); j--; }
                }
            }
        }
        function findPosition(item) {
            let best = null;
            for (const fr of freeRects) {
                for (const rot of [ false, true ]) {
                    if (rot && (!allowRotateGlobal || !item.rotAllowed)) continue;
                    const iw = rot ? item.h : item.w; const ih = rot ? item.w : item.h;
                    if (iw <= fr.w && ih <= fr.h) {
                        const waste = fr.w * fr.h - iw * ih;
                        const split = evaluateSplit(fr, iw, ih);
                        const score = waste + split.score * 0.1; // kombinovani score
                        if (!best || score < best.score || (score === best.score && fr.w * fr.h < best.fr.w * best.fr.h)) {
                            best = { fr, rot, iw, ih, score, variant: split.rects };
                        }
                    }
                }
            }
            return best;
        }
        let placedThisBoard = true;
        while (placedThisBoard) {
            placedThisBoard = false;
            items.sort((a, b) => b.area - a.area);
            for (let i = 0; i < items.length; i++) {
                const item = items[ i ];
                const pos = findPosition(item);
                if (pos) {
                    placements.push({ id: item.id, x: pos.fr.x, y: pos.fr.y, w: pos.iw, h: pos.ih, color: item.color, rot: pos.rot, origW: item.w, origH: item.h });
                    items.splice(i, 1);
                    splitFreeRect(pos.fr, pos.iw, pos.ih, pos.variant);
                    // prune
                    for (let a = 0; a < freeRects.length; a++) {
                        for (let b = a + 1; b < freeRects.length; b++) {
                            const A = freeRects[ a ], B = freeRects[ b ];
                            if (A && B) {
                                if (A.x >= B.x && A.y >= B.y && A.x + A.w <= B.x + B.w && A.y + A.h <= B.y + B.h) { freeRects.splice(a, 1); a--; break; }
                                else if (B.x >= A.x && B.y >= A.y && B.x + B.w <= A.x + A.w && B.y + B.h <= A.y + A.h) { freeRects.splice(b, 1); b--; }
                            }
                        }
                    }
                    placedThisBoard = true;
                    break; // restart from biggest again
                }
            }
        }
        const usedArea = placements.reduce((s, p) => s + p.w * p.h, 0);
        // Debug detekcija preklapanja (može se ukloniti kasnije)
        for (let i = 0; i < placements.length; i++) {
            for (let j = i + 1; j < placements.length; j++) {
                const A = placements[ i ], B = placements[ j ];
                if (!(A.x + A.w <= B.x || B.x + B.w <= A.x || A.y + A.h <= B.y || B.y + B.h <= A.y)) {
                    console.warn('Detektovano preklapanje komada', A, B);
                }
            }
        }
        return { placements, usedArea, freeRects };
    }

    // Multi-board packing until all parts placed
    function packAllOnce(boardW, boardH, kerf, allowRotate, minWaste, itemsSource) {
        const remaining = itemsSource.map(p => ({ ...p }));
        const boards = [];
        while (remaining.length) {
            const before = remaining.length;
            const res = packOne(boardW, boardH, kerf, allowRotate, minWaste, remaining);
            boards.push(res);
            if (remaining.length === before) break;
        }
        const totalUsed = boards.reduce((s, b) => s + b.usedArea, 0);
        return { boards, remaining, totalUsed, boardArea: boardW * boardH };
    }

    // Advanced: multiple randomized orderings & slight size jitter optional
    function packAll(boardW, boardH, kerf, allowRotate, minWaste, strategy, iterations) {
        if (strategy === 'basic') return packAllOnce(boardW, boardH, kerf, allowRotate, minWaste, parts);
        let best = null;
        const baseParts = parts.map(p => ({ ...p }));
        for (let iter = 0; iter < iterations; iter++) {
            // shuffle & maybe rotate dimension order bias
            const shuffled = baseParts.map(p => ({ ...p }));
            for (let i = shuffled.length - 1; i > 0; i--) {
                const r = Math.floor(Math.random() * (i + 1));
                [ shuffled[ i ], shuffled[ r ] ] = [ shuffled[ r ], shuffled[ i ] ];
            }
            // occasional descending by max side
            if (iter % 3 === 0) {
                shuffled.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
            }
            // lagani bias: povremeno sortiraj po većoj razlici stranica radi pokušaja popune uskih prostora
            if (iter % 5 === 2) {
                shuffled.sort((a, b) => (Math.abs(b.w - b.h) - Math.abs(a.w - a.h)));
            }
            const res = packAllOnce(boardW, boardH, kerf, allowRotate, minWaste, shuffled);
            if (!best || (res.totalUsed > best.totalUsed) || (res.totalUsed === best.totalUsed && res.boards.length < best.boards.length)) {
                best = res;
            }
        }
        return best || packAllOnce(boardW, boardH, kerf, allowRotate, minWaste, parts);
    }

    function drawBoards(result, boardW, boardH) {
        const container = document.getElementById('boards');
        container.innerHTML = '';
        const legend = document.getElementById('legend'); legend.innerHTML = '';
        const uniqueDims = {};
        result.boards.forEach((board, index) => {
            const wrap = document.createElement('div'); wrap.className = 'board-wrap';
            const title = document.createElement('h3'); title.textContent = `Tabla ${index + 1}`; wrap.appendChild(title);
            const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300; canvas.className = 'board-canvas'; wrap.appendChild(canvas);
            const ctx = canvas.getContext('2d');
            const scale = Math.min((canvas.width - 20) / boardW, (canvas.height - 20) / boardH); const offset = 10;
            ctx.strokeStyle = '#222'; ctx.lineWidth = 1; ctx.strokeRect(offset, offset, boardW * scale, boardH * scale);
            ctx.font = '9px system-ui'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
            board.placements.forEach(p => {
                ctx.fillStyle = p.color;
                ctx.fillRect(offset + p.x * scale, offset + p.y * scale, p.w * scale, p.h * scale);
                ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.strokeRect(offset + p.x * scale, offset + p.y * scale, p.w * scale, p.h * scale);
                const label = p.w + 'x' + p.h + (p.rot ? '*' : '');
                if (p.w * scale > 26 && p.h * scale > 12) { ctx.fillStyle = '#000'; ctx.fillText(label, offset + p.x * scale + p.w * scale / 2, offset + p.y * scale + p.h * scale / 2); }
                const key = p.origW + 'x' + p.origH;
                if (!uniqueDims[ key ]) uniqueDims[ key ] = { color: dimensionColors[ key ] || p.color, dim: key, count: 0 };
                uniqueDims[ key ].count++;
            });
            const usedPercent = (board.usedArea / (boardW * boardH) * 100).toFixed(1);
            const meta = document.createElement('div'); meta.className = 'board-meta';
            meta.innerHTML = `Iskoriscenje: ${usedPercent}% (${(board.usedArea / 1e6).toFixed(3)} m²)`;
            wrap.appendChild(meta);
            container.appendChild(wrap);
        });
        Object.values(uniqueDims).sort((a, b) => b.count - a.count).forEach(d => {
            const div = document.createElement('div'); div.className = 'item';
            div.innerHTML = `<span class="swatch" style="background:${d.color}"></span>${d.dim} (${d.count})`;
            legend.appendChild(div);
        });
    }

    function updateStatsMulti(res) {
        const el = document.getElementById('stats');
        const boardsCount = res.boards.length;
        const totalBoardArea = boardsCount * res.boardArea;
        const percent = (res.totalUsed / totalBoardArea * 100).toFixed(2);
        el.innerHTML = `<strong>Ukupno tabli:</strong> ${boardsCount}<br>` +
            `<strong>Ukupno iskoriscenje:</strong> ${percent}%<br>` +
            `Utrosen materijal: ${(res.totalUsed / 1e6).toFixed(3)} m² / ${(totalBoardArea / 1e6).toFixed(3)} m²<br>` +
            `Nepostavljeni komadi: ${res.remaining.length}`;
    }

    function exportJson(data) {
        const blob = new Blob([ JSON.stringify(data, null, 2) ], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'krojac_rezultat.json';
        a.click();
    }

    // Event wiring
    document.getElementById('addPartBtn').addEventListener('click', () => {
        const w = document.getElementById('partWidth').value;
        const h = document.getElementById('partHeight').value;
        const q = document.getElementById('partQty').value;
        const rot = document.getElementById('partRot').checked;
        addPart(+w, +h, +q, rot);
        document.getElementById('partWidth').value = '';
        document.getElementById('partHeight').value = '';
        document.getElementById('partQty').value = '1';
    });

    document.getElementById('input-form').addEventListener('submit', e => {
        e.preventDefault();
        const boardW = +document.getElementById('boardWidth').value;
        const boardH = +document.getElementById('boardHeight').value;
        const kerf = +document.getElementById('kerf').value;
        const minWaste = +document.getElementById('minWaste').value;
        const allowRotate = document.getElementById('allowRotate').checked;
        const strategy = document.getElementById('strategy').value;
        const iterations = +document.getElementById('iterations').value || 30;
        const res = packAll(boardW, boardH, kerf, allowRotate, minWaste, strategy, iterations);
        drawBoards(res, boardW, boardH);
        updateStatsMulti(res);
        window.currentResult = { res, boardW, boardH, kerf, minWaste, allowRotate, strategy, iterations, parts: [ ...parts ] };
    });

    document.getElementById('exportJsonBtn').addEventListener('click', () => {
        if (window.currentResult) exportJson(window.currentResult);
    });
    document.getElementById('printBtn').addEventListener('click', () => { window.print(); });
    document.getElementById('resetBtn').addEventListener('click', () => { parts.length = 0; for (const k in dimensionColors) delete dimensionColors[ k ]; renderParts(); document.getElementById('stats').innerHTML = ''; document.getElementById('legend').innerHTML = ''; document.getElementById('boards').innerHTML = ''; });

    // initial demo parts
    addPart(500, 400, 4, true);
    addPart(600, 300, 6, true);
    addPart(350, 450, 8, false);
})();
