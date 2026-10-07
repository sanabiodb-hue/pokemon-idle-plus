'use strict';
// Fase 5A · B4: shouldCapture / decideCapture / eventos de captura
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain } = require('./helpers/game');

const wild = (game, id, o = {}) => Object.assign(game.createWildPokemon(id, 3, 0), { ivs: o.ivs || ivs(15), isShiny: !!o.shiny });
const pol = (ctx, over) => ctx.validateAutomationPolicy(over).policy;
const huntRunning = (game, ctx, policy) => {
    const s = ctx.createHuntSession({ id: 'h1', now: game.now(), routeId: game.gameState.currentRoute, policy: policy || ctx.defaultAutomationPolicy(), partyUids: [] });
    ctx.huntSessionTransition(s, 'running', game.now());
    game.gameState.automation = { policy: policy || ctx.defaultAutomationPolicy(), session: s };
    return s;
};

test('shouldCapture: ordem das regras e razões', () => {
    const { ctx } = newGame();
    const c = (policy, w, isNew = false) => plain(ctx.shouldCapture({ policy, wild: w, isNewSpecies: isNew }));
    const base = ctx.defaultAutomationPolicy();
    assert.equal(c(base, { id: 16, ivs: ivs(0) }).capture, true, 'padrão captura tudo (qualidade mínima 0)');
    const off = pol(ctx, { capture: { enabled: false } });
    const offR = c(off, { id: 16, ivs: ivs(31) });
    assert.deepEqual([offR.capture, offR.reason, offR.priority], [false, 'capture_disabled', 'normal']);
    assert.equal(c(off, { id: 16, ivs: ivs(0), shiny: true }).reason, 'always_shiny', 'shiny vence o desligado');
    const noShiny = pol(ctx, { capture: { enabled: false, alwaysShiny: false } });
    assert.equal(c(noShiny, { id: 16, ivs: ivs(0), shiny: true }).capture, false);
    const q75 = pol(ctx, { capture: { minQualityPercent: 75 } });
    assert.equal(c(q75, { id: 16, ivs: ivs(10) }).reason, 'quality_too_low');
    assert.equal(c(q75, { id: 16, ivs: ivs(10) }).capture, false);
    assert.equal(c(q75, { id: 16, ivs: ivs(26) }).reason, 'quality_ok');
    assert.equal(c(q75, { id: 16, ivs: ivs(10) }, true).reason, 'new_species', 'espécie nova entra mesmo abaixo do mínimo');
    const strict = pol(ctx, { capture: { minQualityPercent: 75, alwaysNewSpecies: false } });
    assert.equal(c(strict, { id: 16, ivs: ivs(10) }, true).capture, false);
    const tgt = pol(ctx, { capture: { minQualityPercent: 75 }, target: { type: 'species', speciesIds: [16] } });
    const r = c(tgt, { id: 16, ivs: ivs(1) });
    assert.deepEqual([r.capture, r.reason, r.priority], [true, 'target_species', 'target'], 'alvo ignora o mínimo de qualidade');
    assert.equal(c(tgt, { id: 19, ivs: ivs(1) }).capture, false, 'não-alvo segue o mínimo');
    const tgtOff = pol(ctx, { capture: { enabled: false }, target: { type: 'species', speciesIds: [16] } });
    assert.equal(c(tgtOff, { id: 16, ivs: ivs(31) }).capture, false, 'captura desligada vale mesmo para alvo');
});

test('shouldCapture/decideCapture: puros — não mutam a política, não consomem aleatoriedade, entradas ruins não quebram', () => {
    const { game, ctx } = newGame();
    const p = ctx.defaultAutomationPolicy();
    const snap = JSON.stringify(p);
    const w = wild(game, 16);
    huntRunning(game, ctx, p);
    let calls = 0;
    game.rng = () => { calls++; return 0.5; };
    ctx.shouldCapture({ policy: p, wild: { id: 16, ivs: ivs(3) } });
    game.decideCapture(w);
    assert.equal(calls, 0);
    assert.equal(JSON.stringify(p), snap);
    assert.equal(ctx.shouldCapture({}).capture, true);
    assert.equal(ctx.shouldCapture(null).capture, true);
});

