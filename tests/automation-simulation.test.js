'use strict';
// Fase 5A · B9: SimulationClock, driver rápido, offline, determinismo, equivalência ao vivo × rápido
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain, runOffline } = require('./helpers/game');
const { createSimGame, getContext } = require('../tools/automation-sim');

const MIN = 60 * 1000, HOUR = 60 * MIN;
const noHeal = { heal: { enabled: false } };

test('SimulationClock: só anda quando mandamos e dispara timers na ordem', () => {
    const ctx = getContext();
    const c = new ctx.SimulationClock(1000);
    const out = [];
    c.setTimer(() => out.push('b'), 50);
    c.setTimer(() => out.push('a'), 10);
    assert.equal(c.now(), 1000);
    c.advance(100);
    assert.deepEqual(plain(out), ['a', 'b']);
    assert.equal(c.elapsed(1000), 100);
    assert.ok(c instanceof ctx.ManualClock);
});

test('RNG de simulação: mesma semente = mesma sequência; sementes diferentes divergem', () => {
    const ctx = getContext();
    const seq = (seed) => { const r = ctx.createSimulationRng(seed); return Array.from({ length: 5 }, r); };
    assert.deepEqual(seq(7), seq(7));
    assert.notDeepEqual(seq(7), seq(8));
    assert.ok(seq(1).every(v => v >= 0 && v < 1));
});

test('driver rápido: determinístico (mesma semente → resultados idênticos) e sem tocar relógio/timers reais', () => {
    const run = (seed) => {
        const { game, ctx } = createSimGame({ seed, policy: noHeal });
        const r = ctx.simulateHunt(game, HOUR);
        return { r: plain(r), battleTimer: game.battleTimer, now: game.now() };
    };
    const a = run(11), b = run(11), c = run(12);
    assert.deepEqual(a.r, b.r);
    assert.notDeepEqual(a.r, c.r);
    assert.equal(a.battleTimer, null, 'sem timers reais');
    assert.equal(a.r.simulatedMs, HOUR);
    assert.ok(Math.abs(a.now - 1_700_000_000_000 - HOUR) < 1, 'o relógio simulado avançou a duração (tolerância de ponto flutuante)');
    assert.ok(a.r.battles > 100 && a.r.victories > 0 && a.r.xp > 0);
    assert.equal(a.r.battles, a.r.victories + a.r.defeats);
});

test('durações 10 min / 1 h / 4 h / 8 h / 24 h terminam rápido e crescem de forma coerente', () => {
    const results = [];
    const t0 = Date.now();
    for (const ms of [10 * MIN, HOUR, 4 * HOUR, 8 * HOUR, 24 * HOUR]) {
        const { game, ctx } = createSimGame({ seed: 21, policy: noHeal, starterLevel: 30 });
        const r = ctx.simulateHunt(game, ms);
        assert.equal(r.ok, true);
        assert.equal(r.simulatedMs, ms);
        assert.equal(r.state, 'running');
        results.push(r);
    }
    assert.ok(Date.now() - t0 < 20000, `simulou 24h+8h+4h+1h+10min em ${Date.now() - t0} ms`);
    for (let i = 1; i < results.length; i++) assert.ok(results[i].battles > results[i - 1].battles);
    assert.ok(results.at(-1).efficiency.xpPerHour > 0);
});

test('o driver rápido não escreve save nem deixa o jogo em modo offline', () => {
    const { game, ctx } = createSimGame({ seed: 22, policy: noHeal });
    const saves = game.saver.stats ? { ...game.saver.stats } : null;
    ctx.simulateHunt(game, 10 * MIN);
    assert.equal(game._isOfflineSimulating, false);
    assert.equal(game._fastSim, null);
    assert.equal(game.onBattleEvent, null);
    if (saves) assert.deepEqual(plain(game.saver.stats), plain(saves));
});

test('simulateHunt recusa sem caçada rodando e parâmetros inválidos', () => {
    const { game, ctx } = createSimGame({ seed: 23, start: false });
    assert.equal(ctx.simulateHunt(game, HOUR).code, 'no_running_hunt');
    game.dispatchAutomationAction({ type: 'START_HUNT' });
    assert.equal(ctx.simulateHunt(game, 0).code, 'invalid_request');
    assert.equal(ctx.simulateHunt(game, -5).code, 'invalid_request');
    assert.equal(ctx.simulateHunt(game, NaN).code, 'invalid_request');
});

