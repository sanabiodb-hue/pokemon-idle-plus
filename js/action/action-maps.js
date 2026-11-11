// ============================================================
// F12 · Mundo de Ação 3D · mapas jogáveis (dados + validação pura, sem DOM nem Three.js). Contrato: docs/action/CONTRATO.md.
//   - ACTION_MAPS.viridian_forest: a Floresta de Viridian como arena de hordas. As linhas usam as letras de WORLD_LEGEND
//     (o Explore3D desenha o mapa como qualquer outro). O mapa é GERADO por um gerador determinístico deste arquivo
//     (sem aleatoriedade: hash inteiro da posição), então é sempre o mesmo.
//   - Clareiras (zonas de horda) de tamanhos diferentes, passagens largas (≥ 5 quadrados), trilha de terra serpenteando
//     entre elas, riacho com vaus, lago, mato alto, pedras, tocos, arbustos, flores e árvores isoladas como obstáculos.
//   - actionMapById(id) e actionMapProblems(map) (lista de problemas; vazia = mapa bom).
// Zonas: retângulos com limites INCLUSIVOS { id, name, x0, y0, x1, y1 } (células do mapa; x = coluna, y = linha).
// ============================================================
const ACTION_MAP_MIN_PASSAGE = 5;            // largura mínima (quadrados) das passagens entre as clareiras
const ACTION_MAP_MIN_ZONE_FREE = 12;         // células livres mínimas de uma zona

