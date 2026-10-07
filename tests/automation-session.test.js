'use strict';
// Fase 5A · B3: HuntSession
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, plain } = require('./helpers/game');

const mk = (ctx, over = {}) => ctx.createHuntSession({ id: 'h1', now: 1000, routeId: 'kanto_route1', policy: ctx.defaultAutomationPolicy(), partyUids: ['p1'], ...over });

test('sessão nova: idle, estatísticas zeradas, política copiada', () => {
    const { ctx } = newGame();
    const s = mk(ctx);
    assert.equal(s.state, 'idle');
    assert.deepEqual(plain(s.stats), { battles: 0, victories: 0, defeats: 0, captures: 0, shinies: 0, xp: 0, money: 0, healingSpent: 0, healCost: 0, qualitySum: 0 });
    assert.deepEqual(plain(ctx.HUNT_STAT_KEYS), ['battles', 'victories', 'defeats', 'captures', 'shinies', 'xp', 'money', 'healingSpent', 'healCost', 'qualitySum']);
    assert.equal(ctx.huntSessionDurationMs(s, 99999), 0, 'idle não conta tempo');
});

test('transições válidas e inválidas; inválida não altera nada', () => {
    const { ctx } = newGame();
    const s = mk(ctx);
    const before = JSON.stringify(s);
    assert.equal(ctx.huntSessionTransition(s, 'paused', 1100), false);
    assert.equal(ctx.huntSessionTransition(s, 'finished', 1100), false);
    assert.equal(JSON.stringify(s), before);
    assert.equal(ctx.huntSessionTransition(s, 'running', 2000), true);
    assert.equal(s.startedAt, 2000);
    assert.equal(ctx.huntSessionTransition(s, 'running', 2100), false, 'running → running é inválido');
    assert.equal(ctx.huntSessionTransition(s, 'paused', 5000), true);
    assert.equal(s.activeMs, 3000);
    assert.equal(ctx.huntSessionTransition(s, 'running', 9000), true);
    assert.equal(s.startedAt, 2000, 'startedAt não muda ao retomar');
    assert.equal(ctx.huntSessionDurationMs(s, 10000), 4000);
    assert.equal(ctx.huntSessionTransition(s, 'stopped', 11000, 'manual'), true);
    assert.equal(s.activeMs, 5000);
    assert.equal(s.endedAt, 11000);
    assert.equal(s.stopReason, 'manual');
    assert.equal(ctx.huntSessionDurationMs(s, 99999), 5000, 'parada congela o tempo');
    for (const to of ['running', 'paused', 'stopped', 'finished', 'idle']) assert.equal(ctx.huntSessionTransition(s, to, 12000), false, to);
});

test('pausa não conta tempo; razão de parada desconhecida cai em manual; finished sem razão', () => {
    const { ctx } = newGame();
    const s = mk(ctx);
    ctx.huntSessionTransition(s, 'running', 0);
    ctx.huntSessionTransition(s, 'paused', 1000);
    assert.equal(ctx.huntSessionDurationMs(s, 500000), 1000);
    ctx.huntSessionTransition(s, 'stopped', 600000, 'qualquer-coisa');
    assert.equal(s.stopReason, 'manual');
    const f = mk(ctx);
    ctx.huntSessionTransition(f, 'running', 0);
    ctx.huntSessionTransition(f, 'finished', 10);
    assert.equal(f.state, 'finished');
    assert.equal(f.stopReason, null);
});

test('estatísticas só acumulam em running; chaves/valores inválidos são ignorados', () => {
    const { ctx } = newGame();
    const s = mk(ctx);
    assert.equal(ctx.huntSessionRecord(s, { battles: 1 }), false, 'idle ignora');
    ctx.huntSessionTransition(s, 'running', 0);
    assert.equal(ctx.huntSessionRecord(s, { battles: 1, victories: 1, xp: 30, money: 12, bogus: 5, captures: -2, shinies: NaN, defeats: '3' }), true);
    assert.deepEqual(plain(s.stats), { battles: 1, victories: 1, defeats: 0, captures: 0, shinies: 0, xp: 30, money: 12, healingSpent: 0, healCost: 0, qualitySum: 0 });
    assert.equal(s.stats.bogus, undefined);
    ctx.huntSessionTransition(s, 'paused', 10);
    assert.equal(ctx.huntSessionRecord(s, { battles: 5 }), false, 'pausada ignora');
    ctx.huntSessionTransition(s, 'stopped', 20);
    assert.equal(ctx.huntSessionRecord(s, { battles: 5 }), false, 'parada ignora');
    assert.equal(s.stats.battles, 1);
});

test('sanitizeHuntSession: running vira paused no carregamento, lixo vira null, política interna é saneada', () => {
    const { ctx } = newGame();
    const s = mk(ctx);
    ctx.huntSessionTransition(s, 'running', 100);
    ctx.huntSessionRecord(s, { battles: 4, xp: 50 });
    const clean = ctx.sanitizeHuntSession(JSON.parse(JSON.stringify(s)));
    assert.equal(clean.state, 'paused');
    assert.equal(clean.resumedAt, null);
    assert.equal(clean.stats.battles, 4);
    for (const bad of [null, 5, 'x', [], {}, { state: 'wat' }, { state: 'running' }, { state: 'running', routeId: '../../x' }]) assert.equal(ctx.sanitizeHuntSession(bad), null, JSON.stringify(bad));
    const raw = JSON.parse(JSON.stringify(s));
    raw.policy = { heal: { whenHpBelowPercent: 'x' } }; raw.stats.xp = -9; raw.stats.battles = 'abc'; raw.partyUids = ['ok', '<script>', 5]; raw.id = 'a b';
    const c2 = ctx.sanitizeHuntSession(raw);
    assert.equal(ctx.validateAutomationPolicy(c2.policy).ok, true);
    assert.equal(c2.stats.xp, 0);
    assert.equal(c2.stats.battles, 0);
    assert.deepEqual(plain(c2.partyUids), ['ok']);
    assert.equal(c2.id, 'h0');
});

test('persistência: sessão no save é carregada como pausada', () => {
    const a = newGame({ seed: 5 });
    const s = mk(a.ctx, { routeId: a.game.gameState.currentRoute });
    a.ctx.huntSessionTransition(s, 'running', a.game.now());
    a.ctx.huntSessionRecord(s, { battles: 7, captures: 2, xp: 99 });
    a.game.gameState.automation = { policy: a.ctx.defaultAutomationPolicy(), session: s };
    a.game.saveNow();
    const b = newGame({ storage: a.storage, load: true });
    const loaded = b.game.getHuntSession();
    assert.ok(loaded);
    assert.equal(loaded.state, 'paused');
    assert.equal(loaded.stats.battles, 7);
    assert.equal(loaded.stats.captures, 2);
});
