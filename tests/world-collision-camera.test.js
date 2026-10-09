'use strict';
// F7.3: colisões e câmera de acompanhamento. Testes determinísticos com mapas sintéticos de vários tamanhos (inclusive um mapa
// muitas vezes maior que a tela). As propriedades são conferidas de forma INDEPENDENTE do motor: a sobreposição da hitbox com
// tiles bloqueados é recalculada aqui direto da legenda, sem chamar as funções de colisão do motor.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorld, shown, tick } = require('./helpers/world-env');

const W = loadWorld();
const TILE = W.WORLD_TILE_SIZE, MOVE = W.WORLD_MOVEMENT;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// ---- construtores de mapas sintéticos (letras da legenda real: '.' andável, 'T' árvore, '~' água, 'p' caminho)
const mk = (rows, extra = {}) => ({ id: 'sint', type: 'city', width: rows[0].length, height: rows.length, rows, spawn: { x: 1, y: 1, dir: 'down' }, ...extra });
const open = (w, h, ch = '.') => mk(Array.from({ length: h }, () => ch.repeat(w)));
const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const at = (map, x, y) => ({ ...W.worldCreateState(map), x, y });

// Verdade independente: a hitbox [x-halfW, x+halfW) x [y-halfH, y+halfH) toca algum tile bloqueado (ou sai do mapa)?
function overlapsBlocked(map, s) {
    const { halfW, halfH } = MOVE.hitbox, eps = 1e-3;
    const x0 = Math.floor((s.x - halfW + eps) / TILE), x1 = Math.floor((s.x + halfW - eps) / TILE);
    const y0 = Math.floor((s.y - halfH + eps) / TILE), y1 = Math.floor((s.y + halfH - eps) / TILE);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        if (x < 0 || y < 0 || x >= map.width || y >= map.height) return true;
        const def = W.WORLD_LEGEND[map.rows[y][x]];
        if (!def || def.walkable !== true) return true;
    }
    return false;
}

// =============================================================== terreno: fonte única de verdade
test('F7.3 terreno: cada letra da legenda declara `walkable`; o motor lê só essa propriedade (não o tipo)', () => {
    for (const [ch, def] of Object.entries(W.WORLD_LEGEND)) assert.equal(typeof def.walkable, 'boolean', `legenda "${ch}" sem walkable`);
    // o motor concorda com a legenda em todas as células dos mapas reais, e fora do mapa/letra desconhecida bloqueia
    for (const map of Object.values(W.WORLD_MAPS)) for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) {
        assert.equal(W.worldCellBlocked(map, x, y), W.WORLD_LEGEND[map.rows[y][x]].walkable !== true, `${map.id} (${x},${y})`);
    }
    const m = mk(['.?.']);
    assert.equal(W.worldCellBlocked(m, 1, 0), true, 'letra desconhecida bloqueia');
    assert.equal(W.worldCellBlocked(m, -1, 0), true, 'fora do mapa bloqueia');
    assert.equal(W.worldCellBlocked(m, 0, 5), true);
    // prova de que é a propriedade (e não o tipo) que manda: num contexto isolado, tornar a árvore andável libera a passagem
    const iso = loadWorld();
    const row = mk(['..T..']);
    assert.equal(iso.worldCellBlocked(row, 2, 0), true);
    iso.WORLD_LEGEND.T.walkable = true;
    assert.equal(iso.worldCellBlocked(row, 2, 0), false, 'árvore marcada como andável deixa de bloquear');
    let s = at(row, 8, 8); for (let i = 0; i < 80; i++) s = iso.worldStep(row, s, 'right', 50);
    assert.ok(s.x > 3 * TILE, 'atravessa a árvore quando a legenda diz que é andável');
    iso.WORLD_LEGEND['.'].walkable = false;
    assert.equal(iso.worldCellBlocked(row, 0, 0), true, 'grama marcada como não andável bloqueia');
    assert.equal(W.WORLD_LEGEND.T.walkable, false, 'o contexto principal não foi afetado');
});

