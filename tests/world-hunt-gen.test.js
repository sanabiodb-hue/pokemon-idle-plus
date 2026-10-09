'use strict';
// F7.4: geração procedural determinística dos mapas de caça (biomas por tipo, semente por espécie, rede de caminhos protegida).
// As propriedades são conferidas de forma INDEPENDENTE do gerador: a busca em largura e as checagens de terreno são refeitas aqui
// direto da legenda. O varrimento das 1.073 espécies roda num contexto nativo (o mesmo código-fonte, sem vm: ~5x mais rápido).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWorld, ROOT } = require('./helpers/world-env');
const { loadData } = require('../tools/load-context');

const W = loadWorld();
const DATA = loadData();
const SPECIES_IDS = Object.keys(DATA.POKEMON_DATA).map(Number);

// ---- contexto nativo (varrimento completo) ----
let _native = null, _all = null;
function native() {
    if (!_native) {
        const src = ['world-data', 'world-biomes', 'world-gen'].map(f => fs.readFileSync(path.join(ROOT, 'js', 'world', f + '.js'), 'utf8')).join('\n;\n');
        _native = new Function('POKEMON_DATA', `var WORLD_MAPS;\n${src}\n;return { WORLD_LEGEND, WORLD_BIOMES, WORLD_GEN_LIMITS, worldHuntMap, worldGenerateHuntMap, worldHuntSeed, worldHuntStats };`)(DATA.POKEMON_DATA);
    }
    return _native;
}
function allMaps() {
    if (!_all) { const N = native(); _all = SPECIES_IDS.map(id => N.worldHuntMap(id)); }
    return _all;
}

// ---- verdade independente ----
const walkableAt = (legend, map, x, y) => x >= 0 && y >= 0 && x < map.width && y < map.height && legend[map.rows[y][x]] !== undefined && legend[map.rows[y][x]].walkable === true;
function bfs(legend, map) {
    const dist = new Int32Array(map.width * map.height).fill(-1), q = [map.spawn.x + map.spawn.y * map.width];
    dist[q[0]] = 0;
    for (let head = 0; head < q.length; head++) {
        const cx = q[head] % map.width, cy = Math.floor(q[head] / map.width);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (walkableAt(legend, map, nx, ny) && dist[ny * map.width + nx] < 0) { dist[ny * map.width + nx] = dist[q[head]] + 1; q.push(ny * map.width + nx); }
        }
    }
    return dist;
}
const checksum = (m) => { let h = 0x811c9dc5; for (const ch of m.rows.join('|') + JSON.stringify(m.spawn) + JSON.stringify(m.encounterPoints)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16); };
const snapshot = (m) => JSON.stringify({ id: m.id, w: m.width, h: m.height, rows: m.rows, spawn: m.spawn, pts: m.encounterPoints, b: m.biome, g: m.generator });

// =============================================================== biomas
test('F7.4 biomas: cada tipo aponta para um bioma existente e a prioridade cobre exatamente os tipos conhecidos', () => {
    const types = Object.keys(W.WORLD_TYPE_BIOME);
    assert.equal(types.length, 18);
    for (const [type, biome] of Object.entries(W.WORLD_TYPE_BIOME)) assert.ok(W.WORLD_BIOMES[biome], `${type} → ${biome}`);
    assert.deepEqual([...W.WORLD_TYPE_PRIORITY].sort(), [...types].sort(), 'cada tipo aparece uma única vez na prioridade');
    assert.ok(W.WORLD_BIOMES[W.WORLD_BIOME_FALLBACK], 'o fallback é um bioma real');
    const used = new Set(SPECIES_IDS.flatMap(id => DATA.POKEMON_DATA[id].types));
    assert.deepEqual([...used].sort(), [...types].sort(), 'os tipos da tabela de espécies são exatamente os que a regra conhece');
    for (const biome of new Set(Object.values(W.WORLD_TYPE_BIOME))) assert.equal(W.WORLD_BIOMES[biome].id, biome);
});

