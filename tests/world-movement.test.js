'use strict';
// F7.2: núcleo de movimento compartilhado (puro). Unidades: px do mundo (1 tile = 16), velocidade px/s, tempo ms.
// Cobre: distância = velocidade x tempo, independência da taxa de quadros, limite de passo, obstáculos e bordas com parada
// exata, hitbox, movimento automático até um destino, fórmulas fechadas (comprimento e tempo) e regras por tipo de mapa.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorld } = require('./helpers/world-env');

const W = loadWorld();
const TOWN = W.WORLD_MAPS.starter_town;
const ROUTE = W.WORLD_MAPS.kanto_route1;
const MOVE = W.WORLD_MOVEMENT;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// mapa de teste: letras da legenda real ('.' grama andável, 'T' árvore bloqueia)
const mk = (rows, extra = {}) => ({ id: 'teste', type: 'city', width: rows[0].length, height: rows.length, rows, spawn: { x: 1, y: 1, dir: 'down' }, ...extra });
const open = (n = 20) => mk(Array.from({ length: n }, () => '.'.repeat(n)));
const at = (map, x, y) => ({ ...W.worldCreateState(map), x, y });

// anda `totalMs` em passos de `frameMs` na direção `dir`
function walk(map, state, dir, totalMs, frameMs) {
    let s = state, left = totalMs;
    while (left > 1e-9) { const dt = Math.min(frameMs, left); s = W.worldStep(map, s, dir, dt); left -= dt; }
    return s;
}

test('F7.2 movimento: estado inicial vem do spawn do mapa (pés no centro da célula, um pouco abaixo) e começa parado', () => {
    const s = W.worldCreateState(TOWN);
    assert.equal(s.mapId, 'starter_town');
    assert.equal(s.x, TOWN.spawn.x * 16 + 8);
    assert.equal(s.y, TOWN.spawn.y * 16 + 13);
    assert.equal(s.dir, TOWN.spawn.dir);
    assert.equal(s.moving, false);
    assert.equal(s.distance, 0);
});

test('F7.2 movimento: distância percorrida = velocidade x tempo, nas quatro direções', () => {
    const map = open(), start = at(map, 160, 160);
    const d = { right: [1, 0], left: [-1, 0], down: [0, 1], up: [0, -1] };
    for (const [dir, [dx, dy]] of Object.entries(d)) {
        const s = walk(map, start, dir, 500, 50);                           // 0,5 s a 64 px/s = 32 px
        assert.ok(near(s.x, 160 + dx * 32) && near(s.y, 160 + dy * 32), dir);
        assert.ok(near(s.distance, 32), `${dir}: distância acumulada`);
        assert.equal(s.dir, dir);
        assert.equal(s.moving, true);
    }
    assert.equal(MOVE.walkSpeed, 64);
});

test('F7.2 movimento: o resultado não depende da taxa de quadros (30, 60, 144 e 20 Hz dão o mesmo lugar)', () => {
    const map = open(), start = at(map, 40, 40);
    const results = [1000 / 144, 1000 / 60, 1000 / 30, 50].map(ms => walk(map, walk(map, start, 'right', 1500, ms), 'down', 1200, ms));
    for (const r of results) { assert.ok(near(r.x, results[0].x, 1e-6) && near(r.y, results[0].y, 1e-6)); assert.ok(near(r.distance, 64 * 2.7, 1e-6)); }
    assert.ok(near(results[0].x, 40 + 96) && near(results[0].y, 40 + 76.8));
});

test('F7.2 movimento: um quadro nunca vale mais que maxStepMs (aba escondida não teletransporta); tempo inválido não move', () => {
    const map = open(), start = at(map, 100, 100);
    const big = W.worldStep(map, start, 'right', 10000);
    assert.ok(near(big.x - 100, (MOVE.walkSpeed * MOVE.maxStepMs) / 1000), 'um quadro gigante vale só maxStepMs');
    for (const bad of [NaN, -50, Infinity, undefined, 0]) {
        const s = W.worldStep(map, start, 'right', bad);
        assert.ok(s.x === 100 && s.distance === 0 && s.moving === false, `dt ${bad}`);
    }
    assert.equal(W.worldStep(map, start, null, 16).moving, false, 'sem direção não anda');
    assert.equal(W.worldStep(map, start, 'diagonal', 16).moving, false, 'direção desconhecida não anda');
    assert.ok(start.x === 100 && start.distance === 0, 'o estado original não é alterado (função pura)');
});