test('F7.3 terreno: spawn, pontos de interação e caminho de saída das cidades ficam em células andáveis segundo a legenda', () => {
    for (const map of Object.values(W.WORLD_MAPS)) assert.equal(W.worldCellBlocked(map, map.spawn.x, map.spawn.y), false, `${map.id}: spawn andável`);
    const town = W.WORLD_MAPS.starter_town;
    for (const it of town.interactions) assert.equal(W.worldCellBlocked(town, it.cell.x, it.cell.y), false, `${it.id}: célula de interação andável`);
});

// =============================================================== colisão
test('F7.3 colisão: os quatro limites do mapa seguram o personagem, a partir de qualquer posição e com tempos irregulares', () => {
    const map = open(12, 9), r = rng(7);
    const lo = { x: MOVE.hitbox.halfW, y: MOVE.hitbox.halfH }, hi = { x: 12 * TILE - MOVE.hitbox.halfW, y: 9 * TILE - MOVE.hitbox.halfH };
    for (let k = 0; k < 40; k++) {
        let s = at(map, MOVE.hitbox.halfW + r() * (12 * TILE - 2 * MOVE.hitbox.halfW), MOVE.hitbox.halfH + r() * (9 * TILE - 2 * MOVE.hitbox.halfH));
        for (const dir of ['left', 'right', 'up', 'down']) for (let i = 0; i < 200; i++) {
            s = W.worldStep(map, s, dir, r() * 60);                       // intervalos irregulares, inclusive acima do teto de 50 ms
            assert.ok(s.x >= lo.x - 1e-3 && s.x <= hi.x + 1e-3 && s.y >= lo.y - 1e-3 && s.y <= hi.y + 1e-3, `${dir}: saiu do mapa (${s.x}, ${s.y})`);
            assert.equal(overlapsBlocked(map, s), false);
        }
    }
});

test('F7.3 colisão: velocidades enormes e quadros irregulares nunca atravessam uma parede de 1 tile (nem entram nela)', () => {
    const wall = mk(['..T..', '..T..', '..T..', '..T..', '..T..']);       // parede vertical de 1 tile no meio
    for (const speed of [64, 640, 6400, 64000, 1e6]) {
        let s = at(wall, 20, 40);
        for (let i = 0; i < 30; i++) { s = W.worldStep(wall, s, 'right', 50, speed); assert.equal(overlapsBlocked(wall, s), false, `v=${speed}`); }
        assert.ok(s.x <= 2 * TILE - MOVE.hitbox.halfW + 1e-3, `v=${speed}: ficou do lado esquerdo (x=${s.x})`);
    }
    const huge = W.worldMoveBy(wall, at(wall, 20, 40), 'right', 1e7);     // um único passo absurdo
    assert.ok(huge.x <= 2 * TILE - MOVE.hitbox.halfW + 1e-3 && overlapsBlocked(wall, huge) === false);
    // quadros muito irregulares (tempos aleatórios, muito pequenos e muito grandes) por 4.000 passos na cidade real
    const town = W.WORLD_MAPS.starter_town, r = rng(99);
    let s = W.worldCreateState(town), travelled = 0;
    for (let i = 0; i < 4000; i++) {
        const dir = ['up', 'down', 'left', 'right'][Math.floor(r() * 4)];
        const dt = r() < 0.05 ? 5000 : r() < 0.3 ? r() * 0.5 : r() * 80;
        const before = s;
        s = W.worldStep(town, s, dir, dt);
        travelled += Math.abs(s.x - before.x) + Math.abs(s.y - before.y);
        assert.equal(overlapsBlocked(town, s), false, `passo ${i}: hitbox dentro de obstáculo em (${s.x}, ${s.y})`);
    }
    assert.ok(near(s.distance, travelled, 1e-6), 'a distância acumulada é exatamente o que andou de verdade');
    assert.ok(travelled > 500, 'o personagem de fato andou bastante nesse teste');
});

test('F7.3 colisão: o resultado não depende da taxa de quadros, mesmo encostando em obstáculos', () => {
    const map = mk(['.......', '....T..', '.......', '.......']);
    const run = (frameMs) => { let s = at(map, 8, 24); for (const [dir, ms] of [['right', 1500], ['down', 600], ['right', 1500], ['up', 900]]) { let left = ms; while (left > 1e-9) { const dt = Math.min(frameMs, left); s = W.worldStep(map, s, dir, dt); left -= dt; } } return s; };
    const a = run(50), b = run(1000 / 60), c = run(1000 / 144), d = run(7);
    for (const o of [b, c, d]) assert.ok(near(o.x, a.x, 1e-6) && near(o.y, a.y, 1e-6) && near(o.distance, a.distance, 1e-6), 'mesma posição e distância');
});