test('F7.4 biomas: regra de associação — tipo simples, tipo duplo por prioridade e fallback sempre presente', () => {
    const b = (...t) => W.worldBiomeForTypes(t);
    assert.equal(b('fire'), 'volcano'); assert.equal(b('water'), 'lake'); assert.equal(b('rock'), 'cave'); assert.equal(b('ice'), 'snow');
    assert.equal(b('ghost'), 'haunted'); assert.equal(b('grass'), 'forest'); assert.equal(b('normal'), 'meadow');
    assert.equal(b('grass', 'poison'), 'forest', 'Bulbasaur: grama vence veneno');
    assert.equal(b('poison', 'grass'), 'forest', 'a ordem dos tipos na espécie não importa');
    assert.equal(b('fire', 'flying'), 'volcano', 'Charizard');
    assert.equal(b('water', 'flying'), 'lake', 'Gyarados');
    assert.equal(b('ghost', 'poison'), 'haunted', 'Gengar');
    assert.equal(b('rock', 'water'), 'lake', 'água tem prioridade sobre pedra');
    assert.equal(b('dragon', 'ground'), 'cave', 'terra tem prioridade sobre dragão');
    assert.equal(b('bug', 'flying'), 'forest');
    assert.equal(b('normal', 'flying'), 'meadow');
    // entradas ausentes/inválidas → fallback documentado
    for (const bad of [undefined, null, [], 'fire', 42, {}, ['???'], [null, 3], ['constructor'], ['__proto__'], ['toString']]) assert.equal(W.worldBiomeForTypes(bad), W.WORLD_BIOME_FALLBACK, JSON.stringify(bad));
    assert.equal(b('???', 'fire'), 'volcano', 'tipo inválido ao lado de um válido: o válido vale');
});

test('F7.4 biomas: todo bioma só usa letras da legenda, com terreno coerente (chão andável, obstáculo/líquido não andável)', () => {
    const L = W.WORLD_LEGEND, tiles = W.WORLD_TILESET.tiles;
    for (const biome of Object.values(W.WORLD_BIOMES)) {
        for (const [ch, weight] of biome.ground) { assert.ok(L[ch] && L[ch].walkable === true && L[ch].kind === 'ground', `${biome.id} chão ${ch}`); assert.ok(weight > 0); }
        for (const [ch, weight] of biome.obstacles.symbols) { assert.ok(L[ch] && L[ch].walkable === false, `${biome.id} obstáculo ${ch}`); assert.ok(weight > 0); }
        assert.ok(L[biome.border] && L[biome.border].walkable === false, `${biome.id} moldura`);
        if (biome.patch) assert.ok(L[biome.patch.ch].walkable === true, `${biome.id} manchas andáveis`);
        if (biome.liquid) assert.ok(L[biome.liquid.ch].walkable === false && ['water', 'lava'].includes(L[biome.liquid.ch].kind), `${biome.id} líquido`);
        if (biome.shore) assert.ok(L[biome.shore].walkable === true, `${biome.id} margem andável`);
        assert.ok(biome.meander >= 0 && biome.meander < 1);
        assert.ok(biome.width[0] >= W.WORLD_GEN_LIMITS.minWidth && biome.width[1] <= W.WORLD_GEN_LIMITS.maxWidth && biome.width[0] <= biome.width[1], `${biome.id} largura`);
        assert.ok(biome.height[0] >= W.WORLD_GEN_LIMITS.minHeight && biome.height[1] <= W.WORLD_GEN_LIMITS.maxHeight && biome.height[0] <= biome.height[1], `${biome.id} altura`);
    }
    // toda letra da legenda aponta para um tile que existe no tileset (inclusive os novos) e cabe na imagem
    const total = W.WORLD_TILESET.cols * W.WORLD_TILESET.rows;
    for (const [ch, def] of Object.entries(L)) {
        if (def.kind === 'path' || def.kind === 'water' || def.kind === 'lava') continue;
        const t = tiles[def.tile];
        assert.ok(t !== undefined, `${ch}: tile ${def.tile}`);
        for (const index of [].concat(t)) assert.ok(Number.isInteger(index) && index >= 0 && index < total, `${ch}: índice ${index}`);
    }
    assert.ok(tiles.lavaBase + 15 < total && tiles.waterBase + 15 < total && tiles.pathBase + 15 < total);
});

