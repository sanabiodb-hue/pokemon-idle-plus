'use strict';
// F7.7: simulação offline do ciclo de caça no mundo. O Fast Driver existente continua o MESMO ciclo (mesmo modelo de caminho, distância,
// velocidade, seleção de pontos e resolução de batalha), gastando o tempo de caminhada analiticamente e o de combate pelas regras atuais.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, runOffline } = require('./helpers/game');
const { loadWorld } = require('./helpers/world-env');

const TILE = 16, SPEED = 64, SPECIES = 25, MIN = 60_000;
const dispatch = (game, type, extra = {}) => game.dispatchAutomationAction({ type, ...extra });
const watch = (game) => { const ev = []; game.bus.on('*', (e) => ev.push(e)); return ev; };
const session = (game) => game.getHuntSession();

function setup(opts = {}) {
    const { game, ctx, storage } = newGame({ seed: opts.seed ?? 7, load: opts.load, storage: opts.storage });
    const clock = new ctx.ManualClock(opts.clock ?? 1_000_000);
    game.clock = clock;
    const world = loadWorld();
    const enc = new world.WorldEncounters(game);
    return { game, ctx, world, enc, clock, storage, ev: watch(game) };
}
const etaOf = (lengthPx) => Math.ceil(lengthPx / SPEED * 1000);
function legLength(world, map, fromIndex, toIndex) {
    const origin = fromIndex === null ? map.spawn : map.encounterPoints[fromIndex];
    return (world.worldFindPath(map, origin, map.encounterPoints[toIndex]).length - 1) * TILE;
}
// Registra cada perna que o Fast Driver resolve (ponto e resultado) sem alterar nada
function spyLegs(enc) {
    const legs = [], orig = enc.fastResolved.bind(enc);
    enc.fastResolved = (outcome, delay) => { legs.push({ pointIndex: enc.cycle.leg.pointIndex, sequence: enc.cycle.leg.sequence, lengthPx: enc.cycle.leg.lengthPx, outcome, delay }); return orig(outcome, delay); };
    return legs;
}
const offlineBattles = (ev) => ev.filter(e => e.type === 'battle_completed' && e.offline);

test('F7.7 offline: o MESMO ciclo continua — só a espécie do mapa é enfrentada, a caminhada consome tempo e a sessão segue autoritativa', async () => {
    const { game, enc, ev, world, clock: clock0 } = setup();
    enc.begin(SPECIES);
    game.clock.advance(5000);
    const legs = spyLegs(enc);
    const total = 20 * MIN;
    const res = await runOffline(game, total);
    const done = offlineBattles(ev);
    assert.ok(done.length >= 3, `batalhas offline: ${done.length}`);
    assert.ok(done.every(e => e.enemyId === SPECIES), 'nenhuma batalha de rota: sempre a espécie do mapa');
    assert.equal(session(game).stats.battles, done.length, 'o contador da sessão = batalhas realmente resolvidas (uma vez cada)');
    assert.equal(legs.length, done.length, 'cada batalha resolveu exatamente uma perna');
    assert.ok(enc.cycle, 'o ciclo continua ativo');
    assert.equal(game.clock, clock0, 'o relógio real foi restaurado');
    assert.equal(enc._offline, false);
    assert.equal(game.encounterHook, enc);
    // pontos escolhidos = função pura (online e offline compartilham a seleção)
    const map = world.worldHuntMap(SPECIES);
    let last = null;
    legs.forEach((l, i) => {
        const expected = world.worldPickEncounterPoint(map, session(game).id, i, last);
        assert.equal(l.pointIndex, expected, `perna ${i}`);
        last = l.pointIndex;
    });
    // o tempo é consumido pelo deslocamento: a soma dos tempos de viagem das pernas resolvidas cabe no período
    const travel = legs.reduce((sum, l) => sum + etaOf(l.lengthPx), 0);
    assert.ok(travel <= total, `viagem ${travel} ms ≤ ${total} ms`);
    assert.ok(res.battles === done.filter(e => e.result === 'victory').length, 'o resumo conta só vitórias (como sempre)');
});

