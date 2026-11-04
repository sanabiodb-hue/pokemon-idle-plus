'use strict';
// F10.4: progresso do modo Explorar no save (treinadores vencidos, itens pegos, última posição) — campo aditivo, saneado, opcional.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, createMemoryStorage } = require('./helpers/game');

test('F10.4 saneador: só ids válidos do tipo certo, sem repetição, posição validada; vazio → nada', () => {
    const { ctx } = newGame();
    const r = ctx.sanitizeExploreState({ defeated: ['kanto_route1#t0', 'kanto_route1#t0', 'hunt_16#t3', 'x#i1', '<script>', 7, 'kanto_route1#t999'], taken: ['hunt_16#i2', 'hunt_16#t1'], at: { map: 'kanto_route1', x: 216.4, y: 301, dir: 'up' } });
    assert.equal(JSON.stringify(r), JSON.stringify({ defeated: ['kanto_route1#t0', 'hunt_16#t3'], taken: ['hunt_16#i2'], at: { map: 'kanto_route1', x: 216, y: 301, dir: 'up' } }));
    assert.equal(ctx.sanitizeExploreState({}), null);
    assert.equal(ctx.sanitizeExploreState({ defeated: [], taken: [] }), null);
    assert.equal(ctx.sanitizeExploreState(null), null);
    assert.equal(ctx.sanitizeExploreState({ at: { map: '../x', x: 1, y: 1 } }), null, 'mapa inválido');
    assert.equal(ctx.sanitizeExploreState({ at: { map: 'hunt_1', x: -5, y: 1 } }), null, 'posição negativa');
    assert.equal(ctx.sanitizeExploreState({ at: { map: 'hunt_1', x: 3, y: 4, dir: 'diagonal' } }).at.dir, 'down');
    const many = Array.from({ length: 2500 }, (_, i) => `hunt_${i}#t0`);
    assert.equal(ctx.sanitizeExploreState({ defeated: many }).defeated.length, ctx.EXPLORE_SAVE_MAX);
});

test('F10.4 ida e volta pelo save: marcas e posição sobrevivem ao recarregar', () => {
    const storage = createMemoryStorage();
    const a = newGame({ storage });
    assert.equal(a.game.exploreMark('defeated', 'kanto_route1#t1'), true);
    assert.equal(a.game.exploreMark('defeated', 'kanto_route1#t1'), false, 'sem repetir');
    assert.equal(a.game.exploreMark('taken', 'kanto_route1#i0'), true);
    assert.equal(a.game.exploreMark('taken', 'nao vale'), false);
    a.game.exploreSetPosition({ map: 'kanto_route1', x: 216, y: 301, dir: 'up' });
    a.game.saveNow();
    const b = newGame({ storage, load: true });
    const p = b.game.exploreProgress();
    assert.deepEqual([...p.defeated], ['kanto_route1#t1']); assert.deepEqual([...p.taken], ['kanto_route1#i0']);
    assert.equal(p.at.map, 'kanto_route1'); assert.equal(p.at.x, 216); assert.equal(p.at.dir, 'up');
});

test('F10.4 save sem exploração fica idêntico (o campo só aparece quando há progresso)', () => {
    const { game, ctx } = newGame();
    const r = ctx.sanitizeSave(JSON.parse(JSON.stringify(game.gameState)));
    assert.ok(r.ok); assert.equal('explore' in r.state, false);
    game.exploreProgress();                                   // abrir o modo cria a estrutura vazia
    const r2 = ctx.sanitizeSave(JSON.parse(JSON.stringify(game.gameState)));
    assert.equal('explore' in r2.state, false, 'estrutura vazia não é gravada');
});