test('F7.4 assets: o PNG do tileset tem o tamanho que WORLD_TILESET declara', () => {
    const png = fs.readFileSync(path.join(ROOT, 'sprites', 'world', 'tileset.png'));
    assert.equal(png.readUInt32BE(16), W.WORLD_TILESET.cols * W.WORLD_TILE_SIZE);
    assert.equal(png.readUInt32BE(20), W.WORLD_TILESET.rows * W.WORLD_TILE_SIZE);
});

// =============================================================== determinismo e identidade
test('F7.4 determinismo: a mesma espécie gera exatamente o mesmo mapa (repetido, sem cache, em outro contexto e depois de outras gerações)', () => {
    const ids = [1, 4, 7, 25, 74, 92, 131, 150, 361, 1073];
    const first = ids.map(id => snapshot(W.worldHuntMap(id)));
    W.worldHuntCacheClear();
    for (const id of [900, 3, 600, 10]) W.worldHuntMap(id);                          // outras gerações no meio não influenciam
    ids.forEach((id, i) => assert.equal(snapshot(W.worldHuntMap(id)), first[i], `espécie ${id}`));
    const other = loadWorld();                                                        // outro contexto (outra "sessão")
    ids.forEach((id, i) => assert.equal(snapshot(other.worldHuntMap(id)), first[i], `contexto novo, espécie ${id}`));
    const d = DATA.POKEMON_DATA[25];
    const pure = W.worldGenerateHuntMap({ speciesId: 25, types: d.types, name: d.name });                    // sem cache
    assert.equal(snapshot(pure), first[ids.indexOf(25)]);
    assert.notEqual(pure, W.worldHuntMap(25), 'geração pura devolve um objeto novo; o conteúdo é igual');
});

test('F7.4 determinismo: não depende de Math.random, do relógio nem de quadros desenhados', () => {
    const realRandom = Math.random, realNow = Date.now;
    let touched = 0;
    Math.random = () => { touched++; return 0.5; };
    Date.now = () => { touched++; return 0; };
    try {
        const N = native();                                                          // contexto nativo: usa o mesmo Math/Date que estamos trocando
        const a = snapshot(N.worldGenerateHuntMap({ speciesId: 6, types: ['fire', 'flying'], name: 'x' }));
        const b = snapshot(N.worldGenerateHuntMap({ speciesId: 6, types: ['fire', 'flying'], name: 'x' }));
        assert.equal(a, b);
        assert.equal(touched, 0, 'o gerador não leu Math.random nem Date.now');
    } finally { Math.random = realRandom; Date.now = realNow; }
    const src = ['world-biomes', 'world-gen'].map(f => fs.readFileSync(path.join(ROOT, 'js', 'world', f + '.js'), 'utf8')).join('\n').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random|Date\.now|performance\.now|new Date\(/.test(src), 'sem fontes de aleatoriedade/tempo no código');
});

test('F7.4 determinismo: valores fixos (golden) — mudou o algoritmo ou os biomas? some 1 em WORLD_GEN_VERSION e atualize', () => {
    assert.equal(W.WORLD_GEN_VERSION, 1);
    const golden = { 1: ['forest', '112x60', 795463433, '95765247'], 25: ['meadow', '97x65', 3879105865, 'cad03750'], 150: ['haunted', '69x50', 3402270965, 'eb944635'], 1073: ['cave', '70x60', 84970993, 'd6bb468c'] };
    for (const [id, [biome, size, seed, sum]] of Object.entries(golden)) {
        const m = W.worldHuntMap(Number(id));
        assert.deepEqual([m.biome, `${m.width}x${m.height}`, W.worldHuntSeed(Number(id)), checksum(m)], [biome, size, seed, sum], `espécie ${id}`);
    }
});

test('F7.4 identidade: cada espécie tem id de mapa e semente próprios, independentes de rota', () => {
    const maps = allMaps(), N = native();
    assert.equal(new Set(maps.map(m => m.id)).size, SPECIES_IDS.length, 'ids de mapa únicos');
    assert.equal(new Set(SPECIES_IDS.map(id => N.worldHuntSeed(id))).size, SPECIES_IDS.length, 'sementes únicas');
    for (const m of maps) { assert.equal(m.id, `hunt_${m.speciesId}`); assert.equal(m.type, 'hunt'); assert.ok(!('routeId' in m), 'sem vínculo com rota'); assert.equal(m.generator.version, W.WORLD_GEN_VERSION); }
    assert.ok(!Object.values(W.WORLD_ROUTE_MAPS).some(v => /^hunt_/.test(v)), 'nenhuma rota de progressão aponta para mapas de caça');
    assert.ok(!Object.keys(W.WORLD_MAPS).some(k => /^hunt_/.test(k)), 'mapas de caça não são guardados em WORLD_MAPS');
});