test('F7.3 colisão: encostar numa parede e continuar empurrando não vibra, não anda e não acumula distância', () => {
    const map = mk(['....T....', '.........']);
    let s = at(map, 40, 8);
    s = W.worldMoveBy(map, s, 'right', 500);                              // encosta na árvore
    const rest = { x: s.x, y: s.y, d: s.distance };
    const seen = new Set();
    for (let i = 0; i < 500; i++) { s = W.worldStep(map, s, 'right', i % 2 ? 50 : 3.3); seen.add(`${s.x}|${s.y}`); assert.equal(s.moving, false); }
    assert.equal(seen.size, 1, 'uma única posição durante 500 quadros de empurrão: sem oscilar');
    assert.ok(s.x === rest.x && s.y === rest.y && s.distance === rest.d);
    assert.equal(s.dir, 'right', 'continua virado para o obstáculo');
});

test('F7.3 colisão: encostado numa parede ele continua deslizando ao longo dela com a distância cheia (sem atrito nem travadas)', () => {
    const map = mk(['TTT.', '..T.', '..T.', '..T.', '..T.', '..T.', '..T.', '..T.', '..T.']);    // parede à direita da coluna 1
    // encosta na parede da direita (x = 2*16 - halfW) e sobe/desce paralelo a ela
    let s = W.worldMoveBy(map, at(map, 10, 40), 'right', 100);
    assert.ok(s.x <= 2 * TILE - MOVE.hitbox.halfW + 1e-3 && s.x >= 2 * TILE - MOVE.hitbox.halfW - 1e-3, 'encostou na parede');
    const x = s.x;
    const down = W.worldStep(map, s, 'down', 50);
    assert.ok(near(down.y - s.y, 3.2, 1e-9) && down.x === x, 'desliza para baixo sem perder distância');
    const along = W.worldMoveBy(map, s, 'down', 60);
    assert.ok(near(along.y - s.y, 60, 1e-9) && along.x === x, '60 px junto da parede, todos percorridos');
    const up = W.worldMoveBy(map, along, 'up', 60);
    assert.ok(near(up.y, s.y, 1e-9), 'e volta');
});

test('F7.3 colisão: contornar um obstáculo funciona (lateral, passo à frente e volta) sem ficar preso', () => {
    const map = mk(['.......', '.......', '...T...', '.......', '.......']);   // árvore isolada em (3,2)
    let s = at(map, 8, 40);                                                  // linha da árvore, à esquerda dela
    s = W.worldMoveBy(map, s, 'right', 200);
    assert.ok(s.x <= 3 * TILE - MOVE.hitbox.halfW + 1e-3, 'bloqueado pela árvore');
    s = W.worldMoveBy(map, s, 'up', 20);                                      // sai da frente da árvore
    s = W.worldMoveBy(map, s, 'right', 80);
    assert.ok(s.x > 4 * TILE, 'passou pelo outro lado da árvore');
    s = W.worldMoveBy(map, s, 'down', 20);
    assert.equal(overlapsBlocked(map, s), false);
    assert.ok(s.distance > 100);
});

test('F7.3 colisão: em nenhuma posição válida da cidade o personagem fica preso para sempre', () => {
    const town = W.WORLD_MAPS.starter_town;
    let checked = 0;
    for (let y = 2; y < town.height * TILE; y += 2) for (let x = 5; x < town.width * TILE; x += 2) {
        const s = at(town, x, y);
        if (overlapsBlocked(town, s)) continue;
        checked++;
        const free = ['up', 'down', 'left', 'right'].filter(d => W.worldStep(town, s, d, 50).moving);
        assert.ok(free.length >= 1, `preso em (${x}, ${y}): nenhuma direção livre`);
    }
    assert.ok(checked > 5000, `posições válidas verificadas: ${checked}`);
});

