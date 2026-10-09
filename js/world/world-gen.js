// ============================================================
// Mundo visual · gerador procedural de mapas de caça (Fase 7.4). Funções puras: mesma espécie + mesma WORLD_GEN_VERSION =
// exatamente o mesmo mapa, sem Math.random, relógio ou estado do jogo. Produz o MESMO formato de mapa da engine
// (rows ASCII + legenda de world-data.js, type 'hunt', spawn); nada de segunda engine nem de colisão própria.
//
// Algoritmo (decisão do Jev: "caminho primeiro, espalhar depois" com rede protegida):
//   1. semente da espécie (FNV-1a + mistura) → PRNG próprio (mulberry32) → bioma, dimensões, spawn;
//   2. escolhe os PONTOS CANDIDATOS de encontro (afastados entre si e do spawn);
//   3. ABRE a rede de corredores (spawn → pontos, em árvore + alguns laços) com caminhadas sinuosas; cada célula do corredor
//      e seu entorno 3x3, além de uma clareira 5x5 em cada ponto, ficam PROTEGIDOS;
//   4. só então espalha água/lava, obstáculos em aglomerados (ruído de valor) e variações de chão, FORA da área protegida;
//   5. confere por busca em largura que todos os pontos são alcançáveis do spawn (invariante; lança erro se falhar).
// Os mapas são gerados sob demanda e guardados num cache LRU pequeno; nada é gerado ao carregar o módulo.
// ============================================================
const WORLD_HUNT_CACHE_MAX = 8;
const _worldHuntCache = new Map();
const _worldHuntStats = { generated: 0 };

// Semente de 32 bits estável de um texto (FNV-1a + mistura final). Base de toda semente do mundo (mapas, encontros).
function worldStringSeed(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
    return h >>> 0;
}

function worldHuntSeed(speciesId) { return worldStringSeed(`hunt:v${WORLD_GEN_VERSION}:${speciesId}`); }

function worldRng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Bioma de uma lista de tipos (ver world-biomes.js): maior prioridade vence; sem tipo válido → fallback
function worldBiomeForTypes(types) {
    let best = null, bestRank = Infinity;
    if (Array.isArray(types)) {
        for (const t of types) {
            const rank = typeof t === 'string' && _worldHas(WORLD_TYPE_BIOME, t) ? WORLD_TYPE_PRIORITY.indexOf(t) : -1;
            if (rank >= 0 && rank < bestRank) { best = t; bestRank = rank; }
        }
    }
    return best ? WORLD_TYPE_BIOME[best] : WORLD_BIOME_FALLBACK;
}

// ---- ruído de valor (inteiro + interpolação suave), duas oitavas ----
function _wgLattice(seed, ix, iy) {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed | 0, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// Uma oitava: sorteia só os pontos da grade (poucas dezenas) e interpola cada célula entre eles
function _wgOctave(seed, w, h, scale) {
    const gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2, grid = new Float64Array(gw * gh);
    for (let iy = 0; iy < gh; iy++) for (let ix = 0; ix < gw; ix++) grid[iy * gw + ix] = _wgLattice(seed, ix, iy);
    return (x, y) => {
        const fx = x / scale, fy = y / scale, ix = Math.floor(fx), iy = Math.floor(fy);
        let tx = fx - ix, ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        const o = iy * gw + ix, a = grid[o], b = grid[o + 1], c = grid[o + gw], d = grid[o + gw + 1];
        return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    };
}
// Campo de ruído de valor (duas oitavas) em [0, 1) para cada índice de `cells` (y * w + x); 0 nas demais células
function _wgField(seed, w, h, scale, cells) {
    const o1 = _wgOctave(seed, w, h, scale), o2 = _wgOctave(seed + 101, w, h, scale / 2.2), out = new Float64Array(w * h);
    for (const i of cells) { const x = i % w, y = Math.floor(i / w); out[i] = 0.65 * o1(x, y) + 0.35 * o2(x, y); }
    return out;
}

// Valor de corte para que ~`fraction` das células fiquem acima dele
function _wgThreshold(cells, field, fraction) {
    if (!(fraction > 0) || !cells.length) return Infinity;
    const sorted = new Float64Array(cells.length);
    for (let k = 0; k < cells.length; k++) sorted[k] = field[cells[k]];
    sorted.sort();                                                                           // numérico (typed array)
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((1 - fraction) * sorted.length)))];
}

function _wgPick(list, r) {
    let total = 0;
    for (const e of list) total += e[1];
    let x = r * total;
    for (const e of list) { x -= e[1]; if (x < 0) return e[0]; }
    return list[list.length - 1][0];
}