test('F7.7 offline: não concede "quantas batalhas cabem" — com o mundo, o mesmo tempo rende bem menos batalhas que a caçada comum por rota', async () => {
    const world = setup({ seed: 5 });
    world.enc.begin(SPECIES);
    await runOffline(world.game, 30 * MIN);
    const worldBattles = offlineBattles(world.ev).length;
    const route = setup({ seed: 5 });
    dispatch(route.game, 'START_HUNT');
    await runOffline(route.game, 30 * MIN);
    const routeBattles = offlineBattles(route.ev).length;
    assert.ok(routeBattles > 0 && worldBattles > 0);
    assert.ok(worldBattles * 1.5 < routeBattles, `mundo ${worldBattles} × rota ${routeBattles}: a caminhada custa tempo`);
});

test('F7.7 paridade: o tempo e a distância da primeira perna offline coincidem com o modelo online (mesmo caminho, velocidade e estado inicial)', async () => {
    const online = setup({ seed: 3 });
    online.enc.begin(SPECIES);
    const c = online.enc.current, eta = c.etaMs;
    online.game.clock.advance(eta - 1);
    online.enc.hunterState({ id: online.enc.cycle.mapId });
    const onlineProgress = online.enc.cycle.leg.progressPx;

    const early = setup({ seed: 3 });
    early.enc.begin(SPECIES);
    await runOffline(early.game, eta - 1);
    assert.equal(offlineBattles(early.ev).length, 0, 'sem tempo para chegar: nenhuma batalha');
    assert.ok(Math.abs(early.enc.cycle.leg.progressPx - onlineProgress) < 1e-6, 'mesmo progresso (px) no mesmo tempo');
    assert.equal(early.enc.cycle.leg.state, 'approaching');
    assert.equal(early.enc.current.pointIndex, c.pointIndex, 'mesmo destino');

    const exact = setup({ seed: 3 });
    exact.enc.begin(SPECIES);
    await runOffline(exact.game, eta);
    assert.equal(offlineBattles(exact.ev).length, 0, 'chegou no instante lógico previsto, mas não houve tempo para lutar');
    assert.ok(['arrived', 'battling'].includes(exact.enc.cycle.leg.state), 'a chegada não se perde: o reinício normal do jogo entrega o inimigo do mapa');
    assert.equal(exact.enc.cycle.leg.progressPx, exact.enc.cycle.leg.lengthPx);
    if (exact.enc.cycle.leg.state === 'battling') assert.equal(exact.game.currentBattle.wild.id, SPECIES);

    const long = setup({ seed: 3 });
    long.enc.begin(SPECIES);
    await runOffline(long.game, eta + 10 * MIN);
    const first = offlineBattles(long.ev);
    assert.ok(first.length >= 1);
    assert.equal(first[0].enemyId, SPECIES);
});

test('F7.7 offline: recompensas e contadores uma só vez — experiência e dinheiro do resumo batem com os eventos de batalha', async () => {
    const { game, enc, ev } = setup({ seed: 12 });
    enc.begin(SPECIES);
    const s0 = { ...session(game).stats }, exp0 = game.gameState.stats.totalExp, gold0 = game.gameState.stats.totalGold;
    const res = await runOffline(game, 40 * MIN);
    const done = offlineBattles(ev), wins = done.filter(e => e.result === 'victory');
    assert.equal(session(game).stats.battles - s0.battles, done.length);
    assert.equal(session(game).stats.victories - s0.victories, wins.length);
    assert.equal(res.summary.expGained, game.gameState.stats.totalExp - exp0);
    assert.equal(game.gameState.stats.totalExp - exp0, wins.reduce((a, e) => a + e.xp, 0), 'experiência: soma dos eventos, sem duplicar');
    assert.equal(game.gameState.stats.totalGold - gold0, wins.reduce((a, e) => a + e.gold, 0), 'moedas: soma dos eventos, sem duplicar');
    assert.equal(res.battles, wins.length);
});