test('F7.3 colisão: corredor de 1 tile — a janela de alinhamento é de (16 − 2·meia-largura) px e vale a pena documentar (jogador realinha)', () => {
    const map = mk(['T.T', 'T.T', 'T.T', 'T.T', 'T.T']);                     // corredor vertical de 1 tile (coluna 1)
    const passes = (x) => { let s = at(map, x, 70); for (let i = 0; i < 60; i++) s = W.worldStep(map, s, 'up', 50); return s.y < 20; };
    const okXs = []; for (let x = 16; x <= 32; x += 0.25) if (passes(x)) okXs.push(x);
    const width = okXs[okXs.length - 1] - okXs[0];
    assert.ok(near(width, TILE - 2 * MOVE.hitbox.halfW, 0.3), `janela medida ${width} px`);
    assert.ok(passes(24), 'alinhado ao centro passa');
    assert.ok(!passes(17), 'desalinhado fica bloqueado pelo canto');
    // e basta andar de lado para realinhar: não há armadilha
    let s = at(map, 17, 70); s = W.worldMoveBy(map, s, 'right', 7.5);
    for (let i = 0; i < 60; i++) s = W.worldStep(map, s, 'up', 50);
    assert.ok(s.y < 20, 'depois de se mexer 7,5 px passa');
});

test('F7.3 movimento automático: o mesmo teste de colisão vale para mapas de rota e de caça (que não aceitam caminhada manual)', () => {
    for (const type of ['route', 'hunt']) {
        const map = mk(['.....T....', '..........'], { type });
        assert.equal(W.worldCanWalkManually(map), false);
        let s = at(map, 8, 8), r;
        for (let i = 0; i < 400; i++) { r = W.worldAdvanceToward(map, s, { x: 152, y: 8 }, 16); s = r.state; if (r.arrived || r.blocked) break; assert.equal(overlapsBlocked(map, s), false); }
        assert.equal(r.blocked, true, `${type}: parou na árvore`);
        assert.ok(s.x <= 5 * TILE - MOVE.hitbox.halfW + 1e-3);
    }
});

// =============================================================== câmera
const BIG = open(200, 150);                                                  // 3.200 x 2.400 px: muito maior que qualquer tela
const metricsFor = (map, css, dpr = 1) => W.worldViewMetrics({ cssWidth: css[0], cssHeight: css[1], dpr, mapWidth: map.width * TILE, mapHeight: map.height * TILE });
const VIEWPORTS = [[374, 374, 3], [340, 340, 3], [1216, 496, 1], [900, 700, 2], [640, 300, 2]];

test('F7.3 câmera: em um mapa muito maior que a tela o personagem fica no centro enquanto há espaço e o cenário anda ao contrário', () => {
    for (const [w, h, dpr] of VIEWPORTS) {
        const m = metricsFor(BIG, [w, h], dpr);
        assert.ok(BIG.width * TILE > m.viewWidth * 4 && BIG.height * TILE > m.viewHeight * 4, 'mapa bem maior que a vista');
        let s = at(BIG, 100 * TILE, 75 * TILE), prev = W.worldCamera(BIG, m, W.worldCameraFocus(s));
        for (let i = 0; i < 40; i++) {
            s = W.worldStep(BIG, s, 'right', 50);
            const cam = W.worldCamera(BIG, m, W.worldCameraFocus(s));
            const px = W.worldToScreen(cam, m, s.x, s.y - 6);
            assert.ok(Math.abs(px.x - m.bufferWidth / 2) <= m.zoom, `${w}x${h}: personagem centrado em x (${px.x} vs ${m.bufferWidth / 2})`);
            assert.ok(Math.abs(px.y - m.bufferHeight / 2) <= m.zoom, 'e em y');
            assert.ok(cam.x >= prev.x, 'o cenário anda para a esquerda (câmera para a direita) enquanto o personagem vai para a direita');
            prev = cam;
        }
        assert.ok(prev.x > 100 * TILE - m.viewWidth / 2 - 1, 'a câmera realmente acompanhou');
    }
});