test('F7.2 movimento: obstáculos param na borda exata do tile, sem depender dos passos, e viram a direção', () => {
    const map = mk(['.........', '.....T...', '.........']);                  // árvore em (5,1): x 80..96
    const start = at(map, 24, 24);                                           // linha y=24 (célula 1)
    const results = [50, 16.7, 7].map(ms => walk(map, start, 'right', 3000, ms));
    const stop = 5 * 16 - MOVE.hitbox.halfW;                                 // borda esquerda da árvore menos a meia-largura
    for (const r of results) { assert.ok(r.x <= stop && r.x > stop - 1e-3, `parou em ${r.x}`); assert.equal(r.moving, false, 'encostado: não está andando'); assert.equal(r.dir, 'right'); }
    assert.ok(near(results[0].x, results[1].x, 1e-9) && near(results[1].x, results[2].x, 1e-9), 'mesma parada em qualquer taxa');
    assert.ok(near(results[0].distance, stop - 24, 1e-3), 'distância conta só o que andou');
    const again = W.worldStep(map, results[0], 'right', 50);
    assert.ok(again.x === results[0].x && again.moving === false && again.distance === results[0].distance, 'continuar empurrando não anda nem acumula distância');
    const turned = W.worldStep(map, results[0], 'up', 16);
    assert.equal(turned.dir, 'up', 'vira para a nova direção mesmo bloqueado');
});

test('F7.2 movimento: bordas do mapa também bloqueiam (as quatro)', () => {
    const map = open(5), hb = MOVE.hitbox;
    const start = at(map, 40, 40);
    const edge = (dir, axis) => walk(map, start, dir, 5000, 50)[axis];
    assert.ok(edge('left', 'x') >= hb.halfW && edge('left', 'x') < hb.halfW + 1e-3, 'esquerda');
    assert.ok(edge('right', 'x') <= 80 - hb.halfW && edge('right', 'x') > 80 - hb.halfW - 1e-3, 'direita');
    assert.ok(edge('up', 'y') >= hb.halfH && edge('up', 'y') < hb.halfH + 1e-3, 'cima');
    assert.ok(edge('down', 'y') <= 80 - hb.halfH && edge('down', 'y') > 80 - hb.halfH - 1e-3, 'baixo');
});

test('F7.2 movimento: a hitbox passa por um corredor de 1 tile, mas não entra nas paredes dele', () => {
    const map = mk(['TTTTTTT', '.......', 'TTTTTTT']);                      // corredor de 1 tile de altura (linha 1: y 16..32)
    const through = walk(map, at(map, 8, 24), 'right', 1500, 16);
    assert.ok(through.x > 90, 'atravessa o corredor sem engasgar');
    const down = walk(map, at(map, 40, 24), 'down', 2000, 16);
    assert.ok(down.y <= 32 - MOVE.hitbox.halfH && down.y > 32 - MOVE.hitbox.halfH - 1e-3, 'parede de baixo: para com a meia-altura da hitbox');
    const up = walk(map, at(map, 40, 24), 'up', 2000, 16);
    assert.ok(up.y >= 16 + MOVE.hitbox.halfH && up.y < 16 + MOVE.hitbox.halfH + 1e-3, 'parede de cima: idem');
    assert.ok(down.x === 40 && up.x === 40, 'bloquear num eixo não desloca o outro');
});

test('F7.2 movimento: passos grandes não atravessam um tile bloqueado (sem tunelamento)', () => {
    const map = mk(['......T......']);
    const s = W.worldMoveBy(map, at(map, 40, 8), 'right', 500);              // 500 px de uma vez
    assert.ok(s.x <= 6 * 16 - MOVE.hitbox.halfW, `parou antes da árvore: ${s.x}`);
});