test('parada no driver rápido: limite de batalhas exato; limite de tempo; tempo simulado reflete a parada', () => {
    let { game, ctx } = createSimGame({ seed: 24, policy: { ...noHeal, stopConditions: { battleLimit: 40 } } });
    let r = ctx.simulateHunt(game, 24 * HOUR);
    assert.equal(r.state, 'stopped');
    assert.equal(r.stopReason, 'battle_limit');
    assert.equal(r.battles, 40);
    assert.ok(r.simulatedMs < 24 * HOUR);
    assert.equal(r.stopMessage, 'Caça encerrada: limite de 40 batalhas atingido.');
    ({ game, ctx } = createSimGame({ seed: 25, policy: { ...noHeal, stopConditions: { timeLimitMinutes: 30 } } }));
    r = ctx.simulateHunt(game, 24 * HOUR);
    assert.equal(r.stopReason, 'time_limit');
    assert.ok(r.simulatedMs >= 30 * MIN && r.simulatedMs < 31 * MIN, String(r.simulatedMs));
});

test('shinyFound no driver rápido: para no primeiro shiny e ele foi capturado', () => {
    const { game, ctx } = createSimGame({ seed: 26, shinyRate: 0.05, policy: { ...noHeal, stopConditions: { shinyFound: true } } });
    const r = ctx.simulateHunt(game, 8 * HOUR);
    assert.equal(r.stopReason, 'shiny_found');
    assert.equal(r.shinies, 1);
    assert.equal(r.stopMessage, 'Caça encerrada: Shiny encontrado.');
});

test('poções no driver rápido: gasta pela regra, para sem poções com a mensagem certa', () => {
    const { game, ctx } = createSimGame({ seed: 27, potions: 3, starterLevel: 5, routeId: 'kanto_route2', policy: { heal: { whenHpBelowPercent: 90 } } });
    const r = ctx.simulateHunt(game, 24 * HOUR);
    assert.equal(r.state, 'stopped');
    assert.equal(r.stopReason, 'no_potions');
    assert.equal(r.potionsUsed, 3);
    assert.equal(r.potionsLeft, 0);
    assert.equal(r.stopMessage, 'Caça interrompida: sem poções.');
    assert.ok(game.getPotions() >= 0);
});

test('captura no driver rápido: política respeitada (qualidade mínima alta não cria indivíduos novos de espécies já conhecidas)', () => {
    const open = createSimGame({ seed: 28, policy: noHeal });
    const strict = createSimGame({ seed: 28, policy: { ...noHeal, capture: { minQualityPercent: 100, alwaysNewSpecies: false, alwaysShiny: false } } });
    open.ctx.simulateHunt(open.game, 2 * HOUR);
    strict.ctx.simulateHunt(strict.game, 2 * HOUR);
    assert.ok(open.game.roster.count() > strict.game.roster.count());
    assert.ok(strict.game.roster.count() <= 1 + 1);
    assert.deepEqual(plain(open.game.roster.checkIntegrity()), []);
    assert.deepEqual(plain(strict.game.roster.checkIntegrity()), []);
});

test('troca de rota no driver rápido: switchWhenComplete segue findNextIncompleteRoute', () => {
    const { game, ctx } = createSimGame({ seed: 29, policy: { ...noHeal, route: { mode: 'switchWhenComplete' } } });
    for (const p of game.getRoute('kanto_route1').pokemon) {
        if (!game.gameState.caughtPokemon[p.id]) game.catchPokemonWithIvs(p.id, 1, ivs(31));
        game.gameState.caughtPokemon[p.id].ivs = ivs(31);
        game.gameState.shinyDex[p.id] = true;
    }
    const expected = game.findNextIncompleteRoute().routeId;
    const r = ctx.simulateHunt(game, 10 * MIN);
    assert.equal(r.routeId === 'kanto_route1', false);
    assert.equal(game.getHuntSession().routeId, game.gameState.currentRoute);
    assert.ok([expected, game.gameState.currentRoute].includes(r.routeId));
});