test('F7.3 câmera: nas quatro extremidades a câmera para e o personagem sai do centro; nunca revela fora do mapa', () => {
    for (const [w, h, dpr] of VIEWPORTS) {
        const m = metricsFor(BIG, [w, h], dpr), mapW = BIG.width * TILE, mapH = BIG.height * TILE;
        const cases = {
            esquerda: [TILE, 75 * TILE], direita: [mapW - TILE, 75 * TILE], topo: [100 * TILE, TILE], base: [100 * TILE, mapH - TILE],
            noroeste: [TILE, TILE], sudeste: [mapW - TILE, mapH - TILE],
        };
        for (const [name, [x, y]] of Object.entries(cases)) {
            const cam = W.worldCamera(BIG, m, W.worldCameraFocus(at(BIG, x, y)));
            assert.ok(cam.x >= 0 && cam.y >= 0, `${w}x${h} ${name}: não passa da borda esquerda/superior`);
            assert.ok(cam.x + m.viewWidth <= mapW + 1e-9 && cam.y + m.viewHeight <= mapH + 1e-9, `${w}x${h} ${name}: não passa da borda direita/inferior`);
            const v = W.worldVisibleCells(BIG, cam, m);
            assert.ok(v.x0 >= 0 && v.y0 >= 0 && v.x1 <= BIG.width - 1 && v.y1 <= BIG.height - 1, 'só células existentes');
        }
        const left = W.worldCamera(BIG, m, W.worldCameraFocus(at(BIG, TILE, 75 * TILE)));
        assert.equal(left.x, 0, 'parou na esquerda');
        const pl = W.worldToScreen(left, m, TILE, 75 * TILE - 6);
        assert.ok(pl.x < m.bufferWidth / 2 - m.zoom * 8, 'e o personagem saiu do centro, para a esquerda');
        const right = W.worldCamera(BIG, m, W.worldCameraFocus(at(BIG, mapW - TILE, 75 * TILE)));
        assert.ok(Math.abs(right.x - (mapW - m.viewWidth)) <= 1 / m.zoom, 'encostou na direita');
        const pr = W.worldToScreen(right, m, mapW - TILE, 75 * TILE - 6);
        assert.ok(pr.x > m.bufferWidth / 2 + m.zoom * 8, 'personagem à direita do centro');
        const top = W.worldCamera(BIG, m, W.worldCameraFocus(at(BIG, 100 * TILE, TILE)));
        assert.equal(top.y, 0, 'parou no topo');
        const bottom = W.worldCamera(BIG, m, W.worldCameraFocus(at(BIG, 100 * TILE, mapH - TILE)));
        assert.ok(Math.abs(bottom.y - (mapH - m.viewHeight)) <= 1 / m.zoom, 'encostou na base');
    }
});

test('F7.3 câmera: câmera passa por cada parte do mapa sem nunca sair dos limites (varredura contínua com o personagem andando)', () => {
    const map = open(60, 45), m = metricsFor(map, [374, 374], 3), mapW = 60 * TILE, mapH = 45 * TILE;
    let s = at(map, 20, 20), r = rng(5);
    for (let i = 0; i < 3000; i++) {
        s = W.worldStep(map, s, ['up', 'down', 'left', 'right'][Math.floor(i / 120) % 4], r() * 50);
        const cam = W.worldCamera(map, m, W.worldCameraFocus(s));
        assert.ok(cam.x >= 0 && cam.y >= 0 && cam.x + m.viewWidth <= mapW + 1e-9 && cam.y + m.viewHeight <= mapH + 1e-9, `quadro ${i}`);
        assert.ok(Number.isInteger(Math.round(cam.x * m.zoom)) && near(cam.x * m.zoom, Math.round(cam.x * m.zoom), 1e-6), 'câmera sempre em pixel inteiro do dispositivo');
    }
});

