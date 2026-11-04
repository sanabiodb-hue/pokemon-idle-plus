'use strict';
// F10.3: atmosfera do modo Explorar — fases do dia pelo relógio e trilha sonora (faixas alinhadas, notas válidas).
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { newGame } = require('./helpers/game');

test('F10.3 fases do dia: toda hora tem fase; limites 5, 7, 17 e 19; postes acesos à noite e no entardecer', () => {
    const { ctx } = newGame();
    const at = (h) => ctx.exploreDayPhase(h).id;
    assert.equal(at(0), 'night'); assert.equal(at(4.99), 'night'); assert.equal(at(5), 'dawn'); assert.equal(at(6.99), 'dawn');
    assert.equal(at(7), 'day'); assert.equal(at(16.99), 'day'); assert.equal(at(17), 'dusk'); assert.equal(at(19), 'night'); assert.equal(at(23.99), 'night');
    assert.equal(at(24), 'night'); assert.equal(at(-1), 'night', 'hora fora do intervalo dá a volta');
    for (let h = 0; h < 24; h += 0.25) { const p = ctx.exploreDayPhase(h); assert.ok(p && p.hemi > 0 && p.sun > 0, String(h)); }
    assert.equal(ctx.exploreDayPhase(12).sky, null, 'de dia vale o céu do bioma');
    assert.equal(ctx.exploreDayPhase(2).lamps, true); assert.equal(ctx.exploreDayPhase(12).lamps, false); assert.equal(ctx.exploreDayPhase(18).lamps, true);
    assert.ok(ctx.exploreDayPhase(2).sun < ctx.exploreDayPhase(12).sun, 'noite mais escura');
});

test('F10.3 trilha: notas válidas, vozes alinhadas no loop, todas as faixas presentes', () => {
    const { ctx } = newGame();
    assert.equal(ctx.exploreNote('A4'), 0); assert.equal(ctx.exploreNote('C5'), 3); assert.equal(ctx.exploreNote('F#4'), -3); assert.equal(ctx.exploreNote('Bb3'), -11); assert.equal(ctx.exploreNote('-'), null);
    assert.throws(() => ctx.exploreNote('H2'));
    for (const id of ['town', 'route', 'wild', 'trainer', 'victory']) {
        const t = ctx.EXPLORE_TRACKS[id]; assert.ok(t, id);
        const len = (v) => v.reduce((a, n) => a + n[1], 0);
        assert.equal(len(t.lead), len(t.bass), `${id}: baixo alinhado`); assert.equal(len(t.lead), len(t.pad), `${id}: acompanhamento alinhado`);
        if (t.loop) assert.equal(len(t.lead) % 4, 0, `${id}: compasso completo`);
        for (const v of [t.lead, t.bass, t.pad]) for (const [n, d] of v) { assert.ok(n === null || (n >= -36 && n <= 27), `${id}: nota ${n}`); assert.ok(d > 0); }
        assert.ok(t.bpm >= 60 && t.bpm <= 200);
    }
    assert.equal(ctx.EXPLORE_TRACKS.victory.loop, false, 'fanfarra toca uma vez');
});

test('F10.3 flag desligada: sempre dia (sem mudança de luz)', () => {
    const { ctx } = newGame();
    vm.runInContext('EXPLORE_AMBIENCE_ENABLED = false', ctx.sandbox);
    assert.equal(ctx.exploreDayPhase(2).id, 'day');
});