// hash inteiro da posição (determinístico; não depende de worldHash para o arquivo poder carregar sozinho)
function _actionHash(x, y, k) {
    let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(k | 0, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ---------------- gerador da Floresta de Viridian ----------------
// Clareiras: centro (cx, cy) e meias-medidas (hw, hh). A maior (grande) tem uns 15 × 13.
const ACTION_FOREST_CLEARINGS = [
    { id: 'entrada', name: 'Clareira da Entrada', cx: 30, cy: 39, hw: 7, hh: 4.6 },
    { id: 'grande', name: 'Clareira Grande', cx: 29, cy: 21, hw: 7.6, hh: 6.6 },
    { id: 'oeste', name: 'Bosque Oeste', cx: 10.5, cy: 31, hw: 6.6, hh: 6.2 },
    { id: 'leste', name: 'Clareira do Lago', cx: 49, cy: 34, hw: 7.2, hh: 6.6 },
    { id: 'noroeste', name: 'Ninho dos Casulos', cx: 11, cy: 10, hw: 6.8, hh: 5.6 },
    { id: 'nordeste', name: 'Clareira das Colmeias', cx: 48, cy: 10.5, hw: 7.6, hh: 6.2 },
    { id: 'norte', name: 'Vão do Norte', cx: 29.5, cy: 5.5, hw: 5.4, hh: 3.4 },
];
// Passagens: [de, para, curva (desvio do meio em quadrados, com sinal), trilha de terra?]
const ACTION_FOREST_LINKS = [
    ['entrada', 'grande', 2.5, true], ['grande', 'norte', -2, true], ['norte', 'nordeste', 2, true], ['nordeste', 'leste', -3, true],
    ['entrada', 'oeste', 2.5, true], ['oeste', 'noroeste', -3, true], ['noroeste', 'norte', 2, false], ['entrada', 'leste', -2, false],
    ['grande', 'oeste', 1.5, false], ['grande', 'leste', -1.5, false],
];

function _actionForestRows() {
    const W = 60, H = 46, g = [], byId = {};
    for (let y = 0; y < H; y++) g.push(new Array(W).fill('T'));
    const inside = (x, y) => x >= 2 && y >= 2 && x < W - 2 && y < H - 2;
    const pass = new Uint8Array(W * H);                                  // células abertas pelas passagens (nada de enfeite que estreite)
    const open = (x, y) => g[y][x] !== 'T' && g[y][x] !== '~';
    for (const c of ACTION_FOREST_CLEARINGS) byId[c.id] = c;
    // 1) clareiras: retângulos arredondados (superelipse) com borda irregular
    for (const c of ACTION_FOREST_CLEARINGS) {
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            if (!inside(x, y)) continue;
            const dx = (x + 0.5 - c.cx) / c.hw, dy = (y + 0.5 - c.cy) / c.hh, d = dx * dx * dx * dx + dy * dy * dy * dy;
            if (d <= 1 + (_actionHash(x, y, 1) - 0.5) * 0.5) g[y][x] = '.';
        }
    }
    // 2) passagens largas: curva quadrática entre os centros, pincel de raio 3 (≥ 5 quadrados de largura em qualquer ângulo)
    const curve = (a, b, bend, t) => {
        const mx = (a.cx + b.cx) / 2, my = (a.cy + b.cy) / 2, dx = b.cx - a.cx, dy = b.cy - a.cy, L = Math.hypot(dx, dy) || 1;
        const qx = mx - dy / L * bend, qy = my + dx / L * bend, u = 1 - t;
        return [u * u * a.cx + 2 * u * t * qx + t * t * b.cx, u * u * a.cy + 2 * u * t * qy + t * t * b.cy];
    };
    const brush = (px, py, r, fn) => {
        for (let y = Math.floor(py - r); y <= Math.ceil(py + r); y++) for (let x = Math.floor(px - r); x <= Math.ceil(px + r); x++) {
            if (inside(x, y) && Math.hypot(x + 0.5 - px, y + 0.5 - py) <= r) fn(x, y);
        }
    };
    for (const [a, b, bend] of ACTION_FOREST_LINKS) {
        for (let t = 0; t <= 1.0001; t += 0.01) { const [px, py] = curve(byId[a], byId[b], bend, t); brush(px, py, 3.05, (x, y) => { g[y][x] = '.'; }); brush(px, py, 4.2, (x, y) => { pass[y * W + x] = 1; }); }
    }
    // 3) riacho: desce do norte (entre as clareiras do norte e do nordeste), corta a passagem para a Clareira do Lago e deságua no lago
    const stream = [[39.5, 0], [38.5, 6], [40.5, 12], [38.5, 18], [40, 24], [43.5, 29], [47.5, 36.5]];
    const water = new Set(), lake = new Set();
    for (let i = 0; i < stream.length - 1; i++) {
        const [x0, y0] = stream[i], [x1, y1] = stream[i + 1];
        for (let t = 0; t <= 1; t += 0.05) brush(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.95, (x, y) => water.add(y * W + x));
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {          // o lago, no canto da Clareira do Lago
        const dx = (x + 0.5 - 52.5) / 3.4, dy = (y + 0.5 - 38.6) / 2.4;
        if (dx * dx + dy * dy <= 1 + (_actionHash(x, y, 2) - 0.5) * 0.3) lake.add(y * W + x);
    }
    // 4) trilha de terra: serpenteia pelo meio das passagens marcadas (largura ~2); vau de pedras onde cruza o riacho
    const trail = new Set();
    for (const [a, b, bend, has] of ACTION_FOREST_LINKS) {
        if (!has) continue;
        for (let t = 0; t <= 1.0001; t += 0.005) {
            const [px, py] = curve(byId[a], byId[b], bend, t), [qx, qy] = curve(byId[a], byId[b], bend, Math.min(1, t + 0.01));
            const L = Math.hypot(qx - px, qy - py) || 1, s = Math.sin(t * Math.PI * 3) * 1.1 * Math.sin(t * Math.PI);     // serpenteia, centrada nas pontas
            brush(px - (qy - py) / L * s, py + (qx - px) / L * s, 1.0, (x, y) => trail.add(y * W + x));
        }
    }
    for (const k of water) {
        const x = k % W, y = (k - x) / W; if (x < 0 || y < 0 || x >= W || y >= H) continue;
        let ford = false;                                                  // vau: 7 quadrados de largura em volta da trilha
        for (let dy = -3; dy <= 3 && !ford; dy++) for (let dx = -3; dx <= 3; dx++) if (trail.has((y + dy) * W + (x + dx))) { ford = true; break; }
        if (ford && open(x, y)) { trail.add(k); continue; }
        if (ford) continue;
        g[y][x] = '~';
    }
    for (const k of lake) { const x = k % W, y = (k - x) / W; if (inside(x, y)) g[y][x] = '~'; }
    for (const k of trail) { const x = k % W, y = (k - x) / W; if (inside(x, y) && g[y][x] !== 'T' && !lake.has(k)) g[y][x] = 'p'; }
    // 5) mato alto em manchas (só em chão comum)
    const tall = [[12, 33, 3.2], [7, 27, 2.4], [26, 25, 3.0], [34, 17, 2.6], [45, 7, 3.0], [52, 13, 2.4], [14, 7, 2.8], [44, 31, 2.6], [36, 40, 2.2], [20, 15, 2.2], [32, 4, 2.0], [22, 36, 2.0]];
    for (const [cx, cy, r] of tall) brush(cx, cy, r + 0.6, (x, y) => { if (g[y][x] === '.' && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r + (_actionHash(x, y, 3) - 0.5) * 1.4) g[y][x] = 'w'; });
    // 6) obstáculos dentro das clareiras (árvores isoladas, pedras, tocos, arbustos) longe da borda, da trilha e do início
    const near = (x, y, r, test) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && xx >= 0 && yy < H && xx < W && test(g[yy][xx], xx, yy)) return true; } return false; };
    const spawn = { x: 30, y: 41 };
    const inClear = (x, y) => ACTION_FOREST_CLEARINGS.some(c => { const dx = (x + 0.5 - c.cx) / (c.hw - 2), dy = (y + 0.5 - c.cy) / (c.hh - 2); return dx * dx + dy * dy <= 1; });
    const props = [];
    for (let y = 3; y < H - 3; y++) for (let x = 3; x < W - 3; x++) {
        const ch = g[y][x]; if (ch !== '.' && ch !== 'w') continue;
        if (Math.abs(x - spawn.x) <= 4 && Math.abs(y - spawn.y) <= 3) continue;
        if (pass[y * W + x] && !inClear(x, y)) continue;
        if (near(x, y, 2, (c) => c === 'T' || c === '~' || c === 'p')) continue;          // longe da mata, da água e da trilha: não estreita passagens
        const h = _actionHash(x, y, 4);
        if (h < 0.035) props.push([x, y, h < 0.012 ? 'T' : h < 0.02 ? 'r' : h < 0.027 ? 'o' : 'b']);
    }
    for (const [x, y, ch] of props) if (!near(x, y, 2, (c, xx, yy) => (xx !== x || yy !== y) && 'Trob'.includes(c))) g[y][x] = ch;
    // 7) acabamento: tufos e flores no chão; arbustos e pedras na borda da mata (sem estreitar: só onde a borda fica larga)
    for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
        if (g[y][x] !== '.') continue;
        const h = _actionHash(x, y, 5), edge = near(x, y, 1, (c) => c === 'T');
        if (edge && h < 0.16 && !pass[y * W + x] && !near(x, y, 3, (c) => c === 'p')) { const hb = _actionHash(x, y, 6); g[y][x] = hb < 0.6 ? 'b' : hb < 0.8 ? 'r' : 'o'; }
        else if (h < 0.12) g[y][x] = ',';
        else if (h < 0.15) g[y][x] = 'f';
        else if (h < 0.175) g[y][x] = 'y';
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!'p'.includes(g[spawn.y + dy][spawn.x + dx])) g[spawn.y + dy][spawn.x + dx] = '.';
    return g.map(r => r.join(''));
}