// ------------------------------------------------------------ offline real
test('offline (voltou do background) com caçada rodando: driver rápido, relógio real restaurado, relatório de caça', async () => {
    const { game, ctx } = newGame({ seed: 31 });
    game.setAutomationPolicy({ heal: { enabled: false } });
    game.dispatchAutomationAction({ type: 'START_HUNT' });
    game.stopBattle();
    const real = game.clock;
    await runOffline(game, 30 * MIN);
    const s = game.getHuntSession();
    assert.equal(game.clock, real, 'relógio real restaurado');
    assert.equal(s.state, 'running', 'a caçada continua rodando ao voltar');
    assert.ok(s.stats.battles > 50 && s.stats.xp > 0);
    const hunt = game.lastOfflineSummary.hunt;
    assert.ok(hunt);
    assert.equal(hunt.battles, s.stats.battles);
    assert.equal(hunt.state, 'running');
    assert.equal(hunt.absenceMs, 30 * MIN);
    assert.ok(typeof hunt.nextRecommendation === 'string' && hunt.nextRecommendation.length > 0);
    assert.equal(ctx.huntStopMessage(s), '');
});

test('offline sem caçada: nada de hunt no resumo e o relógio nunca é trocado', async () => {
    const { game } = newGame({ seed: 32 });
    const real = game.clock;
    await runOffline(game, 10 * MIN);
    assert.equal(game.clock, real);
    assert.equal(game.lastOfflineSummary.hunt, undefined);
    assert.equal(game._offlineHunt, null);
});

test('fechar e reabrir: sessão volta pausada; o offline roda a caçada com o driver rápido e termina pausada', async () => {
    const a = newGame({ seed: 33 });
    a.game.setAutomationPolicy({ heal: { enabled: false }, stopConditions: { battleLimit: 0 } });
    a.game.dispatchAutomationAction({ type: 'START_HUNT' });
    a.game.stopBattle();
    a.game.saveNow();
    const b = newGame({ storage: a.storage, load: true });
    const s0 = b.game.getHuntSession();
    assert.equal(s0.state, 'paused');
    assert.equal(s0.pausedByReload, true);
    assert.equal(b.game.isHuntRunning(), false);
    await runOffline(b.game, 20 * MIN);
    const s = b.game.getHuntSession();
    assert.equal(s.state, 'paused', 'termina pausada, o jogador decide quando continuar');
    assert.equal(s.pausedByReload, false);
    assert.ok(s.stats.battles > 30);
    assert.equal(b.game.bus.hasListeners(), false);
    const hunt = b.game.lastOfflineSummary.hunt;
    assert.equal(hunt.battles, s.stats.battles);
    assert.equal(hunt.state, 'paused');
    assert.ok(hunt.efficiency.xpPerHour > 0);
    // segundo offline sem retomar: a caçada pausada não rende nada
    const before = s.stats.battles;
    await runOffline(b.game, 20 * MIN);
    assert.equal(b.game.getHuntSession().stats.battles, before);
    assert.equal(b.game.lastOfflineSummary.hunt, undefined);
    // retomar funciona normalmente
    assert.equal(b.game.dispatchAutomationAction({ type: 'RESUME_HUNT' }).ok, true);
});

test('offline: caçada que pára no meio (limite) reporta o motivo e só gasta o tempo necessário', async () => {
    const a = newGame({ seed: 34 });
    a.game.setAutomationPolicy({ heal: { enabled: false }, stopConditions: { battleLimit: 30 } });
    a.game.dispatchAutomationAction({ type: 'START_HUNT' });
    a.game.stopBattle();
    a.game.saveNow();
    const b = newGame({ storage: a.storage, load: true });
    await runOffline(b.game, 5 * HOUR);
    const s = b.game.getHuntSession();
    assert.equal(s.state, 'stopped');
    assert.equal(s.stopReason, 'battle_limit');
    const hunt = b.game.lastOfflineSummary.hunt;
    assert.equal(hunt.battles, 30);
    assert.ok(hunt.huntMs < 5 * HOUR);
    assert.equal(hunt.message, 'Caça encerrada: limite de 30 batalhas atingido.');
    assert.match(hunt.nextRecommendation, /nova/);
});

test('recomendações: rota concluída sugere a próxima; sem poções explica; rota recomendada respeita o nível', () => {
    const { game, ctx } = createSimGame({ seed: 35, start: false });
    const rec = ctx.recommendHuntRoute(game);
    assert.ok(rec && rec.routeId && rec.name && rec.reason);
    assert.ok(game.getRoute(rec.routeId));
    const mk = (reason) => {
        const s = ctx.createHuntSession({ id: 'x', now: 0, routeId: 'kanto_route1', policy: ctx.defaultAutomationPolicy(), partyUids: [] });
        ctx.huntSessionTransition(s, 'running', 0);
        ctx.huntSessionTransition(s, 'stopped', 1, reason);
        return s;
    };
    assert.match(ctx.recommendHuntNext(game, mk('no_potions'), { potionsLeft: 0 }), /sem poções/);
    assert.match(ctx.recommendHuntNext(game, mk('shiny_found'), { potionsLeft: 5 }), /Shiny/);
    assert.match(ctx.recommendHuntNext(game, mk('route_complete'), { potionsLeft: 5 }), /Rota concluída|concluídas/);
});