const _WG_STEPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Gera o mapa de uma espécie. `spec` = { speciesId (inteiro >= 1), types (opcional), name (opcional) }. Entrada inválida → null.
function worldGenerateHuntMap(spec) {
    if (!spec || !Number.isInteger(spec.speciesId) || spec.speciesId < 1 || spec.speciesId > 9999999) return null;
    const speciesId = spec.speciesId;
    const biome = WORLD_BIOMES[worldBiomeForTypes(spec.types)];
    const seed = worldHuntSeed(speciesId);
    const rnd = worldRng(seed);
    const L = WORLD_GEN_LIMITS;
    const span = (range, lo, hi) => Math.min(hi, Math.max(lo, range[0] + Math.floor(rnd() * (range[1] - range[0] + 1))));
    const w = span(biome.width, L.minWidth, L.maxWidth), h = span(biome.height, L.minHeight, L.maxHeight);

    // ---- spawn e pontos candidatos ----
    const margin = 4;
    const spawn = { x: margin + Math.floor(rnd() * 4), y: Math.min(h - margin - 1, Math.max(margin, Math.floor(h * 0.3 + rnd() * h * 0.4))) };
    const area = w * h, count = Math.min(10, Math.max(4, Math.round(area / 700)));
    let spacing = Math.max(8, Math.round(Math.sqrt(area / count) * 0.55));
    const minFromSpawn = Math.floor(w * 0.3);
    const points = [];
    for (let attempt = 0; points.length < count && attempt < 5000; attempt++) {
        if (attempt > 0 && attempt % 150 === 0 && spacing > 6) spacing -= 2;
        const x = margin + Math.floor(rnd() * (w - 2 * margin)), y = margin + Math.floor(rnd() * (h - 2 * margin));
        if (Math.hypot(x - spawn.x, y - spawn.y) < minFromSpawn) continue;
        if (points.some(p => Math.hypot(x - p.x, y - p.y) < spacing)) continue;
        points.push({ x, y });
    }
    if (points.length < 3) throw new Error(`hunt map ${speciesId}: não foi possível posicionar os pontos de encontro`);

    // ---- rede de corredores protegida ----
    const protectedCells = new Uint8Array(w * h), pathCells = new Uint8Array(w * h);
    const protect = (cx, cy, r) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (x >= 0 && y >= 0 && x < w && y < h) protectedCells[y * w + x] = 1; };
    const mark = (x, y) => { pathCells[y * w + x] = 1; protect(x, y, 1); };
    const carve = (a, b) => {
        let x = a.x, y = a.y;
        mark(x, y);
        let wander = Math.floor((Math.abs(b.x - a.x) + Math.abs(b.y - a.y)) * 0.5);       // desvios laterais limitados: o corredor sempre chega
        while (x !== b.x || y !== b.y) {
            const dx = b.x - x, dy = b.y - y;
            if (wander > 0 && rnd() < biome.meander) {
                wander--;
                const sign = rnd() < 0.5 ? -1 : 1;
                if (Math.abs(dx) >= Math.abs(dy)) y = Math.min(h - margin + 1, Math.max(margin - 1, y + sign)); else x = Math.min(w - margin + 1, Math.max(margin - 1, x + sign));
            } else if (dx !== 0 && (dy === 0 || rnd() < Math.abs(dx) / (Math.abs(dx) + Math.abs(dy)))) x += dx > 0 ? 1 : -1;
            else y += dy > 0 ? 1 : -1;
            mark(x, y);
        }
    };
    const nodes = [spawn], pending = points.slice();
    while (pending.length) {                                                                // árvore: sempre liga o ponto mais próximo da rede
        let bi = 0, bn = 0, bd = Infinity;
        for (let i = 0; i < pending.length; i++) for (let j = 0; j < nodes.length; j++) {
            const d = Math.abs(pending[i].x - nodes[j].x) + Math.abs(pending[i].y - nodes[j].y);
            if (d < bd) { bd = d; bi = i; bn = j; }
        }
        carve(nodes[bn], pending[bi]);
        nodes.push(pending.splice(bi, 1)[0]);
    }
    for (let k = 0; k < Math.floor(count / 4); k++) {                                       // alguns laços: a rede deixa de ser só uma árvore
        const a = points[Math.floor(rnd() * points.length)], b = points[Math.floor(rnd() * points.length)];
        if (a !== b) carve(a, b);
    }
    for (const n of nodes) protect(n.x, n.y, 2);                                            // clareira em volta do spawn e de cada ponto

    // ---- terreno fora da rede ----
    const free = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) if (!protectedCells[y * w + x]) free.push(y * w + x);
    const nSeed = (seed ^ 0x9e3779b9) | 0;
    const field = (salt, scale) => _wgField(nSeed + salt, w, h, scale, free);
    const liquidField = biome.liquid ? field(1, biome.liquid.scale) : null;
    const obstacleField = field(2, biome.obstacles.scale), patchField = biome.patch ? field(3, biome.patch.scale) : null;
    const isLiquid = new Uint8Array(w * h);
    if (liquidField) { const thr = _wgThreshold(free, liquidField, biome.liquid.fraction); for (const i of free) if (liquidField[i] >= thr) isLiquid[i] = 1; }
    const dry = free.filter(i => !isLiquid[i]);
    const obsThr = _wgThreshold(dry, obstacleField, biome.obstacles.fraction);
    const patchThr = patchField ? _wgThreshold(dry, patchField, biome.patch.fraction) : Infinity;

    const grid = [];
    for (let y = 0; y < h; y++) {
        const row = [];
        for (let x = 0; x < w; x++) {
            const i = y * w + x, rGround = rnd(), rObstacle = rnd(), rScatter = rnd();      // sempre 3 sorteios por célula: ordem fixa
            if (pathCells[i]) row.push(biome.path);
            else if (protectedCells[i]) row.push(_wgPick(biome.ground, rGround));
            else if (x === 0 || y === 0 || x === w - 1 || y === h - 1) row.push(biome.border);
            else if (isLiquid[i]) row.push(biome.liquid.ch);
            else if (obstacleField[i] >= obsThr || rScatter < biome.obstacles.scatter) row.push(_wgPick(biome.obstacles.symbols, rObstacle));
            else if (patchField && patchField[i] >= patchThr) row.push(biome.patch.ch);
            else row.push(_wgPick(biome.ground, rGround));
        }
        grid.push(row);
    }
    if (biome.shore && biome.liquid) {                                                       // margem de areia ao redor da água (só sobre chão comum)
        const groundChars = new Set(biome.ground.map(e => e[0]));
        const liquid = biome.liquid.ch, shore = [];
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
            if (!groundChars.has(grid[y][x])) continue;
            let near = false;
            for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (grid[y + dy][x + dx] === liquid) { near = true; break; }
            if (near) shore.push([x, y]);
        }
        for (const [x, y] of shore) grid[y][x] = biome.shore;
    }

    // ---- invariante: tudo que importa é caminhável e alcançável a partir do spawn ----
    const walkable = (x, y) => x >= 0 && y >= 0 && x < w && y < h && WORLD_LEGEND[grid[y][x]].walkable === true;
    if (!walkable(spawn.x, spawn.y)) throw new Error(`hunt map ${speciesId}: spawn bloqueado`);
    const seen = new Uint8Array(w * h), queue = [spawn.x + spawn.y * w];
    seen[queue[0]] = 1;
    for (let head = 0; head < queue.length; head++) {
        const cx = queue[head] % w, cy = Math.floor(queue[head] / w);
        for (const [sx, sy] of _WG_STEPS) {
            const nx = cx + sx, ny = cy + sy;
            if (walkable(nx, ny) && !seen[ny * w + nx]) { seen[ny * w + nx] = 1; queue.push(ny * w + nx); }
        }
    }
    for (const p of points) if (!walkable(p.x, p.y) || !seen[p.y * w + p.x]) throw new Error(`hunt map ${speciesId}: ponto (${p.x}, ${p.y}) inalcançável`);

    _worldHuntStats.generated++;
    const rows = Object.freeze(grid.map(r => r.join('')));
    const name = typeof spec.name === 'string' && spec.name ? spec.name : `#${speciesId}`;
    return Object.freeze({
        id: `hunt_${speciesId}`, type: 'hunt', name: `Área de caça: ${name}`, label: biome.name, speciesId, biome: biome.id,
        width: w, height: h, rows, spawn: Object.freeze({ x: spawn.x, y: spawn.y, dir: 'right' }),
        encounterPoints: Object.freeze(points.map(p => Object.freeze({ x: p.x, y: p.y }))),
        generator: Object.freeze({ version: WORLD_GEN_VERSION, seed }),
    });
}