test('F7.2 movimento automático: vai a um destino em L (x depois y), chega exato e não passa do alvo', () => {
    const map = open(), start = at(map, 24, 24), target = { x: 88, y: 88 };  // 64 em x + 64 em y = 128 px
    let s = start, arrived = false, steps = 0, elapsed = 0;
    while (!arrived && steps < 1000) { const r = W.worldAdvanceToward(map, s, target, 16); s = r.state; arrived = r.arrived; steps++; elapsed += 16; assert.equal(r.blocked, false); assert.ok(s.x <= 88 + 1e-9 && s.y <= 88 + 1e-9, 'nunca passa do alvo'); }
    assert.ok(arrived);
    assert.ok(near(s.x, 88, 1e-3) && near(s.y, 88, 1e-3));
    assert.ok(near(s.distance, 128, 1e-3), 'distância = comprimento do percurso em L');
    assert.equal(s.dir, 'down', 'terminou a perna vertical');
    const pass = W.worldAdvanceToward(map, at(map, 24, 24), { x: 88, y: 24 }, 50, 4000);   // 200 px disponíveis, 64 necessários
    assert.ok(pass.arrived && near(pass.state.x, 88) && near(pass.state.distance, 64), 'sobra de tempo não ultrapassa');
});

test('F7.2 movimento automático: o tempo que sobra de uma perna vale para a seguinte e o resultado não depende dos passos', () => {
    const map = open(), start = at(map, 24, 24), target = { x: 56, y: 88 };  // 32 em x e 64 em y
    const run = (ms) => { let s = start, left = 1000; while (left > 1e-9) { const dt = Math.min(ms, left); s = W.worldAdvanceToward(map, s, target, dt).state; left -= dt; } return s; };
    const a = run(50), b = run(1000 / 60), c = run(1000 / 144);
    for (const r of [b, c]) assert.ok(near(r.x, a.x, 1e-6) && near(r.y, a.y, 1e-6) && near(r.distance, a.distance, 1e-6));
    assert.ok(near(a.distance, 64, 1e-6), '1 s a 64 px/s: 32 em x + 32 em y');
    assert.ok(near(a.x, 56) && near(a.y, 56), 'dobrou a esquina dentro do mesmo segundo');
});

test('F7.2 movimento automático: obstáculo no caminho devolve blocked (sem teleporte e sem busca de caminho)', () => {
    const map = mk(['.......', '...T...', '.......']);
    let s = at(map, 8, 24), r;
    for (let i = 0; i < 200; i++) { r = W.worldAdvanceToward(map, s, { x: 100, y: 24 }, 16); s = r.state; if (r.blocked) break; }
    assert.equal(r.blocked, true);
    assert.equal(r.arrived, false);
    assert.ok(s.x < 100);
});

test('F7.2 fórmulas fechadas: comprimento do percurso e tempo de viagem coincidem com o movimento passo a passo', () => {
    const map = open(), start = at(map, 24, 24);
    const waypoints = [{ x: 120, y: 24 }, { x: 120, y: 200 }, { x: 40, y: 200 }];
    const length = W.worldPathLength({ x: start.x, y: start.y }, waypoints);
    assert.equal(length, 96 + 176 + 80);
    const ms = W.worldTravelTimeMs(length);
    assert.ok(near(ms, (352 / 64) * 1000));
    let s = start, elapsed = 0;
    for (const wp of waypoints) { let r; do { r = W.worldAdvanceToward(map, s, wp, 16); s = r.state; elapsed += 16; } while (!r.arrived && elapsed < 60000); }
    assert.ok(near(s.distance, length, 1e-3), 'o movimento percorreu exatamente o comprimento da fórmula');
    assert.ok(elapsed >= ms - 1 && elapsed <= ms + 3 * 16, `tempo simulado ${elapsed} ms ≈ fórmula ${ms} ms (diferença só da granularidade de quadro)`);
    assert.equal(W.worldTravelTimeMs(0), 0);
    assert.equal(W.worldTravelTimeMs(-5), 0);
    assert.equal(W.worldTravelTimeMs(100, 0), Infinity);
    assert.ok(near(W.worldTravelTimeMs(64, 128), 500), 'velocidade maior, tempo menor');
    assert.equal(W.worldPathLength({ x: 0, y: 0 }, []), 0);
});

test('F7.2 regras por tipo de mapa: só cidade aceita caminhada manual', () => {
    assert.equal(W.worldCanWalkManually(TOWN), true);
    assert.equal(W.worldCanWalkManually(ROUTE), false, 'rotas não aceitam caminhada manual');
    assert.equal(W.worldCanWalkManually({ type: 'hunt' }), false, 'áreas de caça também não');
    assert.equal(W.worldCanWalkManually(null), false);
    assert.equal(W.worldCanWalkManually({}), false, 'sem tipo = sem caminhada manual');
});