// ------------------------------------------------------------ equivalência ao vivo × rápido
function monoRoute(game, id = 19, level = 4) {
    const route = { id: 'kanto_route1', name: 'Mono', levelRange: [level, level], pokemon: [{ id, weight: 1, levelRange: [level, level] }] };
    game.getRoute = (rid) => (rid === 'kanto_route1' ? route : Object.getPrototypeOf(game).getRoute.call(game, rid));
    return route;
}
const liveWin = (game, id = 19, level = 4) => game._processVictoryRewards(Object.assign(game.createWildPokemon(id, level, 0), { isShiny: false }), 25, 100, 100);

test('equivalência XP/captura/evolução: N vitórias contra o mesmo inimigo rendem o mesmo ao vivo e no driver rápido', () => {
    const N = 25;
    const fast = createSimGame({ seed: 41, policy: { heal: { enabled: false }, stopConditions: { battleLimit: N } }, starterLevel: 20, shinyRate: 0 });
    fast.game.gameState.settings.captureDuplicates = 'off';
    monoRoute(fast.game);
    const rf = fast.ctx.simulateHunt(fast.game, 24 * HOUR);

    const live = createSimGame({ seed: 41, policy: { heal: { enabled: false } }, starterLevel: 20, shinyRate: 0 });
    live.game.gameState.settings.captureDuplicates = 'off';
    for (let i = 0; i < N; i++) liveWin(live.game);
    const sl = live.game.getHuntSession();

    assert.equal(rf.victories + rf.defeats, N);
    assert.equal(rf.defeats, 0, 'Pikachu Lv20 não perde para Rattata Lv4');
    assert.equal(sl.stats.victories, N);
    assert.equal(rf.xp, sl.stats.xp, 'mesmo XP total');
    assert.equal(rf.money, sl.stats.money, 'mesmo dinheiro');
    assert.equal(rf.captures, sl.stats.captures, 'mesma captura (1 espécie nova)');
    const fa = fast.game.roster.primaryOf(fast.game.roster.get(fast.game.gameState.party[0]).speciesId);
    const la = live.game.roster.get(live.game.gameState.party[0]);
    assert.equal(fa.level, la.level, 'mesmo nível final');
    assert.equal(fa.speciesId, la.speciesId, 'mesma evolução');
    assert.equal(fast.game.gameState.stats.totalExp, live.game.gameState.stats.totalExp);
    assert.equal(fast.game.gameState.pokedex[19], live.game.gameState.pokedex[19]);
});

test('equivalência de evolução: o mesmo XP evolui o mesmo Pokémon para a mesma espécie nos dois drivers', () => {
    const N = 30;
    const fast = createSimGame({ seed: 42, policy: { heal: { enabled: false }, stopConditions: { battleLimit: N } }, starterLevel: 21, shinyRate: 0 });
    const live = createSimGame({ seed: 42, policy: { heal: { enabled: false } }, starterLevel: 21, shinyRate: 0 });
    for (const g of [fast, live]) {
        g.game.gameState.settings.captureDuplicates = 'off';
        monoRoute(g.game, 19, 4);
        const inst = g.game.roster.get(g.game.gameState.party[0]);
        inst.exp = g.ctx.getExpForLevel(g.ctx.POKEMON_DATA[25].expGroup, 22) - 1;   // falta 1 de XP para o nível 22 (Raichu)
    }
    const evolved = { fast: 0, live: 0 };
    fast.game.bus.on('evolution', () => evolved.fast++);
    live.game.bus.on('evolution', () => evolved.live++);
    fast.ctx.simulateHunt(fast.game, 24 * HOUR);
    for (let i = 0; i < N; i++) liveWin(live.game, 19, 4);
    const f = fast.game.roster.get(fast.game.gameState.party[0]);
    const l = live.game.roster.get(live.game.gameState.party[0]);
    assert.equal(f.speciesId, 26, 'evoluiu para Raichu no driver rápido');
    assert.equal(l.speciesId, 26, 'evoluiu para Raichu ao vivo');
    assert.equal(evolved.fast, 1);
    assert.equal(evolved.live, 1);
    // depois de evoluir para uma espécie ainda não registrada o nível reinicia (regra antiga); a luta posterior
    // é que difere (o driver rápido tem combate de verdade), então só as regras de evolução são comparadas
    for (const inst of [f, l]) assert.ok(inst.exp >= fast.ctx.getExpForLevel(fast.ctx.POKEMON_DATA[26].expGroup, inst.level));
});

