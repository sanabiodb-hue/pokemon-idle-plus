'use strict';
// Fase 6 · F6.4: Hunt Analyzer (métricas por hora, agregação por rota, histórico, objetivo, persistência)
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain, runOffline } = require('./helpers/game');
const { createSimGame } = require('../tools/automation-sim');

const HOUR = 3600000, MIN = 60000;
const hunt = (game, policy) => { if (policy) game.setAutomationPolicy(policy); const r = game.dispatchAutomationAction({ type: 'START_HUNT' }); assert.equal(r.ok, true); game.stopBattle(); return game.getHuntSession(); };
const win = (g, id = 19, level = 4, shiny = false) => g._processVictoryRewards(Object.assign(g.createWildPokemon(id, level, 0), { isShiny: shiny, ivs: ivs(31) }), 25, 100, 100);
const stop = (g) => g.dispatchAutomationAction({ type: 'STOP_HUNT' });

test('huntRates: contas por hora, taxas e médias (e zero quando não há amostra)', () => {
    const { ctx } = newGame();
    const agg = { ms: 30 * MIN, battles: 100, victories: 90, defeats: 10, xp: 5000, money: 1000, captures: 9, shinies: 1, potions: 20, healCost: 400, qualitySum: 450, last: 0 };
    const r = ctx.huntRates(agg, 1 / 4096);
    assert.equal(r.battlesPerHour, 200);
    assert.equal(r.victoriesPerHour, 180);
    assert.equal(r.xpPerHour, 10000);
    assert.equal(r.moneyPerHour, 2000);
    assert.equal(r.capturesPerHour, 18);
    assert.equal(r.shiniesPerHour, 2);
    assert.equal(r.potionsPerHour, 40);
    assert.equal(r.healCostPerHour, 800);
    assert.equal(r.profitPerHour, 1200);
    assert.equal(r.winRate, 90);
    assert.equal(r.captureRate, 10);
    assert.equal(r.avgBattleMs, 18000);
    assert.equal(r.avgQuality, 50);
    assert.ok(Math.abs(r.expectedShiniesPerHour - 200 / 4096) < 1e-9);
    const z = ctx.huntRates(ctx.emptyRouteAgg());
    for (const v of Object.values(z)) assert.equal(v, 0);
});

test('metas: cada objetivo usa a métrica certa (dinheiro = lucro, shiny = esperado)', () => {
    const { ctx } = newGame();
    const r = { xpPerHour: 1, profitPerHour: 2, moneyPerHour: 9, capturesPerHour: 3, expectedShiniesPerHour: 4, shiniesPerHour: 8 };
    assert.deepEqual(['xp', 'money', 'captures', 'shiny'].map(g => ctx.goalMetric(r, g)), [1, 2, 3, 4]);
    assert.equal(ctx.goalMetric(r, 'lixo'), 1);
});

test('objetivo: padrão XP, troca válida persiste, inválida é recusada', () => {
    const a = newGame();
    assert.equal(a.game.getAnalyzerGoal(), 'xp');
    assert.equal(a.game.setAnalyzerGoal('money').ok, true);
    assert.equal(a.game.setAnalyzerGoal('lixo').code, 'invalid_goal');
    assert.equal(a.game.setAnalyzerGoal(undefined).code, 'invalid_goal');
    assert.equal(a.game.getAnalyzerGoal(), 'money');
    a.game.saveNow();
    const b = newGame({ storage: a.storage, load: true });
    assert.equal(b.game.getAnalyzerGoal(), 'money');
});

test('fim da caçada: agregado da rota, histórico e hunt_completed (só quando termina por condição)', () => {
    const { game } = newGame({ seed: 1 });
    const seen = [];
    game.bus.on('hunt_completed', (e) => seen.push(e));
    let s = hunt(game, { heal: { enabled: false }, stopConditions: { battleLimit: 6 } });
    for (let i = 0; i < 8; i++) win(game);
    assert.equal(s.state, 'stopped');
    const agg = game.gameState.analyzer.routes.kanto_route1;
    assert.equal(agg.battles, 6);
    assert.equal(agg.victories, 6);
    assert.equal(agg.xp, s.stats.xp);
    assert.equal(agg.money, s.stats.money);
    assert.equal(game.getHuntHistory().length, 1);
    const h = game.getHuntHistory()[0];
    assert.deepEqual(plain({ routeId: h.routeId, battles: h.battles, reason: h.stopReason, xp: h.xp }), { routeId: 'kanto_route1', battles: 6, reason: 'battle_limit', xp: s.stats.xp });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].reason, 'battle_limit');
    s = hunt(game, { stopConditions: { battleLimit: 0 } });
    win(game);
    stop(game);
    assert.equal(seen.length, 1, 'parada manual não é "concluída"');
    assert.equal(game.getHuntHistory().length, 2);
    assert.equal(game.getHuntHistory()[0].stopReason, 'manual', 'mais recente primeiro');
});