test('F7.3 câmera: mapa menor que a tela aparece INTEIRO e centralizado, com zoom inteiro, e a câmera não segue o personagem', () => {
    const small = open(10, 8);                                               // 160 x 128 px
    for (const [w, h, dpr] of [[1216, 496, 1], [900, 700, 2], [374, 374, 3], [1600, 900, 1]]) {
        const m = metricsFor(small, [w, h], dpr);
        assert.ok(Number.isInteger(m.zoom));
        assert.ok(small.width * TILE * m.zoom <= m.bufferWidth && small.height * TILE * m.zoom <= m.bufferHeight, `${w}x${h}: o mapa inteiro cabe`);
        assert.ok((small.width * TILE * (m.zoom + 1) > m.bufferWidth || small.height * TILE * (m.zoom + 1) > m.bufferHeight) || m.zoom >= 16, 'e é o maior zoom inteiro em que cabe');
        const camA = W.worldCamera(small, m, W.worldCameraFocus(at(small, 20, 20)));
        const camB = W.worldCamera(small, m, W.worldCameraFocus(at(small, 150, 120)));
        assert.ok(camA.x === camB.x && camA.y === camB.y, 'a câmera não se mexe com o personagem: o mapa inteiro está visível');
        const tl = W.worldToScreen(camA, m, 0, 0), br = W.worldToScreen(camA, m, small.width * TILE, small.height * TILE);
        assert.ok(tl.x >= 0 && tl.y >= 0 && br.x <= m.bufferWidth && br.y <= m.bufferHeight, 'cantos do mapa dentro do buffer');
        assert.ok(Math.abs(tl.x - (m.bufferWidth - br.x)) <= 1 && Math.abs(tl.y - (m.bufferHeight - br.y)) <= 1, 'barras iguais dos dois lados: centralizado');
        const v = W.worldVisibleCells(small, camA, m);
        assert.deepEqual([v.x0, v.y0, v.x1, v.y1], [0, 0, 9, 7], 'todas as células visíveis');
    }
});

test('F7.3 câmera: mapa menor em um só eixo centraliza esse eixo e segue no outro (sem revelar nada fora do mapa)', () => {
    const wideShort = open(80, 6), m = metricsFor(wideShort, [374, 374], 3);   // largo e baixo: 1280 x 96 px
    const mapW = 80 * TILE, mapH = 6 * TILE;
    assert.ok(mapH * m.zoom <= m.bufferHeight, 'mais baixo que a vista');
    const a = W.worldCamera(wideShort, m, W.worldCameraFocus(at(wideShort, 300, 50))), b = W.worldCamera(wideShort, m, W.worldCameraFocus(at(wideShort, 900, 50)));
    assert.ok(a.y === b.y && Math.abs(a.y - (mapH - m.viewHeight) / 2) <= 1 / m.zoom, 'eixo curto: fixo e centralizado');
    assert.ok(b.x > a.x + 500, 'eixo longo: segue');
    assert.ok(a.x >= 0 && b.x + m.viewWidth <= mapW + 1e-9);
    const tall = open(6, 80), mt = metricsFor(tall, [374, 374], 3);
    const c = W.worldCamera(tall, mt, W.worldCameraFocus(at(tall, 50, 300))), d = W.worldCamera(tall, mt, W.worldCameraFocus(at(tall, 50, 900)));
    assert.ok(c.x === d.x && d.y > c.y + 500, 'o inverso também');
});

test('F7.3 câmera: mover a câmera (ou trocar o tamanho/zoom da tela) não altera a posição lógica, a distância nem a velocidade', () => {
    const map = open(120, 90);
    const script = []; const r = rng(21);
    for (let i = 0; i < 600; i++) script.push([['up', 'down', 'left', 'right'][Math.floor(i / 50) % 4], r() * 50]);
    const play = (css, dpr) => {
        const m = metricsFor(map, css, dpr);
        let s = Object.freeze(at(map, 60 * TILE, 45 * TILE));
        let cams = 0;
        for (const [dir, dt] of script) {
            s = Object.freeze(W.worldStep(map, s, dir, dt));                  // estado congelado: qualquer escrita lançaria erro
            const cam = W.worldCamera(map, m, W.worldCameraFocus(s));         // a câmera só LÊ o estado
            W.worldToScreen(cam, m, s.x, s.y); W.worldVisibleCells(map, cam, m); cams++;
        }
        return { s, cams };
    };
    const a = play([374, 374], 3), b = play([1216, 496], 1), c = play([640, 300], 2);
    for (const o of [b, c]) { assert.ok(near(o.s.x, a.s.x) && near(o.s.y, a.s.y) && near(o.s.distance, a.s.distance), 'mesma posição lógica e distância em qualquer tela'); assert.equal(o.cams, 600); }
    const frozen = Object.freeze(at(map, 100, 100));
    assert.doesNotThrow(() => W.worldCamera(map, metricsFor(map, [374, 374], 3), W.worldCameraFocus(frozen)));
    const speedProbe = W.worldStep(map, at(map, 500, 500), 'right', 50);
    assert.ok(near(speedProbe.distance, 64 * 0.05), 'a velocidade continua 64 px/s independente da câmera');
});

