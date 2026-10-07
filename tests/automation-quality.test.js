'use strict';
// Fase 5A · B1: avaliação de qualidade do indivíduo
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, perfectIvs, plain } = require('./helpers/game');

test('qualidade: extremos e escala de notas', () => {
    const { ctx } = newGame();
    const q = (v, extra = {}) => plain(ctx.calculatePokemonQuality({ ivs: ivs(v), ...extra }));
    assert.deepEqual(q(0), { score: 0, percentage: 0, grade: 'D', perfect: false, shiny: false });
    assert.deepEqual(q(31), { score: 186, percentage: 100, grade: 'S', perfect: true, shiny: false });
    assert.equal(q(28).grade, 'S');       // 90.3%
    assert.equal(q(25).grade, 'A');       // 80.6%
    assert.equal(q(20).grade, 'B');       // 64.5%
    assert.equal(q(15).grade, 'C');       // 48.4%
    assert.equal(q(10).grade, 'D');       // 32.3%
});

test('qualidade: shiny é informado à parte e não altera a nota', () => {
    const { ctx } = newGame();
    const a = ctx.calculatePokemonQuality({ ivs: ivs(10), shiny: true });
    const b = ctx.calculatePokemonQuality({ ivs: ivs(10), shiny: false });
    assert.equal(a.shiny, true);
    assert.equal(a.score, b.score);
    assert.equal(a.grade, b.grade);
});

test('qualidade: entradas inválidas não quebram (tratadas como 0) e valores são limitados a 0–31', () => {
    const { ctx } = newGame();
    for (const bad of [null, undefined, {}, { ivs: null }, { ivs: 'x' }, { ivs: { hp: 'a' } }]) {
        const r = ctx.calculatePokemonQuality(bad);
        assert.equal(r.score, 0);
        assert.equal(r.grade, 'D');
    }
    assert.equal(ctx.calculatePokemonQuality({ ivs: ivs(99) }).score, 186, 'acima de 31 é limitado');
    assert.equal(ctx.calculatePokemonQuality({ ivs: ivs(-5) }).score, 0);
});

test('qualidade: funciona com indivíduos reais do roster e não muta o objeto', () => {
    const { game, ctx } = newGame();
    const inst = game.roster.primaryOf(25);
    inst.ivs = perfectIvs();
    const before = JSON.stringify(inst);
    const q = ctx.calculatePokemonQuality(inst);
    assert.equal(q.grade, 'S');
    assert.equal(q.perfect, true);
    assert.equal(JSON.stringify(inst), before);
});

test('qualidade: percentage monotônico em relação ao score', () => {
    const { ctx } = newGame();
    let last = -1;
    for (let s = 0; s <= 31; s++) {
        const p = ctx.calculatePokemonQuality({ ivs: ivs(s) }).percentage;
        assert.ok(p >= last);
        last = p;
    }
});