test('F7.4 variação: espécies do mesmo bioma têm layouts diferentes usando os mesmos recursos visuais', () => {
    const maps = allMaps(), byBiome = {};
    for (const m of maps) (byBiome[m.biome] ||= []).push(m);
    assert.ok(Object.keys(byBiome).length >= 6, `biomas em uso: ${Object.keys(byBiome)}`);
    for (const [biome, list] of Object.entries(byBiome)) {
        assert.ok(list.length >= 20, `${biome}: espécies suficientes para comparar`);
        const palette = new Set([...W.WORLD_BIOMES[biome].ground.map(e => e[0]), ...W.WORLD_BIOMES[biome].obstacles.symbols.map(e => e[0]), W.WORLD_BIOMES[biome].border, W.WORLD_BIOMES[biome].path,
            ...(W.WORLD_BIOMES[biome].patch ? [W.WORLD_BIOMES[biome].patch.ch] : []), ...(W.WORLD_BIOMES[biome].liquid ? [W.WORLD_BIOMES[biome].liquid.ch] : []), ...(W.WORLD_BIOMES[biome].shore ? [W.WORLD_BIOMES[biome].shore] : [])]);
        const layouts = new Set(list.map(m => m.rows.join('')));
        assert.equal(layouts.size, list.length, `${biome}: nenhum layout repetido`);
        for (const m of list.slice(0, 40)) for (const row of m.rows) for (const ch of row) assert.ok(palette.has(ch), `${biome}: símbolo ${ch} fora do perfil`);
        const a = list[0], b = list[1];
        let same = 0, total = 0;
        for (let y = 0; y < Math.min(a.height, b.height); y++) for (let x = 0; x < Math.min(a.width, b.width); x++) { total++; if (a.rows[y][x] === b.rows[y][x]) same++; }
        assert.ok(same / total < 0.9, `${biome}: dois mapas do mesmo bioma não são quase idênticos (${(same / total).toFixed(2)})`);
        assert.notDeepEqual(a.encounterPoints, b.encounterPoints);
    }
});

// =============================================================== dimensões e terreno (todas as espécies)
test('F7.4 mapas: dimensões dentro dos limites e da faixa do bioma; tamanhos variados, sem usar sempre o máximo', () => {
    const maps = allMaps(), L = W.WORLD_GEN_LIMITS;
    const sizes = new Set();
    let tiles = 0, atMax = 0;
    for (const m of maps) {
        const biome = W.WORLD_BIOMES[m.biome];
        assert.ok(Number.isInteger(m.width) && Number.isInteger(m.height));
        assert.ok(m.width >= L.minWidth && m.width <= L.maxWidth && m.height >= L.minHeight && m.height <= L.maxHeight, `${m.id} limites`);
        assert.ok(m.width >= biome.width[0] && m.width <= biome.width[1] && m.height >= biome.height[0] && m.height <= biome.height[1], `${m.id} faixa do bioma`);
        assert.equal(m.rows.length, m.height);
        for (const row of m.rows) assert.equal(row.length, m.width);
        sizes.add(`${m.width}x${m.height}`); tiles += m.width * m.height;
        if (m.width === biome.width[1] && m.height === biome.height[1]) atMax++;
    }
    assert.ok(sizes.size > 150, `tamanhos distintos: ${sizes.size}`);
    assert.ok(atMax / maps.length < 0.01, `mapas no tamanho máximo: ${atMax}`);
    const avg = tiles / maps.length;
    assert.ok(avg > 2500 && avg < 6500, `área média ${Math.round(avg)} tiles`);
    assert.ok(Math.min(...maps.map(m => m.width)) >= 48 && Math.max(...maps.map(m => m.width)) > 100, 'dezenas a pouco mais de uma centena de tiles de largura');
});