// =============================================================== coordenadas
test('F7.3 coordenadas: mundo↔tela é inversa em qualquer câmera (inclusive negativa), em pixels inteiros do dispositivo', () => {
    const r = rng(3);
    for (const [w, h, dpr, map] of [[374, 374, 3, BIG], [1216, 496, 1, open(10, 8)], [640, 300, 2, open(80, 6)], [900, 700, 2, W.WORLD_MAPS.starter_town]]) {
        const m = metricsFor(map, [w, h], dpr);
        for (let i = 0; i < 300; i++) {
            const cam = W.worldCamera(map, m, { x: r() * map.width * TILE, y: r() * map.height * TILE });
            const wx = r() * map.width * TILE, wy = r() * map.height * TILE;
            const scr = W.worldToScreen(cam, m, wx, wy);
            assert.ok(Number.isInteger(scr.x) && Number.isInteger(scr.y));
            const back = W.worldFromScreen(cam, m, scr.x, scr.y);
            assert.ok(Math.abs(back.x - wx) <= 0.5 / m.zoom + 1e-9 && Math.abs(back.y - wy) <= 0.5 / m.zoom + 1e-9, 'ida e volta dentro de meio pixel do dispositivo');
            const again = W.worldToScreen(cam, m, back.x, back.y);
            assert.ok(again.x === scr.x && again.y === scr.y, 'tela→mundo→tela é a identidade');
        }
    }
});

test('F7.3 coordenadas: a câmera segue o ponto dos pés com um deslocamento único e central (worldCameraFocus)', () => {
    const s = at(open(10, 10), 77, 99);
    const f = W.worldCameraFocus(s);
    assert.ok(f.x === 77 && f.y < 99 && f.y > 99 - 16, 'foco = pés levemente acima (centro do corpo), definido num só lugar');
    assert.ok(Object.isFrozen(s) === false && s.x === 77 && s.y === 99, 'consultar o foco não altera o estado');
});

// =============================================================== integração com a view (F7.2 preservada)
async function bigCity(extra = {}) {
    return shown({ ...extra, setup: (w) => { w.WORLD_MAPS.cidade_grande = { id: 'cidade_grande', type: 'city', name: 'Cidade Grande', width: 120, height: 90, label: 'campo aberto', spawn: { x: 60, y: 45, dir: 'down' }, rows: Array.from({ length: 90 }, (_, y) => (y === 0 || y === 89 ? 'T'.repeat(120) : 'T' + '.'.repeat(118) + 'T')) }; } });
}

test('F7.3 view: num mapa grande o desenho acompanha o personagem (tiles deslocam, pés ficam no centro) e a lógica não depende disso', async () => {
    const { env, view } = await bigCity();
    view.setArea('cidade_grande'); env.flush();
    const map = view.currentScene().map;
    const p0 = { ...view._player(map) }, c0 = { ...view.lastCamera };
    env.key('keydown', 'ArrowRight'); env.flush(16);
    for (let i = 0; i < 40; i++) env.flush(25);                                // 1 s de movimento
    env.key('keyup', 'ArrowRight'); env.flush(20);
    const p1 = view._player(map), c1 = view.lastCamera, m = view.lastMetrics;
    assert.ok(near(p1.x - p0.x, 64, 0.5), `andou 64 px: ${p1.x - p0.x}`);
    assert.ok(near(c1.x - c0.x, p1.x - p0.x, 1 / m.zoom + 1e-9), 'a câmera andou o mesmo tanto que o personagem');
    const feet = W.worldToScreen(c1, m, p1.x, p1.y - 6);
    assert.ok(Math.abs(feet.x - m.bufferWidth / 2) <= m.zoom && Math.abs(feet.y - m.bufferHeight / 2) <= m.zoom, 'personagem no centro da vista');
    // o que foi desenhado usa exatamente a conversão central
    const hero = env.draws.at(-1), tile = env.draws.at(-2);
    const expectHero = W.worldToScreen(c1, m, p1.x - W.WORLD_CHARACTER.anchor.x, p1.y - W.WORLD_CHARACTER.anchor.y);
    assert.ok(hero[5] === expectHero.x && Math.abs(hero[6] - expectHero.y) <= m.zoom, 'o personagem é desenhado onde worldToScreen manda');
    assert.ok(Number.isInteger(tile[5]) && Number.isInteger(tile[6]), 'tiles em pixels inteiros do dispositivo (nítido, sem tremor)');
});

