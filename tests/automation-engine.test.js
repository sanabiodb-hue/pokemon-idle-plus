'use strict';
// Fase 5A · B6: AutomationEngine (driver ao vivo) + decisão pura
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain, runOffline } = require('./helpers/game');

const D = (ctx, stage, snap) => plain(ctx.decideAutomationActions(stage, snap));
const basePolicy = (ctx, over = {}) => ctx.validateAutomationPolicy(over).policy;
const hunt = (game, policy, extra = {}) => {
    if (policy) {
        const r = game.setAutomationPolicy(policy);
        assert.equal(r.ok, true, JSON.stringify(r.errors));
    }
    const r = game.dispatchAutomationAction({ type: 'START_HUNT', ...extra });
    assert.equal(r.ok, true, JSON.stringify(r));
    return game.getHuntSession();
};
// uma vitória "ao vivo": passa pelas mesmas regras do núcleo e emite os mesmos eventos
const win = (game, id = 19, level = 3) => game._processVictoryRewards(game.createWildPokemon(id, level, 0), 25, 100, 100);
const completeRoute = (game, routeId) => {
    for (const p of game.getRoute(routeId).pokemon) {
        if (!game.gameState.caughtPokemon[p.id]) game.catchPokemonWithIvs(p.id, 1, ivs(31));
        game.gameState.caughtPokemon[p.id].ivs = ivs(31);
        game.gameState.shinyDex[p.id] = true;
    }
    assert.equal(game.isRouteComplete6VShiny(routeId), true);
};

// ------------------------------------------------------------- decisão pura
test('decisão: condições de parada têm prioridade e são puras', () => {
    const { ctx } = newGame();
    const pol = basePolicy(ctx, { stopConditions: { battleLimit: 10, timeLimitMinutes: 2 }, route: { mode: 'switchWhenComplete' } });
    const snap = { policy: pol, stats: { battles: 10 }, durationMs: 0, routeComplete: true, nextRouteId: 'r2', currentRouteId: 'r1' };
    const frozen = JSON.stringify(snap);
    assert.deepEqual(D(ctx, 'after_battle', snap), [{ action: { type: 'STOP_HUNT', reason: 'battle_limit' }, reason: 'battle_limit' }]);
    assert.equal(JSON.stringify(snap), frozen, 'não muta a entrada');
    assert.equal(D(ctx, 'after_battle', { ...snap, stats: { battles: 3 }, durationMs: 120000 })[0].action.reason, 'time_limit');
    assert.equal(D(ctx, 'after_battle', { ...snap, stats: { battles: 9 }, durationMs: 119999 })[0].action.type, 'CHANGE_ROUTE');
    assert.deepEqual(D(ctx, 'after_battle', snap), D(ctx, 'after_battle', snap), 'determinística');
});

test('decisão: modos de rota', () => {
    const { ctx } = newGame();
    const mk = (mode, extra = {}) => ({ policy: basePolicy(ctx, { route: { mode } }), stats: { battles: 1 }, durationMs: 0, routeComplete: true, nextRouteId: 'r2', currentRouteId: 'r1', ...extra });
    assert.deepEqual(D(ctx, 'after_battle', mk('stay')), []);
    assert.equal(D(ctx, 'after_battle', mk('stopWhenComplete'))[0].action.reason, 'route_complete');
    assert.deepEqual(D(ctx, 'after_battle', mk('switchWhenComplete'))[0].action, { type: 'CHANGE_ROUTE', routeId: 'r2' });
    assert.equal(D(ctx, 'after_battle', mk('switchWhenComplete', { nextRouteId: null }))[0].action.type, 'STOP_HUNT', 'sem próxima rota: para');
    assert.deepEqual(D(ctx, 'after_battle', mk('stopWhenComplete', { routeComplete: false })), [], 'rota incompleta: nada');
});