test('equivalência de poções: a mesma regra de cura nos dois drivers (quantidade e consumo)', () => {
    const { game, ctx } = createSimGame({ seed: 43, potions: 5 });
    // ao vivo
    game.startBattle(); game.stopBattle();
    const b = game.currentBattle;
    const max = b.playerMaxHp;
    b.playerCurrentHp = 1;
    const live = game.usePotion();
    const liveHp = b.playerCurrentHp;
    // rápido
    const s = game._buildFastSimState(MIN, MIN);
    game._fastSim = s;
    s.playerHp = 1;
    const fast = game._fastExecute({ type: 'HEAL' });
    game._fastSim = null;
    assert.equal(live.ok && fast.ok, true);
    assert.equal(s.playerStats.hp, max);
    assert.equal(s.playerHp, liveHp, 'mesma cura');
    assert.equal(live.amount, fast.amount);
    assert.equal(game.getPotions(), 3, 'duas poções gastas, uma por driver');
    assert.equal(ctx.potionHealAmount(max), live.amount);
});

test('equivalência de rota e parada: mesma próxima rota e mesmo motivo de parada nos dois drivers', () => {
    const mk = (policy) => {
        const x = createSimGame({ seed: 44, policy, shinyRate: 0 });
        for (const p of x.game.getRoute('kanto_route1').pokemon) {
            if (!x.game.gameState.caughtPokemon[p.id]) x.game.catchPokemonWithIvs(p.id, 1, ivs(31));
            x.game.gameState.caughtPokemon[p.id].ivs = ivs(31);
            x.game.gameState.shinyDex[p.id] = true;
        }
        return x;
    };
    for (const policy of [{ heal: { enabled: false }, route: { mode: 'switchWhenComplete' } }, { heal: { enabled: false }, route: { mode: 'stopWhenComplete' } }]) {
        const f = mk(policy), l = mk(policy);
        f.ctx.simulateHunt(f.game, 10 * MIN);
        liveWin(l.game);
        assert.equal(f.game.gameState.currentRoute, l.game.gameState.currentRoute, JSON.stringify(policy.route));
        assert.equal(f.game.getHuntSession().state, l.game.getHuntSession().state);
        assert.equal(f.game.getHuntSession().stopReason, l.game.getHuntSession().stopReason);
    }
});

test('equivalência de parada por limite: mesmas estatísticas finais nos dois drivers', () => {
    const policy = { heal: { enabled: false }, stopConditions: { battleLimit: 12 } };
    const f = createSimGame({ seed: 45, policy, starterLevel: 25, shinyRate: 0 });
    const l = createSimGame({ seed: 45, policy, starterLevel: 25, shinyRate: 0 });
    f.ctx.simulateHunt(f.game, 24 * HOUR);
    for (let i = 0; i < 20; i++) liveWin(l.game);
    const sf = f.game.getHuntSession(), sl = l.game.getHuntSession();
    assert.equal(sf.stats.battles, 12);
    assert.equal(sl.stats.battles, 12);
    assert.equal(sf.stopReason, sl.stopReason);
    assert.equal(sf.state, 'stopped');
});

test('benchmark (modo rápido): roda, devolve métricas completas e termina em segundos', () => {
    const { runBenchmark } = require('../tools/bench-automation');
    const t0 = Date.now();
    const r = runBenchmark({ quick: true });
    assert.ok(Date.now() - t0 < 15000);
    assert.equal(r.sessions.length, 2);
    for (const s of r.sessions) {
        for (const k of ['wallMs', 'battles', 'battlesPerSecond', 'evaluations', 'actions', 'xpPerHour', 'capturesPerHour', 'heapDeltaMB', 'peakHeapMB', 'rssMB', 'speedup']) assert.ok(k in s, k);
        assert.ok(s.battles > 0 && s.xpPerHour > 0);
        assert.ok(s.speedup > 100, 'muito mais rápido que o tempo real');
    }
    assert.equal(r.durations.length, 2);
    assert.equal(r.policies.length, 2);
    assert.ok(r.durations[1].battles > r.durations[0].battles);
});
