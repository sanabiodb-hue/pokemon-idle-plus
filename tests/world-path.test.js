'use strict';
// F7.7: busca de caminho (BFS) e percurso lógico. Tudo é conferido por verdades independentes (distância mínima por camadas, andar
// trecho a trecho com o motor de colisão) e com mapas sintéticos pequenos e mapas reais gerados.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadWorld } = require('./helpers/world-env');

const W = loadWorld();
const TILE = 16, SPEED = 64;
const mk = (rows, extra = {}) => ({ id: 'sint', type: 'hunt', width: rows[0].length, height: rows.length, rows, spawn: { x: 0, y: 0, dir: 'down' }, ...extra });
const adjacent = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
const blocked = (map, c) => W.WORLD_LEGEND[map.rows[c.y][c.x]].walkable !== true;

// Referência independente: distância mínima em passos por camadas (sem fila de índices nem ordem de vizinhos)
function shortestSteps(map, from, to) {
    const key = (c) => `${c.x},${c.y}`;
    let layer = [from], seen = new Set([key(from)]), steps = 0;
    while (layer.length) {
        if (layer.some(c => c.x === to.x && c.y === to.y)) return steps;
        const next = [];
        for (const c of layer) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const n = { x: c.x + dx, y: c.y + dy };
            if (n.x < 0 || n.y < 0 || n.x >= map.width || n.y >= map.height || blocked(map, n) || seen.has(key(n))) continue;
            seen.add(key(n)); next.push(n);
        }
        layer = next; steps++;
    }
    return null;
}

test('F7.7 caminho: encontra o caminho mais curto em campo aberto, 4-conectado, com origem e destino nas pontas', () => {
    const map = mk(['.......', '.......', '.......', '.......']);
    const cells = W.worldFindPath(map, { x: 0, y: 0 }, { x: 6, y: 3 });
    assert.equal(cells.length - 1, 9, 'distância de Manhattan');
    assert.deepEqual([cells[0].x, cells[0].y], [0, 0]);
    assert.deepEqual([cells.at(-1).x, cells.at(-1).y], [6, 3]);
    for (let i = 1; i < cells.length; i++) assert.ok(adjacent(cells[i - 1], cells[i]), `passo ${i} é de um tile`);
    assert.equal(new Set(cells.map(c => `${c.x},${c.y}`)).size, cells.length, 'sem repetir célula (sem loops)');
});

test('F7.7 caminho: contorna obstáculos, nunca pisa em célula bloqueada e tem o comprimento mínimo (conferido por referência independente)', () => {
    const map = mk([
        '.....T..',
        '.TTT.T.T',
        '.T...T..',
        '.T.TTT.T',
        '.T.....T',
        '...TTT..',
    ]);
    const from = { x: 0, y: 0 }, to = { x: 6, y: 4 };
    const cells = W.worldFindPath(map, from, to);
    assert.ok(cells, 'existe caminho');
    for (const c of cells) assert.equal(blocked(map, c), false, `(${c.x},${c.y}) é andável`);
    for (let i = 1; i < cells.length; i++) assert.ok(adjacent(cells[i - 1], cells[i]));
    assert.equal(cells.length - 1, shortestSteps(map, from, to), 'mesmo comprimento do caminho mínimo de referência');
    // água, lava e árvores bloqueiam como no resto do jogo
    const mixed = mk(['..~..', '..~..', '..L..', '..T..', '.....']);
    const p = W.worldFindPath(mixed, { x: 0, y: 0 }, { x: 4, y: 0 });
    assert.ok(p.every(c => !blocked(mixed, c)));
    assert.equal(p.length - 1, 4 + 2 * 4, 'dá a volta por baixo de água, lava e árvore');
});

test('F7.7 caminho: ordem de vizinhos documentada — esquerda, direita, cima, baixo — define o desempate entre caminhos de mesmo custo', () => {
    assert.equal(JSON.stringify(W.WORLD_PATH_NEIGHBORS), JSON.stringify([[-1, 0], [1, 0], [0, -1], [0, 1]]));
    const open = mk(['.....', '.....', '.....', '.....', '.....']);
    const key = (cells) => cells.map(c => `${c.x},${c.y}`).join(' ');
    const a = W.worldFindPath(open, { x: 0, y: 0 }, { x: 4, y: 4 });
    assert.equal(key(a), '0,0 1,0 2,0 3,0 4,0 4,1 4,2 4,3 4,4', 'valores fixos do desempate: aqui a ida segue pela borda superior e desce pela direita');
    const b = W.worldFindPath(open, { x: 4, y: 4 }, { x: 0, y: 0 });
    assert.equal(key(b), '4,4 3,4 2,4 1,4 0,4 0,3 0,2 0,1 0,0', 'a volta usa a borda inferior e sobe pela esquerda: ida e volta não precisam coincidir');
    // repetível
    for (let i = 0; i < 20; i++) assert.equal(key(W.worldFindPath(open, { x: 0, y: 0 }, { x: 4, y: 4 })), key(a));
    // o desempate não muda o custo
    assert.equal(a.length, b.length);
});