test('troca de rota no meio: cada trecho é creditado à sua rota e a soma bate com a sessão', () => {
    const { game } = newGame({ seed: 2 });
    const s = hunt(game, { heal: { enabled: false } });
    for (let i = 0; i < 5; i++) win(game);
    game.dispatchAutomationAction({ type: 'CHANGE_ROUTE', routeId: 'kanto_route2' });
    for (let i = 0; i < 3; i++) win(game);
    game.dispatchAutomationAction({ type: 'PAUSE_HUNT' });
    game.dispatchAutomationAction({ type: 'RESUME_HUNT' });
    for (let i = 0; i < 2; i++) win(game);
    game.dispatchAutomationAction({ type: 'CHANGE_ROUTE', routeId: 'kanto_route1' });
    for (let i = 0; i < 4; i++) win(game);
    stop(game);
    const r = game.gameState.analyzer.routes;
    assert.equal(r.kanto_route1.battles, 9);
    assert.equal(r.kanto_route2.battles, 5);
    assert.equal(r.kanto_route1.battles + r.kanto_route2.battles, s.stats.battles);
    assert.equal(r.kanto_route1.xp + r.kanto_route2.xp, s.stats.xp);
    assert.equal(r.kanto_route1.money + r.kanto_route2.money, s.stats.money);
    assert.equal(game.getHuntHistory().length, 1, 'uma caçada = uma linha de histórico');
});

test('sem contagem dupla: pausar/retomar/flush repetido não altera os totais', () => {
    const { game } = newGame({ seed: 3 });
    hunt(game, { heal: { enabled: false } });
    for (let i = 0; i < 4; i++) win(game);
    for (let i = 0; i < 5; i++) game.analyzerFlush();
    game.dispatchAutomationAction({ type: 'PAUSE_HUNT' });
    game.analyzerFlush(); game.analyzerFlush();
    assert.equal(game.gameState.analyzer.routes.kanto_route1.battles, 4);
    game.dispatchAutomationAction({ type: 'RESUME_HUNT' });
    win(game);
    stop(game);
    assert.equal(game.gameState.analyzer.routes.kanto_route1.battles, 5);
    stop(game);
    assert.equal(game.getHuntHistory().length, 1);
});

test('tempo da rota usa o relógio da sessão (a pausa não conta) e a análise ao vivo inclui o trecho em andamento', () => {
    const { game, ctx } = newGame({ seed: 4 });
    const clock = new ctx.ManualClock(1_000_000);
    game.clock = clock;
    hunt(game, { heal: { enabled: false } });
    clock.advance(10 * MIN);
    for (let i = 0; i < 10; i++) win(game);
    const live = game.getRouteAgg('kanto_route1');
    assert.equal(live.ms, 10 * MIN);
    assert.equal(live.battles, 10);
    game.dispatchAutomationAction({ type: 'PAUSE_HUNT' });
    clock.advance(5 * HOUR);
    game.dispatchAutomationAction({ type: 'RESUME_HUNT' });
    clock.advance(20 * MIN);
    for (let i = 0; i < 30; i++) win(game);
    stop(game);
    const agg = game.gameState.analyzer.routes.kanto_route1;
    assert.equal(agg.ms, 30 * MIN);
    const rates = game.getRouteRates('kanto_route1');
    assert.equal(rates.battlesPerHour, 80);
    assert.equal(game.getRouteAgg('kanto_route2'), null);
});

test('custo de cura, lucro e qualidade média das capturas entram nas estatísticas', () => {
    const { game } = newGame({ seed: 5 });
    game.gameState.badges.kanto = { unlocked: true };
    const s = hunt(game, { heal: { enabled: true, whenHpBelowPercent: 99 } });
    game.startBattle(); game.stopBattle();
    game.currentBattle.playerCurrentHp = 1;
    const price = game.getPotionPrice();
    game.usePotion('automation');
    assert.equal(s.stats.healingSpent, 1);
    assert.equal(s.stats.healCost, price);
    game.processDefeat(Object.assign(game.createWildPokemon(16, 3, 0), { ivs: ivs(31), isShiny: false }));
    game.processDefeat(Object.assign(game.createWildPokemon(10, 3, 0), { ivs: ivs(0), isShiny: false }));
    assert.equal(s.stats.captures, 2);
    assert.equal(s.stats.qualitySum, 100);
    s.stats.money = 1000;
    const a = game.getHuntAnalysis();
    assert.equal(a.rates.avgQuality, 50);
    assert.equal(a.totals.healCost, price);
    assert.equal(a.rates.profitPerHour <= a.rates.moneyPerHour, true);
});

