'use strict';
// Fase 5A · B5: ActionDispatcher
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain } = require('./helpers/game');

const snapshot = (game) => JSON.stringify([game.gameState.currentRoute, game.gameState.automation, game.gameState.activePokemonIndex, game.gameState.pokedex, game.roster.count()]);
const start = (game, extra = {}) => game.dispatchAutomationAction({ type: 'START_HUNT', ...extra });
const wild = (game, id = 16) => Object.assign(game.createWildPokemon(id, 3, 0), { ivs: ivs(20), isShiny: false });

test('tipos de ação cobrem o conjunto da spec', () => {
    const { ctx } = newGame();
    for (const t of ['START_HUNT', 'STOP_HUNT', 'ATTACK', 'HEAL', 'CAPTURE', 'SWITCH_POKEMON', 'CHANGE_ROUTE']) assert.ok(ctx.AUTOMATION_ACTION_TYPES.includes(t), t);
});

test('ação desconhecida/malformada: rejeitada sem lançar nem mudar o estado', () => {
    const { game } = newGame();
    const before = snapshot(game);
    const seen = [];
    game.bus.on('action_rejected', (e) => seen.push(e));
    for (const bad of [null, undefined, {}, { type: 'FLY' }, { type: 42 }, 'START_HUNT', { type: '__proto__' }, { type: 'constructor' }]) {
        const r = game.dispatchAutomationAction(bad);
        assert.equal(r.ok, false, JSON.stringify(bad));
        assert.equal(r.code, 'unknown_action');
    }
    assert.equal(snapshot(game), before);
    assert.equal(seen.length, 8);
});

test('START_HUNT: cria sessão em execução, emite hunt_started, persiste política e snapshot', () => {
    const { game } = newGame();
    const seen = [];
    game.bus.on('*', (e) => seen.push(e));
    const r = start(game);
    assert.equal(r.ok, true);
    const s = game.getHuntSession();
    assert.equal(s.state, 'running');
    assert.equal(s.id, r.sessionId);
    assert.equal(s.routeId, game.gameState.currentRoute);
    assert.deepEqual(plain(s.partyUids), plain(game.gameState.party));
    assert.deepEqual(plain(s.policy), plain(game.getAutomationPolicy()));
    assert.ok(seen.some(e => e.type === 'hunt_started' && e.id === s.id));
});

test('START_HUNT: rejeita segunda caçada, rota inválida/bloqueada, política inválida, modo torre', () => {
    const { game } = newGame();
    const before = snapshot(game);
    assert.equal(start(game, { routeId: 'nao_existe' }).code, 'invalid_route');
    assert.equal(start(game, { routeId: 42 }).code, 'invalid_route');
    assert.equal(snapshot(game), before, 'rejeições não mudam o estado');
    game.gameState.automation = { policy: { target: { type: 'nada' } } };       // corrompida de propósito, fora do caminho do saneamento
    assert.equal(start(game).code, 'invalid_policy');
    delete game.gameState.automation;
    game._towerMode = true;
    assert.equal(start(game).code, 'tower_mode');
    game._towerMode = false;
    assert.equal(start(game).ok, true);
    assert.equal(start(game).code, 'hunt_active', 'não há duas caçadas');
});

test('START_HUNT com rota: troca a rota (motivo automation) e registra na sessão; rota bloqueada é recusada', () => {
    const { game, ctx } = newGame();
    const seen = [];
    game.bus.on('route_changed', (e) => seen.push(e));
    const lockedRoute = ctx.REGIONS.johto.routes[0].id;
    assert.equal(game.isRegionUnlocked('johto'), false);
    assert.equal(start(game, { routeId: lockedRoute }).code, 'route_locked');
    assert.equal(game.gameState.automation, undefined);
    assert.equal(start(game, { routeId: 'kanto_route2' }).ok, true);
    assert.equal(game.getHuntSession().routeId, 'kanto_route2');
    assert.equal(game.gameState.currentRoute, 'kanto_route2');
    assert.equal(seen[0].reason, 'automation');
});

test('PAUSE/RESUME/STOP: ciclo de vida, razões e tempo congelado', () => {
    const { game, ctx } = newGame();
    const clock = new ctx.ManualClock(1_000_000);
    game.clock = clock;
    const d = (a) => game.dispatchAutomationAction(a);
    assert.equal(d({ type: 'STOP_HUNT' }).code, 'no_active_hunt');
    assert.equal(d({ type: 'PAUSE_HUNT' }).code, 'no_running_hunt');
    assert.equal(d({ type: 'RESUME_HUNT' }).code, 'no_paused_hunt');
    start(game);
    clock.advance(10_000);
    assert.equal(d({ type: 'PAUSE_HUNT' }).ok, true);
    assert.equal(d({ type: 'PAUSE_HUNT' }).code, 'no_running_hunt');
    clock.advance(50_000);
    assert.equal(d({ type: 'RESUME_HUNT' }).ok, true);
    clock.advance(5_000);
    const seen = [];
    game.bus.on('hunt_stopped', (e) => seen.push(e));
    const stop = d({ type: 'STOP_HUNT', reason: 'no_potions' });
    assert.equal(stop.ok, true);
    assert.equal(seen[0].durationMs, 15_000, 'a pausa não conta');
    assert.equal(game.getHuntSession().state, 'stopped');
    assert.equal(game.getHuntSession().stopReason, 'no_potions');
    assert.equal(d({ type: 'STOP_HUNT' }).code, 'no_active_hunt', 'parar duas vezes é recusado');
    const again = start(game);
    assert.equal(again.ok, true, 'depois de parada dá para iniciar outra');
    assert.notEqual(game.getHuntSession().id, stop.sessionId);
});

