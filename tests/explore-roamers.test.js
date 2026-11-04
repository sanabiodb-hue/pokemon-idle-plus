'use strict';
// F10.6: Pokémon selvagens visíveis — só nas células de encontro, nascem longe do jogador, andam sem sair do mato; sorteio reduzido.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, mulberry32 } = require('./helpers/game');

test('F10.6 células e quantidade: só células de encontro; cidade não tem selvagens; 2 a 7 por mapa', () => {
    const { ctx } = newGame();
    const r1 = ctx.getWorldMap('kanto_route1'), cells = ctx.exploreEncounterCells(r1);
    assert.ok(cells.length > 0); for (const [x, y] of cells) assert.equal(ctx.exploreEncounterCell(r1, x, y), 'grass');
    assert.equal(ctx.exploreRoamerCount(ctx.getWorldMap('starter_town')), 0);
    for (const m of [r1, ctx.worldHuntMap(16), ctx.worldHuntMap(74)]) { const n = ctx.exploreRoamerCount(m); assert.ok(n >= 2 && n <= 7, `${m.id}: ${n}`); }
});

test('F10.6 nascer: longe do jogador (>= 4 tiles) e sem repetir célula ocupada', () => {
    const { ctx } = newGame();
    const r1 = ctx.getWorldMap('kanto_route1'), cells = ctx.exploreEncounterCells(r1), rng = mulberry32(3), taken = [];
    const p = { x: cells[0][0], y: cells[0][1] };
    for (let i = 0; i < 20; i++) {
        const c = ctx.exploreRoamerSpawnCell(r1, cells, p, taken, rng);
        assert.ok(c); assert.ok(Math.abs(c[0] - p.x) + Math.abs(c[1] - p.y) >= 4);
        assert.ok(!taken.some(t => t[0] === c[0] && t[1] === c[1])); taken.push(c);
    }
    assert.equal(ctx.exploreRoamerSpawnCell(r1, [[p.x, p.y]], p, [], rng), null, 'sem célula livre → null');
});

test('F10.6 andar: cada passo vai a uma vizinha de encontro (ou fica); nunca sai do mato', () => {
    const { ctx } = newGame();
    const r1 = ctx.getWorldMap('kanto_route1'), rng = mulberry32(9);
    let [x, y] = ctx.exploreEncounterCells(r1)[5], moved = 0;
    for (let i = 0; i < 500; i++) {
        const [nx, ny] = ctx.exploreRoamerStep(r1, x, y, rng);
        assert.ok(Math.abs(nx - x) + Math.abs(ny - y) <= 1);
        assert.equal(ctx.exploreEncounterCell(r1, nx, ny), 'grass');
        if (nx !== x || ny !== y) moved++; x = nx; y = ny;
    }
    assert.ok(moved > 100, 'eles andam de verdade');
});

test('F10.6 sorteio por passo com selvagens visíveis cai pela metade (multiplicador)', () => {
    const { ctx } = newGame();
    const r1 = ctx.getWorldMap('kanto_route1'), [cx, cy] = ctx.exploreEncounterCells(r1)[0], T = ctx.WORLD_TILE_SIZE;
    const at = (d) => ({ x: cx * T + 8, y: cy * T + 8, distance: d }), v = ctx.EXPLORE.grassRate * ctx.EXPLORE.roamerRandomMult;
    assert.equal(ctx.exploreStepEncounter(r1, at(0), at(16), () => v - 1e-9, ctx.EXPLORE.roamerRandomMult), 'grass');
    assert.equal(ctx.exploreStepEncounter(r1, at(0), at(16), () => v + 1e-9, ctx.EXPLORE.roamerRandomMult), null);
    assert.equal(ctx.exploreStepEncounter(r1, at(0), at(16), () => v + 1e-9), 'grass', 'sem multiplicador vale a chance cheia');
});