test('F7.4 mapas: toda célula é um símbolo da legenda; moldura de obstáculos; terreno coerente com o perfil', () => {
    const N = native(), legend = N.WORLD_LEGEND;
    for (const m of allMaps()) {
        const biome = N.WORLD_BIOMES[m.biome];
        for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
            const ch = m.rows[y][x];
            assert.ok(legend[ch] !== undefined, `${m.id} (${x},${y}) símbolo desconhecido "${ch}"`);
            if (x === 0 || y === 0 || x === m.width - 1 || y === m.height - 1) assert.equal(ch, biome.border, `${m.id} moldura (${x},${y})`);
        }
    }
});

test('F7.4 mapas: ponto inicial e pontos candidatos válidos, caminháveis, espaçados e alcançáveis do spawn (busca em largura independente, todas as espécies)', () => {
    const N = native(), legend = N.WORLD_LEGEND;
    let minCount = 99, minFarthest = 1e9, minSpacing = 1e9;
    for (const m of allMaps()) {
        assert.ok(Number.isInteger(m.spawn.x) && Number.isInteger(m.spawn.y) && m.spawn.x >= 0 && m.spawn.y >= 0 && m.spawn.x < m.width && m.spawn.y < m.height, `${m.id} spawn dentro`);
        assert.ok(walkableAt(legend, m, m.spawn.x, m.spawn.y), `${m.id} spawn andável`);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) assert.ok(walkableAt(legend, m, m.spawn.x + dx, m.spawn.y + dy), `${m.id} spawn sem obstáculo ao redor`);
        const dist = bfs(legend, m);
        const pts = m.encounterPoints;
        assert.ok(pts.length >= 4 && pts.length <= 10, `${m.id} quantidade de pontos`);
        minCount = Math.min(minCount, pts.length);
        let farthest = 0;
        pts.forEach((p, i) => {
            assert.ok(p.x >= 0 && p.y >= 0 && p.x < m.width && p.y < m.height, `${m.id} ponto ${i} dentro`);
            assert.ok(walkableAt(legend, m, p.x, p.y), `${m.id} ponto ${i} andável`);
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) assert.ok(walkableAt(legend, m, p.x + dx, p.y + dy), `${m.id} ponto ${i}: clareira`);
            assert.ok(dist[p.y * m.width + p.x] >= 0, `${m.id} ponto ${i} (${p.x},${p.y}) inalcançável do spawn`);
            farthest = Math.max(farthest, dist[p.y * m.width + p.x]);
            for (let j = 0; j < i; j++) minSpacing = Math.min(minSpacing, Math.hypot(p.x - pts[j].x, p.y - pts[j].y));
        });
        assert.equal(new Set(pts.map(p => `${p.x},${p.y}`)).size, pts.length, `${m.id} pontos distintos`);
        minFarthest = Math.min(minFarthest, farthest);
    }
    assert.ok(minSpacing >= 6, `espaçamento mínimo entre pontos: ${minSpacing}`);
    assert.ok(minFarthest >= 30, `a distância até o ponto mais longe nunca é trivial (mínimo ${minFarthest} tiles = ${(minFarthest / 4).toFixed(1)} s andando)`);
});

test('F7.4 mapas: a rede é uma rede de verdade (corredor largo o bastante para a hitbox e a maior parte do chão acessível sem laços impossíveis)', () => {
    const N = native(), legend = N.WORLD_LEGEND;
    for (const m of allMaps().filter((_, i) => i % 7 === 0)) {
        const dist = bfs(legend, m);
        let reachable = 0;
        for (const d of dist) if (d >= 0) reachable++;
        assert.ok(reachable >= m.width * m.height * 0.25, `${m.id}: área acessível ${reachable}`);
        // caminho (letra própria do bioma) 4-conectado e protegido por faixa andável de 3 de largura: cada célula do caminho tem todo o 3x3 andável
        const pathChar = N.WORLD_BIOMES[m.biome].path;
        let paths = 0;
        for (let y = 1; y < m.height - 1; y++) for (let x = 1; x < m.width - 1; x++) if (m.rows[y][x] === pathChar) {
            paths++;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) assert.ok(walkableAt(legend, m, x + dx, y + dy), `${m.id}: corredor largo em (${x},${y})`);
        }
        assert.ok(paths >= 60, `${m.id}: caminhos desenhados ${paths}`);
    }
});