test('F7.7 caminho: casos-limite — mesma célula, origem/destino bloqueados, fora do mapa, entradas inválidas e destino inalcançável', () => {
    const map = mk(['..T..', '..T..', '..T..']);
    assert.equal(JSON.stringify(W.worldFindPath(map, { x: 1, y: 1 }, { x: 1, y: 1 })), '[{"x":1,"y":1}]');
    assert.equal(W.worldFindPath(map, { x: 0, y: 0 }, { x: 4, y: 0 }), null, 'parede total: inalcançável');
    assert.equal(W.worldFindPath(map, { x: 0, y: 0 }, { x: 2, y: 0 }), null, 'destino bloqueado');
    assert.equal(W.worldFindPath(map, { x: 2, y: 1 }, { x: 0, y: 0 }), null, 'origem bloqueada');
    for (const bad of [{ x: -1, y: 0 }, { x: 5, y: 0 }, { x: 0, y: 3 }, { x: 0.5, y: 0 }, { x: NaN, y: 0 }, { x: '1', y: 0 }, {}, null, undefined]) {
        assert.equal(W.worldFindPath(map, bad, { x: 0, y: 0 }), null, JSON.stringify(bad));
        assert.equal(W.worldFindPath(map, { x: 0, y: 0 }, bad), null, JSON.stringify(bad));
    }
    assert.equal(W.worldFindPath(null, { x: 0, y: 0 }, { x: 1, y: 0 }), null);
    assert.equal(W.worldFindPath({}, { x: 0, y: 0 }, { x: 1, y: 0 }), null);
    // mapa grande, destino cercado: termina rápido, sem loop e sem visitar a célula cercada
    const rows = Array.from({ length: 96 }, () => '.'.repeat(128).split(''));
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) rows[50 + dy][60 + dx] = 'T';
    const big = mk(rows.map(r => r.join('')));
    const t0 = process.hrtime.bigint();
    assert.equal(W.worldFindPath(big, { x: 0, y: 0 }, { x: 60, y: 50 }), null, 'cercado por quatro lados');
    assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 5000, 'termina (sem loop infinito)');
    const full = W.worldFindPath(big, { x: 0, y: 0 }, { x: 127, y: 95 });
    assert.equal(full.length - 1, 127 + 95);
});

test('F7.7 percurso: cada ponto candidato de mapas reais é alcançável pelo motor atual, com caminho verificado trecho a trecho por worldMoveBy', () => {
    const ids = [];
    for (let id = 1; id <= 1073; id += 37) ids.push(id);
    let paths = 0;
    for (const id of ids) {
        const map = W.worldHuntMap(id);
        let origin = map.spawn;
        for (const p of map.encounterPoints) {
            const cells = W.worldFindPath(map, origin, p);
            assert.ok(cells, `${map.id}: ponto (${p.x},${p.y}) alcançável`);
            for (const c of cells) assert.equal(W.worldCellBlocked(map, c.x, c.y), false);
            const wps = W.worldPathWaypoints(cells);
            assert.equal(W.worldVerifyPath(map, wps), true, `${map.id}: o motor de colisão percorre o caminho inteiro`);
            assert.equal(W.worldPolylineLength(wps), (cells.length - 1) * TILE);
            assert.equal(cells.length - 1, shortestSteps(map, origin, p), 'comprimento mínimo');
            origin = p;
            paths++;
        }
    }
    assert.ok(paths > 100, `caminhos conferidos: ${paths}`);
});