test('F7.7 offline: períodos longos são processados em lotes, sem renderizar e sem avisar a interface a cada perna', async () => {
    const { game, enc } = setup({ seed: 21 });
    enc.begin(SPECIES);
    let notifications = 0;
    enc.onChange(() => { notifications++; });
    const t0 = process.hrtime.bigint();
    const res = await runOffline(game, 8 * 60 * MIN);                          // 8 h
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(res.battles >= 100, `batalhas simuladas: ${res.battles}`);
    assert.ok(notifications <= 3, `observadores avisados ${notifications}x (não a cada perna)`);
    assert.ok(enc._paths.byKey.size <= 100 && enc._paths.byKey.size > 1, `caminhos distintos calculados: ${enc._paths.byKey.size} (memo, nunca um por perna)`);
    assert.ok(ms < 60_000, 'termina');
    assert.equal(game.encounterHook, enc);
    assert.equal(enc._offline, false);
});

test('F7.7 pausa e offline: uma caçada PAUSADA não acumula caminhada, batalha nem sequência; nada é aplicado ao voltar', async () => {
    const { game, enc, clock, ev } = setup();
    enc.begin(SPECIES);
    clock.advance(4000);
    dispatch(game, 'PAUSE_HUNT');
    const snap = JSON.stringify({ p: enc.cycle.leg.progressPx, seq: enc.cycle.seq, stats: session(game).stats, last: enc.cycle.last });
    assert.equal(enc.offlineSuspended(), true);
    game._onPageHidden();
    clock.advance(6 * 60 * MIN);                                              // 6 h fora
    game._onPageVisible();
    assert.equal(game._isOfflineSimulating, false, 'a simulação nem começou');
    assert.equal(JSON.stringify({ p: enc.cycle.leg.progressPx, seq: enc.cycle.seq, stats: session(game).stats, last: enc.cycle.last }), snap);
    assert.equal(offlineBattles(ev).length, 0);
    assert.equal(session(game).state, 'paused');
    assert.equal(enc._offline, false, 'o estado offline não ficou preso');
    assert.equal(enc._hidden, false);
    // ao retomar: continua de onde parou, sem tempo extra
    dispatch(game, 'RESUME_HUNT');
    assert.equal(Math.round(enc.hunterState({ id: enc.cycle.mapId }) && enc.cycle.leg.progressPx), SPEED * 4);
});