test('decisão: troca de Pokémon no encontro; entradas inválidas não geram ações', () => {
    const { ctx } = newGame();
    const pol = basePolicy(ctx);
    assert.deepEqual(D(ctx, 'encounter', { policy: pol, bestIndex: 2, activeIndex: 0 }).map(x => x.action.index), [2]);
    assert.deepEqual(D(ctx, 'encounter', { policy: pol, bestIndex: 0, activeIndex: 0 }), []);
    assert.deepEqual(D(ctx, 'encounter', { policy: pol, bestIndex: -1, activeIndex: 0 }), []);
    assert.deepEqual(D(ctx, 'encounter', { policy: basePolicy(ctx, { switchPolicy: { mode: 'keep' } }), bestIndex: 2, activeIndex: 0 }), []);
    for (const bad of [null, undefined, {}, { policy: null }]) assert.deepEqual(D(ctx, 'after_battle', bad), []);
    assert.deepEqual(D(ctx, 'nada', { policy: pol }), []);
});

// ------------------------------------------------------------- motor ao vivo
test('sem caçada o motor não existe: nenhum assinante no barramento e eventos offline continuam sem custo', () => {
    const { game } = newGame();
    assert.equal(game.bus.hasListeners(), false);
    win(game);
    assert.equal(game.getHuntSession(), null);
    assert.equal(game.gameState.automation, undefined);
});

test('caçada acumula estatísticas da sessão exatamente uma vez por vitória (recompensas não duplicam)', () => {
    const { game } = newGame({ seed: 31 });
    const s = hunt(game);
    assert.equal(game.bus.hasListeners(), true);
    let xp = 0, gold = 0;
    for (let i = 0; i < 12; i++) { const r = win(game, [16, 19, 10][i % 3], 4); xp += r.expGained; gold += r.goldGained; }
    assert.equal(s.stats.battles, 12);
    assert.equal(s.stats.victories, 12);
    assert.equal(s.stats.defeats, 0);
    assert.equal(s.stats.xp, xp);
    assert.equal(s.stats.money, gold);
    assert.equal(game.gameState.stats.totalBattles, 12, 'contador do jogo coincide');
});

test('captura durante a caçada soma capturas e shinies; captura recusada não soma', () => {
    const { game, ctx } = newGame({ seed: 32 });
    const s = hunt(game, { capture: { minQualityPercent: 60, alwaysNewSpecies: false } });
    const mk = (id, v, shiny = false) => Object.assign(game.createWildPokemon(id, 3, 0), { ivs: ivs(v), isShiny: shiny });
    game.processDefeat(mk(16, 30));
    game.processDefeat(mk(19, 2));                  // recusada
    game.processDefeat(mk(10, 1, true));            // shiny entra mesmo assim
    game.processDefeat(mk(16, 31));                 // duplicata: depende da regra de duplicatas
    assert.equal(game.roster.countOfSpecies(19), 0);
    const owned = game.roster.countOfSpecies(16) + game.roster.countOfSpecies(10);
    assert.equal(s.stats.captures, owned, 'capturas da sessão = indivíduos criados');
    assert.equal(s.stats.shinies, 1);
});

test('derrota real do jogador emite battle_completed(defeat) e entra nas estatísticas', () => {
    const { game } = newGame({ seed: 33 });
    const s = hunt(game);
    game.stopBattle();
    game.startBattle();
    game.stopBattle();
    const b = game.currentBattle;
    b.playerCurrentHp = 1;
    b.enemyTimer = b.enemyNextAttack;
    b.playerTimer = 0;
    game.rng = () => 0.99;
    const seen = [];
    game.bus.on('battle_completed', (e) => seen.push(e));
    game.battleTick();
    assert.equal(seen.length, 1, JSON.stringify(seen));
    assert.equal(seen[0].result, 'defeat');
    assert.equal(s.stats.defeats, 1);
    assert.equal(s.stats.battles, 1);
    assert.equal(s.stats.victories, 0);
});