test('F7.4 biomas: mapas de biomas diferentes têm dados de terreno concretamente diferentes', () => {
    const maps = allMaps(), comp = {};
    for (const m of maps) {
        const c = (comp[m.biome] ||= { n: 0, cells: 0, counts: {} });
        c.n++; c.cells += m.width * m.height;
        for (const row of m.rows) for (const ch of row) c.counts[ch] = (c.counts[ch] || 0) + 1;
    }
    const share = (biome, chars) => chars.split('').reduce((s, ch) => s + (comp[biome].counts[ch] || 0), 0) / comp[biome].cells;
    const has = (biome, ch) => (comp[biome].counts[ch] || 0) > 0;
    // vulcão: cinza + basalto + lava, sem água; caverna: chão de caverna + pedregulhos, sem grama; neve: neve + pinheiros; etc.
    assert.ok(has('volcano', 'L') && has('volcano', 'a') && has('volcano', 'O') && !has('volcano', '~') && !has('volcano', 'w'));
    assert.ok(has('cave', 'c') && has('cave', 'R') && has('cave', 'X') && !has('cave', 'L') && !has('cave', '~') && !has('cave', 'w'));
    assert.ok(has('snow', 'n') && has('snow', 'P') && has('snow', 'i') && !has('snow', 'L') && !has('snow', 'T'));
    assert.ok(has('haunted', 'g') && has('haunted', 'd') && has('haunted', 't') && !has('haunted', 'T'));
    assert.ok(has('forest', 'T') && has('forest', 'w') && !has('forest', 'L') && !has('forest', 'R'));
    assert.ok(has('lake', '~') && has('lake', 'e') && !has('lake', 'L'));
    assert.ok(has('meadow', 'f') && has('meadow', 'y') && !has('meadow', 'L') && !has('meadow', 'R'));
    // proporções: floresta fechada × campo aberto; lago com muita água; cave mais bloqueada que o vulcão
    assert.ok(share('forest', 'TboR') > share('meadow', 'TbroR') * 2, 'floresta tem bem mais obstáculos que o campo');
    assert.ok(share('lake', '~') > 0.12 && share('lake', '~') > share('meadow', '~') * 2, 'lago tem muita água');
    assert.ok(share('volcano', 'L') > 0.06 && share('volcano', 'L') < 0.2, 'faixa de lava');
    assert.ok(share('cave', 'RXr') > share('volcano', 'Or') * 1.2, 'caverna mais fechada que o vulcão');
    // perfis distintos entre si (conjuntos de símbolos diferentes)
    const sets = Object.keys(comp).map(b => Object.keys(comp[b].counts).sort().join(''));
    assert.equal(new Set(sets).size, sets.length, 'cada bioma tem um conjunto de símbolos próprio');
});

// =============================================================== sob demanda, cache e entradas inválidas
test('F7.4 sob demanda: carregar os módulos não gera nenhum mapa; o cache é limitado e reaproveita', () => {
    const w = loadWorld();
    const stat = () => JSON.stringify(w.worldHuntStats());                           // objetos de outro contexto vm: compara por JSON
    assert.equal(stat(), '{"generated":0,"cached":0}', 'nada gerado ao carregar');
    const a = w.worldHuntMap(25);
    assert.equal(stat(), '{"generated":1,"cached":1}');
    assert.equal(w.worldHuntMap(25), a, 'segunda chamada reaproveita o mesmo objeto');
    assert.equal(w.getWorldMap('hunt_25'), a, 'getWorldMap resolve hunt_<espécie> pelo mesmo caminho');
    assert.equal(w.worldHuntStats().generated, 1, 'sem regerar');
    for (let id = 1; id <= 40; id++) w.worldHuntMap(id);
    const st = w.worldHuntStats();
    assert.equal(st.cached, 8, 'cache LRU limitado a 8 mapas');
    assert.equal(st.generated, 41, '1 (espécie 25) + 40 pedidos; a 25 já tinha saído do cache e foi regerada igual');
    w.worldHuntMap(40); w.worldHuntMap(39);
    assert.equal(w.worldHuntStats().generated, st.generated, 'os mais recentes continuam em cache');
    w.worldHuntMap(1);
    assert.equal(w.worldHuntStats().generated, st.generated + 1, 'um mapa antigo foi descartado e é regerado igual');
    w.worldHuntCacheClear();
    assert.equal(w.worldHuntStats().cached, 0);
});