test('F7.7 percurso: uma parede que o caminho atravessaria é recusada pela verificação com o motor de colisão', () => {
    const map = mk(['...', '...', '...']);
    const wps = W.worldPathWaypoints([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
    assert.equal(W.worldVerifyPath(map, wps), true);
    const wall = mk(['.T.', '...', '...']);
    assert.equal(W.worldVerifyPath(wall, wps), false, 'atravessar árvore não passa');
    assert.equal(W.worldVerifyPath(map, []), false);
    assert.equal(W.worldVerifyPath(map, null), false);
});

test('F7.7 posição lógica: progresso em px ao longo do caminho, sem saltos, igual ao andar trecho a trecho pelo motor', () => {
    const map = mk(['......', '.TTT..', '......']);
    const cells = W.worldFindPath(map, { x: 0, y: 2 }, { x: 5, y: 0 });
    const wps = W.worldPathWaypoints(cells), total = W.worldPolylineLength(wps);
    assert.deepEqual([W.worldPathPosition(wps, 0).x, W.worldPathPosition(wps, 0).y], [wps[0].x, wps[0].y], 'começa no pé da origem');
    const end = W.worldPathPosition(wps, total);
    assert.deepEqual([end.x, end.y, end.done], [wps.at(-1).x, wps.at(-1).y, true]);
    assert.equal(W.worldPathPosition(wps, total + 1e6).done, true, 'passar do fim não passa do destino');
    assert.equal(W.worldPathPosition(wps, -50).x, wps[0].x, 'progresso negativo fica na origem');
    assert.equal(W.worldPathPosition(wps, NaN).x, wps[0].x);
    // sem teleporte: passo a passo, o deslocamento de um progresso para outro nunca excede a diferença de progresso
    let prev = W.worldPathPosition(wps, 0);
    for (let p = 1; p <= total; p += 1) {
        const cur = W.worldPathPosition(wps, p);
        assert.ok(Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) <= 1 + 1e-9, `salto em p=${p}`);
        assert.equal(W.worldCellBlocked(map, Math.floor(cur.x / TILE), Math.floor((cur.y - 1) / TILE)), false, 'sempre sobre terreno andável');
        prev = cur;
    }
    // equivalência com o motor de colisão: andar com worldMoveBy trecho a trecho dá a mesma posição do progresso fechado
    let state = { mapId: 'sint', x: wps[0].x, y: wps[0].y, dir: 'down', moving: false, distance: 0 };
    let walked = 0;
    for (let i = 1; i < wps.length; i++) {
        const dx = wps[i].x - state.x, dy = wps[i].y - state.y, dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
        const half = (Math.abs(dx) + Math.abs(dy)) / 2;
        state = W.worldMoveBy(map, state, dir, half); walked += half;
        const mid = W.worldPathPosition(wps, walked);
        assert.ok(Math.abs(mid.x - state.x) < 1e-9 && Math.abs(mid.y - state.y) < 1e-9, `meio do trecho ${i}`);
        state = W.worldMoveBy(map, state, dir, half); walked += half;
        const at = W.worldPathPosition(wps, walked);
        assert.ok(Math.abs(at.x - state.x) < 1e-9 && Math.abs(at.y - state.y) < 1e-9, `fim do trecho ${i}`);
        assert.equal(state.distance > 0, true);
    }
    assert.ok(Math.abs(state.distance - total) < 1e-9, 'distância percorrida pelo motor = comprimento do caminho');
});

test('F7.7 distância e tempo: o tempo de viagem é o comprimento do caminho (não a reta) ÷ velocidade, e dividir o tempo em passos não muda nada', () => {
    const map = mk(['.......', '.TTTTT.', '.......']);
    const cells = W.worldFindPath(map, { x: 0, y: 0 }, { x: 6, y: 2 });
    const wps = W.worldPathWaypoints(cells), total = W.worldPolylineLength(wps);
    assert.equal(total, (6 + 2) * TILE, 'o caminho é de Manhattan aqui (parede no meio obriga a contornar)');
    assert.ok(total > Math.hypot(6 * TILE, 2 * TILE), 'maior que a distância em linha reta');
    assert.equal(W.worldTravelTimeMs(total), (total / SPEED) * 1000);
    assert.equal(W.worldTravelTimeMs(total), 2000);
    const exact = W.worldPathPosition(wps, SPEED * 1.337);
    for (const step of [1, 7, 16.6667, 33, 50, 250, 1000]) {
        let progress = 0, t = 0;
        while (t + step < 1337) { progress += (SPEED * step) / 1000; t += step; }
        progress += (SPEED * (1337 - t)) / 1000;
        const pos = W.worldPathPosition(wps, progress);
        assert.ok(Math.abs(pos.x - exact.x) < 1e-6 && Math.abs(pos.y - exact.y) < 1e-6, `fatias de ${step} ms`);
    }
});