test('sem caçada em andamento nenhuma ação operacional executa (parada = nada acontece)', () => {
    const { game } = newGame();
    const before = snapshot(game);
    const w = wild(game);
    for (const a of [{ type: 'ATTACK' }, { type: 'HEAL' }, { type: 'CAPTURE', wild: w }, { type: 'SWITCH_POKEMON', index: 0 }, { type: 'CHANGE_ROUTE', routeId: 'kanto_route2' }]) {
        const r = game.dispatchAutomationAction(a);
        assert.equal(r.ok, false, a.type);
        assert.equal(r.code, 'no_running_hunt', a.type);
    }
    assert.equal(snapshot(game), before);
    assert.equal(w._captureResolved, undefined, 'a captura nem foi tocada');
    // pausada também não executa
    start(game);
    game.dispatchAutomationAction({ type: 'PAUSE_HUNT' });
    assert.equal(game.dispatchAutomationAction({ type: 'CHANGE_ROUTE', routeId: 'kanto_route2' }).code, 'no_running_hunt');
});

test('CAPTURE: aplica a decisão da política uma única vez por Pokémon (sem indivíduo/uid duplicado)', () => {
    const { game } = newGame({ seed: 21 });
    game.setAutomationPolicy({ capture: { minQualityPercent: 50, alwaysNewSpecies: false } });
    start(game);
    const good = Object.assign(wild(game, 16), { ivs: ivs(28) });
    const r1 = game.dispatchAutomationAction({ type: 'CAPTURE', wild: good });
    assert.equal(r1.ok, true);
    assert.equal(r1.captured, true);
    assert.equal(game.roster.countOfSpecies(16), 1);
    const r2 = game.dispatchAutomationAction({ type: 'CAPTURE', wild: good });
    assert.equal(r2.code, 'already_resolved');
    assert.equal(game.processDefeat(good), null, 'a via legada também não reaplica');
    assert.equal(game.roster.countOfSpecies(16), 1);
    const bad = Object.assign(wild(game, 19), { ivs: ivs(3) });
    const r3 = game.dispatchAutomationAction({ type: 'CAPTURE', wild: bad });
    assert.equal(r3.ok, true);
    assert.equal(r3.captured, false, 'a política recusou');
    assert.equal(game.roster.countOfSpecies(19), 0);
    for (const invalid of [{}, { wild: null }, { wild: { id: 99999, ivs: {} } }, { wild: { id: 16 } }]) {
        assert.equal(game.dispatchAutomationAction({ type: 'CAPTURE', ...invalid }).code, 'invalid_target');
    }
});

test('CHANGE_ROUTE: valida rota, mesma rota e bloqueio; atualiza a sessão', () => {
    const { game, ctx } = newGame();
    start(game);
    const d = (routeId) => game.dispatchAutomationAction({ type: 'CHANGE_ROUTE', routeId });
    assert.equal(d('nao_existe').code, 'invalid_route');
    assert.equal(d(undefined).code, 'invalid_route');
    assert.equal(d(game.gameState.currentRoute).code, 'same_route');
    assert.equal(d(ctx.REGIONS.johto.routes[0].id).code, 'route_locked');
    assert.equal(game.gameState.currentRoute, 'kanto_route1', 'rejeições não mudam a rota');
    const ok = d('kanto_route2');
    assert.deepEqual(plain({ ok: ok.ok, from: ok.from, to: ok.to }), { ok: true, from: 'kanto_route1', to: 'kanto_route2' });
    assert.equal(game.getHuntSession().routeId, 'kanto_route2');
});

test('SWITCH_POKEMON: valida índice, ativo atual e estado; troca e emite pokemon_switched', () => {
    const { game } = newGame();
    game.catchPokemonWithIvs(16, 1, ivs(10));
    game.addToTeamFromPokedex(16);
    start(game);
    game.startBattle();
    const d = (index) => game.dispatchAutomationAction({ type: 'SWITCH_POKEMON', index });
    assert.equal(game.gameState.team.length, 2);
    assert.equal(d(-1).code, 'invalid_member');
    assert.equal(d(9).code, 'invalid_member');
    assert.equal(d(1.5).code, 'invalid_member');
    assert.equal(d('1').code, 'invalid_member');
    assert.equal(d(game.gameState.activePokemonIndex).code, 'already_active');
    const seen = [];
    game.bus.on('pokemon_switched', (e) => seen.push(e));
    const r = d(1);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(game.gameState.activePokemonIndex, 1);
    assert.equal(seen.length, 1);
});

test('HEAL: registrada mas recusada enquanto poções não existem (nenhum efeito colateral)', () => {
    const { game } = newGame();
    start(game);
    const before = snapshot(game);
    assert.equal(game.dispatchAutomationAction({ type: 'HEAL' }).code, 'heal_unavailable');
    assert.equal(snapshot(game), before);
});

test('ATTACK: só com batalha ociosa; em curso é recusado', () => {
    const { game } = newGame();
    start(game);
    game.startBattle();
    assert.equal(game.dispatchAutomationAction({ type: 'ATTACK' }).code, 'already_engaged');
    game.stopBattle();
    assert.equal(game.dispatchAutomationAction({ type: 'ATTACK' }).ok, true);
    assert.ok(game.battleTimer);
});

test('exceção no handler é contida: emite automation_error e devolve erro, sem lançar', () => {
    const { game } = newGame();
    const errs = [];
    game.bus.on('automation_error', (e) => errs.push(e));
    start(game);
    game.changeRoute = () => { throw new Error('boom'); };
    const r = game.dispatchAutomationAction({ type: 'CHANGE_ROUTE', routeId: 'kanto_route2' });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'execution_error');
    assert.equal(errs.length, 1);
    assert.equal(errs[0].stage, 'execute');
});