// Zona de cada clareira: o retângulo do miolo (sem a borda irregular)
function _actionForestZones() {
    return ACTION_FOREST_CLEARINGS.map(c => ({ id: c.id, name: c.name, x0: Math.ceil(c.cx - c.hw * 0.8), y0: Math.ceil(c.cy - c.hh * 0.8), x1: Math.floor(c.cx + c.hw * 0.8) - 1, y1: Math.floor(c.cy + c.hh * 0.8) - 1 }));
}

const ACTION_MAPS = {
    // Elites e chefe pela pesquisa da região (docs/pokemon-research/regions/viridian-forest.md, 5.3): Butterfree e Pidgeotto como
    // elites, Beedrill alfa (o enxame do anime) como chefe. Níveis acima da rota kanto_viridian_forest (Nv 11–15).
    viridian_forest: (() => {
        const rows = _actionForestRows();
        return {
            id: 'action_viridian_forest', name: 'Floresta de Viridian', type: 'route', route: 'kanto_viridian_forest',
            biome: 'forest', canopy: 0.7, music: 'forest', width: rows[0].length, height: rows.length, rows,
            spawn: { x: 30, y: 41, dir: 'up' }, zones: _actionForestZones(),
            elites: [{ id: 12, level: 16 }, { id: 17, level: 17 }],
            boss: { id: 15, level: 20, zone: 'grande' },
        };
    })(),
};

function actionMapById(id) {
    if (typeof id !== 'string') return null;
    if (Object.prototype.hasOwnProperty.call(ACTION_MAPS, id)) return ACTION_MAPS[id];
    for (const k in ACTION_MAPS) if (ACTION_MAPS[k].id === id) return ACTION_MAPS[k];
    return null;
}