test('driver rápido alimenta o analisador igual ao ao vivo (offline com caçada recarregada)', async () => {
    const a = newGame({ seed: 6 });
    a.game.setAutomationPolicy({ heal: { enabled: false } });
    a.game.dispatchAutomationAction({ type: 'START_HUNT' });
    a.game.stopBattle();
    a.game.saveNow();
    const b = newGame({ storage: a.storage, load: true });
    await runOffline(b.game, 30 * MIN);
    const s = b.game.getHuntSession();
    const agg = b.game.gameState.analyzer.routes[s.routeId];
    assert.equal(agg.battles, s.stats.battles);
    assert.equal(agg.xp, s.stats.xp);
    assert.ok(agg.ms > 0 && agg.ms <= 30 * MIN + 1000);
    b.game.dispatchAutomationAction({ type: 'RESUME_HUNT' });
    b.game.stopBattle();
    stop(b.game);
    const h = b.game.getHuntHistory()[0];
    assert.equal(h.battles, s.stats.battles);
    assert.equal(b.game.gameState.analyzer.routes[s.routeId].battles, s.stats.battles, 'sem duplicar o trecho offline');
});

test('simulateHunt (driver rápido) também fecha as contas por rota', () => {
    const { game, ctx } = createSimGame({ seed: 7, policy: { heal: { enabled: false }, stopConditions: { timeLimitMinutes: 20 } } });
    const r = ctx.simulateHunt(game, 2 * HOUR);
    assert.equal(r.stopReason, 'time_limit');
    const agg = game.gameState.analyzer.routes.kanto_route1;
    assert.equal(agg.battles, r.battles);
    assert.ok(Math.abs(agg.ms - r.simulatedMs) < 2000);
});

test('histórico limitado a 20 e rotas limitadas pela configuração', () => {
    const { game, ctx } = newGame({ seed: 8 });
    game.econCfg = { ...ctx.ECONOMY_CONFIG, analyzer: { ...ctx.ECONOMY_CONFIG.analyzer, routesMax: 3 } };
    const routes = ['kanto_route1', 'kanto_route2', 'kanto_route3', 'kanto_route4', 'kanto_route5'];
    for (let i = 0; i < 25; i++) {
        game.gameState.currentRoute = routes[i % routes.length];
        hunt(game, { heal: { enabled: false } });
        win(game);
        game.clock = new ctx.ManualClock(game.now() + 1000);          // cada caçada com carimbo de tempo diferente
        stop(game);
    }
    assert.equal(game.getHuntHistory().length, 20);
    assert.equal(Object.keys(game.gameState.analyzer.routes).length, 3);
    assert.ok(JSON.stringify(game.gameState.analyzer).length < 8000, 'estado do analisador continua pequeno');
});

test('persistência: histórico, rotas e marca sobrevivem a salvar/carregar sem duplicar', () => {
    const a = newGame({ seed: 9 });
    hunt(a.game, { heal: { enabled: false } });
    for (let i = 0; i < 3; i++) win(a.game);
    stop(a.game);
    hunt(a.game);
    win(a.game);
    a.game.saveNow();
    const snap = plain(a.game.gameState.analyzer);
    for (let i = 0; i < 2; i++) {
        const b = newGame({ storage: a.storage, load: true });
        assert.deepEqual(plain(b.game.gameState.analyzer), snap);
        b.game.saveNow();
    }
    const c = newGame({ storage: a.storage, load: true });
    c.game.dispatchAutomationAction({ type: 'RESUME_HUNT' });
    c.game.stopBattle();
    stop(c.game);
    const total = Object.values(c.game.gameState.analyzer.routes).reduce((x, r) => x + r.battles, 0);
    assert.equal(total, 4, '3 + 1 vitórias, cada uma contada uma vez');
});

test('saneamento: lixo, rotas inválidas, objetivo desconhecido e números negativos são descartados', () => {
    const { ctx } = newGame();
    const clean = ctx.sanitizeAnalyzerState({
        goal: 'hack', history: [{ routeId: '../x', xp: 1 }, { routeId: 'kanto_route1', xp: -5, battles: 'x', stopReason: 'manual' }, 7, null],
        routes: { kanto_route1: { xp: 10, battles: -1, last: 5 }, 'bad id': { xp: 1 }, constructor: { xp: 1 } }, mark: { sessionId: 'x y', routeId: 'kanto_route1' },
    });
    assert.equal(clean.goal, 'xp');
    assert.equal(clean.history.length, 1);
    assert.deepEqual(plain({ xp: clean.history[0].xp, battles: clean.history[0].battles }), { xp: 0, battles: 0 });
    assert.deepEqual(Object.keys(clean.routes), ['kanto_route1']);
    assert.equal(clean.routes.kanto_route1.battles, 0);
    assert.equal(clean.mark, null);
    assert.deepEqual(plain(ctx.sanitizeAnalyzerState(5)), { goal: 'xp', history: [], routes: {}, mark: null });
});

test('analyzer_opened é limitado (no máximo 1 por minuto) e usa o relógio injetado', () => {
    const { game, ctx } = newGame();
    const clock = new ctx.ManualClock(1_000_000);
    game.clock = clock;
    const seen = [];
    game.bus.on('analyzer_opened', (e) => seen.push(e));
    for (let i = 0; i < 10; i++) game.noteAnalyzerOpened();
    assert.equal(seen.length, 1);
    clock.advance(61000);
    game.noteAnalyzerOpened();
    assert.equal(seen.length, 2);
    assert.equal(seen[0].goal, 'xp');
});