test('battleLimit: a caçada para sozinha na batalha N, com razão e sem assinantes sobrando', () => {
    const { game } = newGame({ seed: 34 });
    const s = hunt(game, { stopConditions: { battleLimit: 5 } });
    const stopped = [];
    game.bus.on('hunt_stopped', (e) => stopped.push(e));
    for (let i = 0; i < 9; i++) win(game);
    assert.equal(s.state, 'stopped');
    assert.equal(s.stopReason, 'battle_limit');
    assert.equal(s.stats.battles, 5, 'depois de parar nada é contado');
    assert.equal(stopped.length, 1);
    assert.equal(stopped[0].stats.battles, 5);
    assert.equal(game._engine.isAttached(), false);
});

test('timeLimitMinutes usa o relógio injetado (a pausa não conta)', () => {
    const { game, ctx } = newGame({ seed: 35 });
    const clock = new ctx.ManualClock(5_000_000);
    game.clock = clock;
    const s = hunt(game, { stopConditions: { timeLimitMinutes: 2 } });
    clock.advance(60_000);
    win(game);
    assert.equal(s.state, 'running');
    game.dispatchAutomationAction({ type: 'PAUSE_HUNT' });
    clock.advance(10 * 60_000);
    game.dispatchAutomationAction({ type: 'RESUME_HUNT' });
    win(game);
    assert.equal(s.state, 'running', 'a pausa de 10 min não conta');
    clock.advance(60_000);
    win(game);
    assert.equal(s.state, 'stopped');
    assert.equal(s.stopReason, 'time_limit');
});

test('rota completa: stop → para; switchWhenComplete → muda para a próxima; stay → fica', () => {
    for (const [mode, expect] of [['stopWhenComplete', 'stopped'], ['switchWhenComplete', 'running'], ['stay', 'running']]) {
        const { game } = newGame({ seed: 36 });
        completeRoute(game, 'kanto_route1');
        const s = hunt(game, { route: { mode } });
        win(game);
        assert.equal(s.state, expect, mode);
        if (mode === 'switchWhenComplete') {
            assert.notEqual(game.gameState.currentRoute, 'kanto_route1');
            assert.equal(s.routeId, game.gameState.currentRoute, 'a sessão acompanha a rota');
        }
        if (mode === 'stay') assert.equal(game.gameState.currentRoute, 'kanto_route1');
        if (mode === 'stopWhenComplete') assert.equal(s.stopReason, 'route_complete');
    }
});

test('troca automática de rota do jogo antigo não age durante a caçada (a política manda) e volta depois', () => {
    const { game } = newGame({ seed: 37 });
    completeRoute(game, 'kanto_route1');
    game.gameState.settings.autoRouteSwitch = true;
    hunt(game, { route: { mode: 'stay' } });
    win(game);
    assert.equal(game.gameState.currentRoute, 'kanto_route1');
    game.dispatchAutomationAction({ type: 'STOP_HUNT' });
    win(game);
    assert.notEqual(game.gameState.currentRoute, 'kanto_route1', 'sem caçada, o comportamento antigo volta');
});

test('troca de Pokémon no encontro: bestMatchup troca via SWITCH_POKEMON; keep respeita a política mesmo com o ajuste antigo ligado', () => {
    for (const mode of ['bestMatchup', 'keep']) {
        const { game } = newGame({ seed: 38 });
        game.catchPokemonWithIvs(16, 1, ivs(10));
        game.addToTeamFromPokedex(16);
        game.gameState.settings.autoSwitchBest = true;                  // ajuste antigo ligado
        game.gameState.activePokemonIndex = 0;
        game.gameState.currentEnemy = null;
        game.getBestTeamMemberForEnemy = () => 1;
        hunt(game, { switchPolicy: { mode } });
        const seen = [];
        game.bus.on('pokemon_switched', (e) => seen.push(e));
        game.stopBattle();
        game.gameState.activePokemonIndex = 0;                          // START_HUNT já abriu uma batalha; recomeça do zero
        game.gameState.currentEnemy = null;
        game.currentBattle = null;
        game.startBattle();
        assert.equal(game.gameState.activePokemonIndex, mode === 'bestMatchup' ? 1 : 0, mode);
        assert.equal(seen.length, mode === 'bestMatchup' ? 1 : 0);
    }
});