test('F7.4 sob demanda: custo previsível — a quantidade de células/ruído por mapa é limitada pelos limites de dimensão', () => {
    const L = W.WORLD_GEN_LIMITS, maxCells = L.maxWidth * L.maxHeight;
    for (const m of allMaps()) assert.ok(m.width * m.height <= maxCells);
    const retained = allMaps().reduce((s, m) => s + m.rows.join('').length, 0);
    assert.ok(retained / SPECIES_IDS.length < 8000, 'caracteres por mapa abaixo de 8 mil: materializar tudo (varrimento de teste) custaria só alguns MB, e o jogo nunca faz isso');
    assert.equal(native().worldHuntStats().cached, 8, 'mesmo após gerar 1.073 mapas o cache nativo guarda só 8');
});

test('F7.4 entradas inválidas: id desconhecido, tipos errados e formatos fora do padrão devolvem null sem lançar', () => {
    const w = loadWorld();
    for (const bad of [0, -1, 1.5, NaN, Infinity, '25', null, undefined, {}, [], 1074, 99999, 1e9, true]) assert.equal(w.worldHuntMap(bad), null, String(bad));
    for (const bad of ['hunt_0', 'hunt_01', 'hunt_25x', 'hunt_ 25', 'hunt_', 'hunt_-1', 'hunt_1.5', 'hunt_1074', 'Hunt_25', 'hunt_25 ', '', 'hunt', null, undefined, 25, {}, 'constructor', '__proto__', 'hunt_99999999']) assert.equal(w.getWorldMap(bad), null, String(bad));
    assert.ok(w.getWorldMap('hunt_1073') && w.getWorldMap('hunt_1'));
    for (const bad of [null, undefined, 5, 'x', {}, { speciesId: 'a' }, { speciesId: 0 }, { speciesId: -3 }, { speciesId: 1.2 }, { speciesId: NaN }, { speciesId: 1e12 }]) assert.equal(w.worldGenerateHuntMap(bad), null, JSON.stringify(bad));
    assert.equal(w.worldHuntStats().generated >= 2, true);
    assert.ok(w.getWorldMap('starter_town') && w.getWorldMap('kanto_route1'), 'mapas fixos seguem resolvendo');
    assert.equal(w.getWorldMap('nada'), null);
});

test('F7.4 espécies sintéticas: dados ausentes ou incompletos usam o fallback; ids fora da tabela funcionam pela geração pura', () => {
    const none = W.worldGenerateHuntMap({ speciesId: 5000000 });
    assert.equal(none.biome, W.WORLD_BIOME_FALLBACK);
    assert.equal(none.name, 'Área de caça: #5000000');
    const typed = W.worldGenerateHuntMap({ speciesId: 5000000, types: ['ice'], name: 'Sintético' });
    assert.equal(typed.biome, 'snow');
    assert.equal(typed.name, 'Área de caça: Sintético');
    assert.notEqual(none.rows.join(''), typed.rows.join(''));
    const odd = W.worldGenerateHuntMap({ speciesId: 7, types: ['???'], name: '' });
    assert.equal(odd.biome, W.WORLD_BIOME_FALLBACK);
    for (const id of [1, 2, 3, 100, 999, 5000000, 9999999]) for (const types of [undefined, [], ['fire'], ['water', 'ground'], ['ghost', 'dark']]) {
        const m = W.worldGenerateHuntMap({ speciesId: id, types });
        const dist = bfs(W.WORLD_LEGEND, m);
        assert.ok(m.encounterPoints.every(p => dist[p.y * m.width + p.x] >= 0), `${id} ${JSON.stringify(types)}`);
    }
});

test('F7.4 imutabilidade: o mapa devolvido (e o do cache) não pode ser alterado por quem o consome', () => {
    const m = W.worldHuntMap(25);
    assert.ok(Object.isFrozen(m) && Object.isFrozen(m.rows) && Object.isFrozen(m.spawn) && Object.isFrozen(m.encounterPoints) && Object.isFrozen(m.encounterPoints[0]) && Object.isFrozen(m.generator));
    const before = snapshot(m);
    assert.throws(() => { 'use strict'; m.width = 1; }, TypeError);
    assert.throws(() => { 'use strict'; m.rows[0] = 'x'; }, TypeError);
    assert.equal(snapshot(W.worldHuntMap(25)), before);
});