// Mapa de caça de uma espécie REAL (existe em POKEMON_DATA), sob demanda e com cache LRU pequeno. Inválida/desconhecida → null.
function worldHuntMap(speciesId) {
    if (!Number.isInteger(speciesId) || speciesId < 1 || typeof POKEMON_DATA === 'undefined' || !_worldHas(POKEMON_DATA, String(speciesId))) return null;
    const hit = _worldHuntCache.get(speciesId);
    if (hit) { _worldHuntCache.delete(speciesId); _worldHuntCache.set(speciesId, hit); return hit; }
    const data = POKEMON_DATA[speciesId];
    const map = worldGenerateHuntMap({ speciesId, types: data.types, name: data.name });
    _worldHuntCache.set(speciesId, map);
    if (_worldHuntCache.size > WORLD_HUNT_CACHE_MAX) _worldHuntCache.delete(_worldHuntCache.keys().next().value);
    return map;
}

// `hunt_<n>` (forma canônica, sem zeros à esquerda) → mapa, senão null. Usado por getWorldMap.
function worldHuntMapById(mapId) {
    const m = typeof mapId === 'string' ? /^hunt_([1-9][0-9]{0,6})$/.exec(mapId) : null;
    return m ? worldHuntMap(Number(m[1])) : null;
}

function worldHuntStats() { return { generated: _worldHuntStats.generated, cached: _worldHuntCache.size }; }
function worldHuntCacheClear() { _worldHuntCache.clear(); }