test('F7.2 interações: só em cidade, dentro do alcance, a mais próxima vence', () => {
    const center = TOWN.interactions.find(i => i.type === 'heal'), depot = TOWN.interactions.find(i => i.type === 'depot');
    const feet = (it, dx = 0, dy = 0) => ({ ...W.worldCreateState(TOWN), x: (it.cell.x + 0.5) * 16 + dx, y: (it.cell.y + 0.5) * 16 + dy });
    assert.equal(W.worldInteractionNear(TOWN, feet(center)).id, 'pokemon_center');
    assert.equal(W.worldInteractionNear(TOWN, feet(depot)).id, 'depot');
    assert.equal(W.worldInteractionNear(TOWN, feet(center, 19, 0)).id, 'pokemon_center', 'dentro do alcance (20 px)');
    assert.equal(W.worldInteractionNear(TOWN, feet(center, 25, 0)), null, 'fora do alcance');
    assert.equal(W.worldInteractionNear(TOWN, W.worldCreateState(TOWN)), null, 'no spawn não há serviço por perto');
    const two = mk(['.....'], { interactions: [{ id: 'a', type: 'heal', cell: { x: 1, y: 0 } }, { id: 'b', type: 'depot', cell: { x: 2, y: 0 } }] });
    assert.equal(W.worldInteractionNear(two, { x: 40, y: 8 }).id, 'b', 'a mais próxima vence');
    assert.equal(W.worldInteractionNear({ ...two, type: 'route' }, { x: 40, y: 8 }), null, 'rotas não têm serviços');
});

test('F7.2 cidade: prédios bloqueiam, as portas de serviço são alcançáveis andando de verdade (com a hitbox) a partir do spawn', () => {
    // BFS em células andáveis, depois anda de fato pelos centros das células com o movimento automático
    const walkable = (x, y) => !W.worldCellBlocked(TOWN, x, y);
    const bfs = (from, to) => {
        const prev = new Map([[`${from.x},${from.y}`, null]]), q = [from];
        while (q.length) { const c = q.shift(); if (c.x === to.x && c.y === to.y) break; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = { x: c.x + dx, y: c.y + dy }; const k = `${n.x},${n.y}`; if (walkable(n.x, n.y) && !prev.has(k)) { prev.set(k, c); q.push(n); } } }
        const path = []; let c = to; while (c) { path.unshift(c); c = prev.get(`${c.x},${c.y}`); } return path[0] && path[0].x === from.x && path[0].y === from.y ? path : null;
    };
    for (const it of TOWN.interactions) {
        assert.ok(walkable(it.cell.x, it.cell.y), `${it.id}: a célula de interação é andável`);
        const path = bfs({ x: TOWN.spawn.x, y: TOWN.spawn.y }, it.cell);
        assert.ok(path, `${it.id}: existe caminho a partir do spawn`);
        let s = W.worldCreateState(TOWN);
        for (const c of path) {
            const target = { x: (c.x + 0.5) * 16, y: (c.y + 0.5) * 16 };
            let guard = 0, r;
            do { r = W.worldAdvanceToward(TOWN, s, target, 16); s = r.state; guard++; } while (!r.arrived && !r.blocked && guard < 400);
            assert.equal(r.arrived, true, `${it.id}: chegou ao centro da célula (${c.x},${c.y})`);
        }
        assert.equal(W.worldInteractionNear(TOWN, s).id, it.id, `${it.id}: ao chegar, o serviço fica disponível`);
        // empurrar para a porta (cima) não entra no prédio
        const pushed = walk(TOWN, s, 'up', 2000, 16);
        assert.ok(pushed.y >= (it.cell.y) * 16 + MOVE.hitbox.halfH - 1e-3, `${it.id}: a porta bloqueia`);
    }
    const exitCol = TOWN.rows[TOWN.height - 1].indexOf('p');
    assert.ok(exitCol > 0 && W.worldKindAt(TOWN, exitCol, TOWN.height - 1) === 'path', 'o caminho sul leva à saída do mapa');
});