// =============================================================== compatibilidade com a engine existente
test('F7.4 engine: mapas de caça funcionam com o motor atual (tile, câmera, colisão, movimento automático) sem caminhada manual', () => {
    for (const id of [1, 4, 7, 74, 92, 143]) {
        const m = W.worldHuntMap(id), total = W.WORLD_TILESET.cols * W.WORLD_TILESET.rows;
        assert.equal(W.worldCanWalkManually(m), false, 'mapa de caça não aceita caminhada manual');
        for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) {
            const t = W.worldResolveTile(m, x, y);
            assert.ok(Number.isInteger(t) && t >= 0 && t < total, `${m.id} (${x},${y}) tile ${t}`);
            assert.equal(W.worldCellBlocked(m, x, y), W.WORLD_LEGEND[m.rows[y][x]].walkable !== true);
        }
        const s = W.worldCreateState(m);
        assert.equal(s.mapId, m.id);
        assert.ok(s.x === m.spawn.x * 16 + 8 && !W.worldCellBlocked(m, m.spawn.x, m.spawn.y));
        const metrics = W.worldViewMetrics({ cssWidth: 374, cssHeight: 374, dpr: 3, mapWidth: m.width * 16, mapHeight: m.height * 16 });
        const cam = W.worldCamera(m, metrics, W.worldCameraFocus(s));
        assert.ok(cam.x >= 0 && cam.y >= 0 && cam.x + metrics.viewWidth <= m.width * 16 + 1e-9 && cam.y + metrics.viewHeight <= m.height * 16 + 1e-9, 'câmera dentro do mapa grande');
        const moved = W.worldMoveBy(m, s, 'right', 40);
        assert.ok(moved.x > s.x && moved.distance > 0, 'a clareira do spawn deixa andar');
        const target = W.worldCellCenter(m, m.spawn.x + 3, m.spawn.y);
        const r = W.worldAdvanceToward(m, s, { x: target.x, y: s.y }, 50);
        assert.ok(r.state.x > s.x && !r.blocked, 'núcleo de movimento automático compartilhado funciona');
    }
});

test('F7.4 engine: a lava é autotile (kind lava) e o resto do terreno continua resolvendo como antes (cidade e Rota 1)', () => {
    const m = W.worldHuntMap(4);
    let lava = 0;
    for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) if (m.rows[y][x] === 'L') {
        lava++;
        const t = W.worldResolveTile(m, x, y);
        assert.ok(t >= W.WORLD_TILESET.tiles.lavaBase && t < W.WORLD_TILESET.tiles.lavaBase + 16);
        assert.equal(W.worldKindAt(m, x, y), 'lava');
        assert.equal(W.worldCellBlocked(m, x, y), true, 'lava não é andável');
    }
    assert.ok(lava > 100);
    const solo = { id: 's', type: 'hunt', width: 3, height: 3, rows: ['...', '.L.', '...'], spawn: { x: 0, y: 0 } };
    assert.equal(W.worldResolveTile(solo, 1, 1), W.WORLD_TILESET.tiles.lavaBase, 'lava isolada: máscara 0');
    const strip = { id: 'p', type: 'hunt', width: 3, height: 3, rows: ['...', 'LLL', '...'], spawn: { x: 0, y: 0 } };
    assert.equal(W.worldResolveTile(strip, 1, 1), W.WORLD_TILESET.tiles.lavaBase + 10, 'lava no meio de uma fileira: conecta leste e oeste (2 + 8)');
    for (const id of ['starter_town', 'kanto_route1']) {
        const map = W.getWorldMap(id);
        for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) assert.ok(W.WORLD_LEGEND[map.rows[y][x]], `${id} (${x},${y})`);
    }
    assert.equal(W.worldResolveTile(W.getWorldMap('kanto_route1'), 0, 0), W.worldResolveTile(W.getWorldMap('kanto_route1'), 0, 0));
});