// Validação pura. Devolve a lista de problemas (textos); vazia = mapa bom.
// Passagem larga: uma célula é "miolo" quando o quadrado de minW × minW centrado nela está todo livre; o miolo mais perto do início
// precisa alcançar (andando só por miolos, vizinhança de 8, porque passagens diagonais são escadas de miolos) um miolo de cada zona. Assim toda zona é alcançável por um caminho de pelo menos minW de largura.
function actionMapProblems(map, opts = {}) {
    const out = [], minW = opts.minPassage || ACTION_MAP_MIN_PASSAGE, minFree = opts.minZoneFree || ACTION_MAP_MIN_ZONE_FREE;
    if (!map || !Array.isArray(map.rows)) return ['mapa sem linhas'];
    const W = map.width, H = map.height, legend = typeof WORLD_LEGEND !== 'undefined' ? WORLD_LEGEND : null;
    if (!(W > 0) || !(H > 0)) out.push('largura ou altura inválida');
    if (map.rows.length !== H) out.push(`altura ${H} diferente do número de linhas ${map.rows.length}`);
    map.rows.forEach((r, y) => {
        if (typeof r !== 'string' || r.length !== W) out.push(`linha ${y} com largura ${r && r.length} (esperado ${W})`);
        else if (legend) for (let x = 0; x < r.length; x++) if (!legend[r[x]]) { out.push(`letra "${r[x]}" fora da legenda em (${x}, ${y})`); break; }
    });
    if (out.length) return out;
    const blocked = (x, y) => (typeof worldCellBlocked === 'function' ? worldCellBlocked(map, x, y) : !(legend[map.rows[y] && map.rows[y][x]] || {}).walkable);
    const sp = map.spawn;
    if (!sp || !Number.isInteger(sp.x) || !Number.isInteger(sp.y) || sp.x < 0 || sp.y < 0 || sp.x >= W || sp.y >= H) { out.push('início fora do mapa'); return out; }
    if (blocked(sp.x, sp.y)) { out.push('início bloqueado'); return out; }
    // alcance simples a partir do início
    const reach = new Uint8Array(W * H), q = [sp.y * W + sp.x]; reach[q[0]] = 1;
    for (let h = 0; h < q.length; h++) {
        const c = q[h], x = c % W, y = (c - x) / W;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, n = ny * W + nx; if (nx >= 0 && ny >= 0 && nx < W && ny < H && !reach[n] && !blocked(nx, ny)) { reach[n] = 1; q.push(n); } }
    }
    // miolos largos
    const r = Math.floor(minW / 2), core = new Uint8Array(W * H);
    for (let y = r; y < H - r; y++) for (let x = r; x < W - r; x++) {
        let ok = true; for (let dy = -r; dy <= r && ok; dy++) for (let dx = -r; dx <= r; dx++) if (blocked(x + dx, y + dy)) { ok = false; break; }
        if (ok) core[y * W + x] = 1;
    }
    let start = -1, best = Infinity;
    for (let i = 0; i < W * H; i++) if (core[i] && reach[i]) { const x = i % W, y = (i - x) / W, d = Math.abs(x - sp.x) + Math.abs(y - sp.y); if (d < best) { best = d; start = i; } }
    const wide = new Uint8Array(W * H);
    if (start >= 0) {
        const qq = [start]; wide[start] = 1;
        for (let h = 0; h < qq.length; h++) {
            const c = qq[h], x = c % W, y = (c - x) / W;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy, n = ny * W + nx; if (nx >= 0 && ny >= 0 && nx < W && ny < H && core[n] && !wide[n]) { wide[n] = 1; qq.push(n); } }
        }
    } else out.push(`nenhum espaço de ${minW} × ${minW} perto do início`);
    const zones = Array.isArray(map.zones) ? map.zones : [];
    if (!zones.length) out.push('mapa sem zonas');
    const ids = new Set();
    for (const z of zones) {
        if (!z || typeof z.id !== 'string') { out.push('zona sem id'); continue; }
        if (ids.has(z.id)) out.push(`zona ${z.id} repetida`); ids.add(z.id);
        if (!(z.x0 >= 0 && z.y0 >= 0 && z.x1 < W && z.y1 < H && z.x0 <= z.x1 && z.y0 <= z.y1)) { out.push(`zona ${z.id} fora do mapa`); continue; }
        let free = 0, unreached = 0, wideHit = false, rep = null;
        for (let y = z.y0; y <= z.y1; y++) for (let x = z.x0; x <= z.x1; x++) {
            if (blocked(x, y)) continue;
            free++; if (!rep) rep = { x, y };
            if (!reach[y * W + x]) unreached++;
            if (wide[y * W + x]) wideHit = true;
        }
        if (free < minFree) out.push(`zona ${z.id} com só ${free} células livres (mínimo ${minFree})`);
        if (rep && typeof worldFindPath === 'function' && !worldFindPath(map, { x: sp.x, y: sp.y }, rep)) out.push(`zona ${z.id} inalcançável a partir do início`);
        else if (unreached) out.push(`zona ${z.id} com ${unreached} células livres inalcançáveis`);
        if (free >= minFree && !wideHit) out.push(`passagem estreita demais até a zona ${z.id} (mínimo ${minW})`);
    }
    if (map.boss && map.boss.zone && !ids.has(map.boss.zone)) out.push(`zona do chefe ${map.boss.zone} não existe`);
    return out;
}

// Fração de células livres do mapa (0..1), para os testes e o relatório
function actionMapFreeFraction(map) {
    let free = 0;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) { const d = WORLD_LEGEND[map.rows[y][x]]; if (d && d.walkable) free++; }
    return free / (map.width * map.height);
}