test('F7.7 recarga: sessão PAUSADA antes de fechar permanece pausada e intacta; sessão ATIVA tem o tempo aplicado uma única vez', async () => {
    // --- pausada ---
    const a = setup({ seed: 8 });
    a.enc.begin(SPECIES);
    a.clock.advance(3000);
    dispatch(a.game, 'PAUSE_HUNT');
    a.game.saveNow();
    const b = (() => { const g = newGame({ seed: 8, load: true, storage: a.storage }); g.game.clock = new g.ctx.ManualClock(9_000_000); const w = loadWorld(); return { ...g, world: w, enc: new w.WorldEncounters(g.game), ev: watch(g.game) }; })();
    assert.equal(session(b.game).state, 'paused');
    assert.equal(session(b.game).pausedByReload, false, 'estava pausada: nada a recuperar');
    const statsBefore = JSON.stringify(session(b.game).stats);
    b.game._processOfflineBattles(12 * 60 * MIN);
    assert.equal(b.game._isOfflineSimulating, false);
    assert.equal(JSON.stringify(session(b.game).stats), statsBefore, 'nenhuma batalha, nenhum tempo de caçada');
    assert.equal(session(b.game).state, 'paused', 'continua pausada até a retomada explícita');
    assert.equal(offlineBattles(b.ev).length, 0);
    assert.ok(session(b.game).world, 'o registro do ciclo foi preservado');

    // --- ativa ---
    const c = setup({ seed: 8 });
    c.enc.begin(SPECIES);
    c.clock.advance(3000);
    c.game.saveNow();
    const d = (() => { const g = newGame({ seed: 8, load: true, storage: c.storage }); g.game.clock = new g.ctx.ManualClock(9_000_000); const w = loadWorld(); return { ...g, world: w, enc: new w.WorldEncounters(g.game), ev: watch(g.game) }; })();
    assert.equal(session(d.game).state, 'paused');
    assert.equal(session(d.game).pausedByReload, true, 'estava ativa: o offline vai continuar o ciclo');
    const res = await runOffline(d.game, 25 * MIN);
    const done = offlineBattles(d.ev);
    assert.ok(done.length >= 2, `batalhas: ${done.length}`);
    assert.ok(done.every(e => e.enemyId === SPECIES));
    assert.equal(session(d.game).stats.battles, done.length, 'contado uma vez');
    assert.equal(session(d.game).state, 'paused', 'depois do offline volta a pausada (retomada explícita)');
    assert.equal(session(d.game).pausedByReload, false);
    assert.equal(d.enc.cycle.seq > 0, true);
    const after = JSON.stringify({ stats: session(d.game).stats, seq: d.enc.cycle.seq });
    d.game._processOfflineBattles(25 * MIN);                                  // mesmo tempo de novo: já foi aplicado
    assert.equal(d.game._isOfflineSimulating, false, 'não reaplica o tempo');
    assert.equal(JSON.stringify({ stats: session(d.game).stats, seq: d.enc.cycle.seq }), after);
    assert.equal(res.battles >= 1, true);
    assert.equal(JSON.stringify(session(d.game).world).includes('"speciesId":25'), true, 'o registro persistido acompanha a sequência');
});

test('F7.7 offline: condição de parada da caçada encerra o ciclo e a simulação, sem perna sobrando', async () => {
    const { game, ctx, enc, ev } = setup({ seed: 4 });
    const policy = JSON.parse(JSON.stringify(game.getAutomationPolicy()));
    policy.stopConditions.battleLimit = 4;
    assert.equal(game.setAutomationPolicy(policy).ok, true);
    enc.begin(SPECIES);
    await runOffline(game, 3 * 60 * MIN);
    assert.equal(session(game).state, 'stopped');
    assert.equal(session(game).stopReason, 'battle_limit');
    assert.equal(session(game).stats.battles, 4, 'parou no limite');
    assert.equal(enc.cycle, null, 'ciclo encerrado');
    assert.equal(game.encounterHook, null);
    assert.equal(session(game).world, undefined);
    assert.equal(offlineBattles(ev).length, 4);
});

test('F7.7 offline: sem ciclo do mundo, a simulação offline por rota segue exatamente como antes (regressão)', async () => {
    const a = setup({ seed: 6 }), b = setup({ seed: 6 });
    dispatch(a.game, 'START_HUNT'); dispatch(b.game, 'START_HUNT');
    const wb = new b.world.WorldEncounters(b.game);                           // controlador existente, mas sem ciclo
    assert.equal(wb.cycle, null);
    await runOffline(a.game, 15 * MIN); await runOffline(b.game, 15 * MIN);
    const ids = (ev) => offlineBattles(ev).map(e => `${e.enemyId}:${e.result}`).join(',');
    assert.equal(ids(a.ev), ids(b.ev));
    assert.ok(offlineBattles(a.ev).length > 10);
    assert.ok(offlineBattles(a.ev).every(e => e.enemyId !== undefined));
    // caçada comum não deixa gancho nem registro do mundo
    assert.equal(a.game.encounterHook, null);
    assert.equal(session(a.game).world, undefined);
});