test('pausada: não registra, não decide; retomar volta ao normal', () => {
    const { game } = newGame({ seed: 39 });
    const s = hunt(game, { stopConditions: { battleLimit: 3 } });
    win(game);
    game.dispatchAutomationAction({ type: 'PAUSE_HUNT' });
    assert.equal(game._engine.isAttached(), false);
    for (let i = 0; i < 5; i++) win(game);
    assert.equal(s.stats.battles, 1);
    assert.equal(s.state, 'paused');
    game.dispatchAutomationAction({ type: 'RESUME_HUNT' });
    win(game); win(game);
    assert.equal(s.state, 'stopped');
    assert.equal(s.stats.battles, 3);
});

test('parada: o motor não executa nem decide mais nada', () => {
    const { game } = newGame({ seed: 40 });
    hunt(game);
    game.dispatchAutomationAction({ type: 'STOP_HUNT' });
    const seen = [];
    game.bus.on('*', (e) => seen.push(e.type));
    win(game);
    assert.equal(seen.includes('automation_decision'), false);
    assert.equal(seen.includes('action_rejected'), false);
    assert.equal(game._engine.isAttached(), false);
});

test('sem laço infinito: uma vitória gera uma avaliação e no máximo um punhado de ações', () => {
    const { game, ctx } = newGame({ seed: 41 });
    completeRoute(game, 'kanto_route1');
    hunt(game, { route: { mode: 'switchWhenComplete' } });
    const before = game._engine.stats.evaluations;
    win(game);
    assert.equal(game._engine.stats.evaluations - before, 1);
    assert.ok(game._engine.stats.actionsOk <= ctx.AUTOMATION_MAX_ACTIONS_PER_EVALUATION);
    // reentrância: avaliar dentro da avaliação é ignorado
    game._engine._evaluating = true;
    assert.deepEqual(plain(game._engine.evaluate('after_battle')), []);
    game._engine._evaluating = false;
});

test('erro dentro do motor é contido (automation_error) e a caçada continua sã', () => {
    const { game } = newGame({ seed: 42 });
    const s = hunt(game);
    const errs = [];
    game.bus.on('automation_error', (e) => errs.push(e));
    game._isRouteCompleteByCondition = () => { throw new Error('quebrou'); };
    assert.doesNotThrow(() => win(game));
    assert.equal(errs.length, 1);
    assert.equal(s.stats.victories, 1, 'as estatísticas já tinham sido registradas');
    assert.equal(game._engine._evaluating, false);
});

test('offline com caçada rodando: estatísticas acumulam, decisões não rodam no meio do lote, sem exceções', async () => {
    const { game } = newGame({ seed: 43 });
    const s = hunt(game, { stopConditions: { battleLimit: 5 } });
    game.stopBattle();
    await runOffline(game, 10 * 60 * 1000);
    assert.ok(s.stats.victories > 50);
    assert.equal(s.stats.battles, s.stats.victories + s.stats.defeats);
    assert.equal(s.state, 'running', 'decisões só em eventos ao vivo (o simulador rápido chega no bloco B9)');
});

test('salvar/carregar no meio da caçada: volta pausada e o jogo antigo segue normal', () => {
    const a = newGame({ seed: 44 });
    hunt(a.game, { capture: { minQualityPercent: 40 } });
    for (let i = 0; i < 4; i++) win(a.game);
    a.game.saveNow();
    const b = newGame({ storage: a.storage, load: true });
    const s = b.game.getHuntSession();
    assert.equal(s.state, 'paused');
    assert.equal(s.stats.battles, 4);
    assert.equal(b.game.isHuntRunning(), false);
    assert.equal(b.game.bus.hasListeners(), false);
    assert.equal(b.game.decideCapture(Object.assign(b.game.createWildPokemon(16, 3, 0), { ivs: ivs(0) })).reason, 'legacy');
    assert.equal(b.game.dispatchAutomationAction({ type: 'RESUME_HUNT' }).ok, true);
    win(b.game);
    assert.equal(b.game.getHuntSession().stats.battles, 5);
});