test('sem caçada em andamento: comportamento legado intacto (sempre captura) e eventos são emitidos', () => {
    const { game } = newGame({ seed: 8 });
    game.setAutomationPolicy({ capture: { enabled: false } });          // política existe, mas não há caçada
    const seen = [];
    game.bus.on('*', (e) => seen.push(e));
    const out = game.processDefeat(wild(game, 16));
    assert.equal(out.firstCatch, true);
    assert.ok(game.roster.primaryOf(16));
    const att = seen.find(e => e.type === 'capture_attempted');
    assert.deepEqual(plain({ d: att.decision, r: att.reason, id: att.id }), { d: true, r: 'legacy', id: 16 });
    const got = seen.find(e => e.type === 'pokemon_captured');
    assert.equal(got.firstCatch, true);
    assert.equal(got.uid, game.roster.primaryOf(16).uid);
    assert.equal(seen.some(e => e.type === 'capture_skipped'), false);
});

test('caçada em andamento: captura pulada não altera Pokédex, indivíduos nem IVs; emite capture_skipped', () => {
    const { game, ctx } = newGame({ seed: 9 });
    huntRunning(game, ctx, pol(ctx, { capture: { minQualityPercent: 80, alwaysNewSpecies: false } }));
    const seen = [];
    game.bus.on('*', (e) => seen.push(e));
    const before = JSON.stringify([game.gameState.pokedex, game.gameState.caughtPokemon, game.gameState.stats, game.roster.count()]);
    const out = game.processDefeat(wild(game, 16, { ivs: ivs(5) }));
    assert.equal(out, null);
    assert.equal(JSON.stringify([game.gameState.pokedex, game.gameState.caughtPokemon, game.gameState.stats, game.roster.count()]), before);
    const sk = seen.find(e => e.type === 'capture_skipped');
    assert.deepEqual(plain({ r: sk.reason, id: sk.id }), { r: 'quality_too_low', id: 16 });
    assert.equal(seen.some(e => e.type === 'pokemon_captured'), false);
    // acima do mínimo captura normalmente
    const ok = game.processDefeat(wild(game, 16, { ivs: ivs(30) }));
    assert.equal(ok.firstCatch, true);
    assert.equal(game.roster.countOfSpecies(16), 1);
});

test('caçada em andamento: duplicata aprovada pela política ainda segue a regra de duplicatas existente', () => {
    const { game, ctx } = newGame({ seed: 10 });
    game.processDefeat(wild(game, 16, { ivs: ivs(10) }));
    game.gameState.settings.captureDuplicates = 'better';
    huntRunning(game, ctx, ctx.defaultAutomationPolicy());
    const a = game.processDefeat(wild(game, 16, { ivs: ivs(20) }));
    assert.equal(a.firstCatch, false);
    assert.ok(a.uid, 'indivíduo novo (melhor que o existente)');
    assert.equal(game.roster.countOfSpecies(16), 2);
    const b = game.processDefeat(wild(game, 16, { ivs: ivs(5) }));
    assert.equal(b.uid, null, 'pior: não cria indivíduo');
    assert.equal(game.roster.countOfSpecies(16), 2);
});

test('shiny: política always_shiny captura mesmo com captura desligada; uid único', () => {
    const { game, ctx } = newGame({ seed: 11 });
    huntRunning(game, ctx, pol(ctx, { capture: { enabled: false } }));
    const first = game.processDefeat(wild(game, 16, { shiny: true, ivs: ivs(1) }));
    assert.equal(first.firstCatch, true);
    assert.equal(first.shiny, true);
    const second = game.processDefeat(wild(game, 16, { shiny: true, ivs: ivs(2) }));
    assert.equal(second.firstCatch, false);
    const uids = game.roster.ofSpecies(16).map(i => i.uid);
    assert.equal(new Set(uids).size, uids.length);
});

test('caçada pausada/parada: política não é aplicada (comportamento legado)', () => {
    const { game, ctx } = newGame({ seed: 12 });
    const s = huntRunning(game, ctx, pol(ctx, { capture: { enabled: false } }));
    ctx.huntSessionTransition(s, 'paused', game.now());
    assert.equal(game.decideCapture(wild(game, 16)).reason, 'legacy');
    ctx.huntSessionTransition(s, 'stopped', game.now());
    assert.equal(game.decideCapture(wild(game, 16)).reason, 'legacy');
});

test('a política ao vivo vale durante a caçada (mudar a política muda a decisão)', () => {
    const { game, ctx } = newGame({ seed: 13 });
    huntRunning(game, ctx, ctx.defaultAutomationPolicy());
    assert.equal(game.decideCapture(wild(game, 16, { ivs: ivs(2) })).capture, true);
    game.setAutomationPolicy({ capture: { minQualityPercent: 90, alwaysNewSpecies: false } });
    assert.equal(game.decideCapture(wild(game, 16, { ivs: ivs(2) })).capture, false);
});