test('F7.3 view: encostando nas bordas de um mapa grande a câmera para e o personagem sai do centro; colisão continua valendo', async () => {
    const { env, view } = await bigCity();
    view.setArea('cidade_grande'); env.flush();
    const map = view.currentScene().map;
    view._players.cidade_grande = { ...view._player(map), x: 3 * TILE, y: 45 * TILE };
    view.requestRedraw(true); env.flush();
    env.key('keydown', 'ArrowLeft'); env.flush(16);
    for (let i = 0; i < 80; i++) env.flush(25);                                // 2 s para a esquerda: bate na borda de árvores
    env.key('keyup', 'ArrowLeft'); env.flush(20);
    const p = view._player(map), cam = view.lastCamera, m = view.lastMetrics;
    assert.equal(cam.x, 0, 'câmera parou na borda esquerda');
    assert.ok(p.x >= TILE + MOVE.hitbox.halfW - 1e-3, 'colisão com a borda de árvores segura o personagem');
    const feet = W.worldToScreen(cam, m, p.x, p.y - 6);
    assert.ok(feet.x < m.bufferWidth / 2, 'personagem saiu do centro rumo à borda');
    const cells = W.worldVisibleCells(map, cam, m);
    assert.ok(cells.x0 === 0 && cells.y0 >= 0, 'nada fora do mapa foi desenhado');
});

test('F7.3 view: mapa pequeno aparece inteiro e centralizado, e andar não desloca o cenário', async () => {
    const { env, view } = await shown({ setup: (w) => { w.WORLD_MAPS.pracinha = { id: 'pracinha', type: 'city', name: 'Pracinha', width: 8, height: 6, label: 'pracinha', spawn: { x: 2, y: 2, dir: 'down' }, rows: Array.from({ length: 6 }, (_, y) => (y === 0 || y === 5 ? 'T'.repeat(8) : 'T' + '.'.repeat(6) + 'T')) }; } });
    view.setArea('pracinha'); env.flush();
    const map = view.currentScene().map, m0 = view.lastMetrics, c0 = { ...view.lastCamera };
    assert.ok(8 * TILE * m0.zoom <= m0.bufferWidth && 6 * TILE * m0.zoom <= m0.bufferHeight, 'cabe inteiro');
    env.key('keydown', 'ArrowRight'); env.flush(16); for (let i = 0; i < 20; i++) env.flush(25); env.key('keyup', 'ArrowRight'); env.flush(20);
    assert.ok(view._player(map).x > 2 * TILE + 20, 'o personagem andou');
    assert.ok(view.lastCamera.x === c0.x && view.lastCamera.y === c0.y, 'a câmera ficou parada: o mapa inteiro está na tela');
    assert.ok(view.lastCamera.x < 0, 'câmera negativa = mapa centralizado com barras iguais');
});

test('F7.3 view: caminhada manual segue restrita a cidades; rotas e áreas de caça não andam (a câmera de mapa grande não muda isso)', async () => {
    const { env, view } = await shown({ setup: (w) => { w.WORLD_MAPS.caca_grande = { id: 'caca_grande', type: 'hunt', name: 'Caça Grande', width: 100, height: 80, label: 'campo', spawn: { x: 50, y: 40, dir: 'down' }, rows: Array.from({ length: 80 }, () => '.'.repeat(100)) }; } });
    for (const area of ['kanto_route1', 'caca_grande']) {
        view.setArea(area); env.flush();
        const map = view.currentScene().map, x = view._player(map).x;
        env.key('keydown', 'ArrowRight'); env.key('keydown', 'KeyD');
        assert.equal(env.pending(), 0, `${area}: teclas não agendam movimento`);
        env.flush(16);
        assert.equal(view._player(map).x, x, `${area}: o personagem não anda`);
    }
});
