'use strict';
// Fase 6 · F6.5: comparação de rotas, estimativas (rápidas, em cópia), recomendação por objetivo
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, plain } = require('./helpers/game');
const { createSimGame } = require('../tools/automation-sim');

const MIN = 60000;
const mkAgg = (o) => ({ ms: 60 * MIN, battles: 100, victories: 100, defeats: 0, xp: 1000, money: 100, captures: 5, shinies: 0, potions: 0, healCost: 0, qualitySum: 0, last: 1, ...o });
const setAgg = (game, routeId, o) => { game.ensureAnalyzer().routes[routeId] = mkAgg(o); };
const ids = ['kanto_route1', 'kanto_route2', 'kanto_route3'];

function seeded() {
    const { game, ctx } = createSimGame({ seed: 3, starterLevel: 30, start: false });
    game._simMode = false;
    return { game, ctx };
}

test('estimar uma rota: determinístico, rotulado "estimated", sem mexer no jogo real', () => {
    const { game } = seeded();
    game.getProgressLevel();                                  // consultar o nível de progresso só registra o recorde
    const before = JSON.stringify(game.gameState);
    const clockBefore = game.now();
    const events = [];
    game.bus.on('*', (e) => events.push(e.type));
    const a = game.estimateRoute('kanto_route1');
    assert.equal(a.source, 'estimated');
    assert.equal(a.routeId, 'kanto_route1');
    assert.ok(a.rates.battlesPerHour > 100 && a.rates.xpPerHour > 0);
    assert.ok(Math.abs(a.simulatedMs - 30 * MIN) < 2000);
    assert.equal(JSON.stringify(game.gameState), before, 'estado real intacto');
    assert.equal(game.now(), clockBefore);
    assert.deepEqual(events, [], 'nenhum evento no barramento real');
    assert.equal(game.getHuntSession(), null);
    assert.equal(game.battleTimer, null);
    const fresh = seeded().game.estimateRoute('kanto_route1');
    assert.deepEqual(plain(fresh.rates), plain(a.rates), 'mesmo estado → mesma estimativa');
});

test('estimativa tem cache e invalida quando equipe/upgrade/política mudam (não a cada pequeno nível)', () => {
    const { game } = seeded();
    const first = game.estimateRoute('kanto_route1');
    assert.equal(game.estimateRoute('kanto_route1'), first, 'mesmo objeto = veio do cache');
    game.roster.primaryOf(25).level += 1;                       // um nível a mais: mesma faixa de 5%
    assert.equal(game.estimateRoute('kanto_route1'), first);
    game.roster.primaryOf(25).level = 300;                      // salto grande
    const second = game.estimateRoute('kanto_route1');
    assert.notEqual(second, first);
    game.gameState.upgrades = { hunt_xp: 3 }; game._invalidateModifiers();
    assert.notEqual(game.estimateRoute('kanto_route1'), second);
});

test('rotas inválidas ou bloqueadas não são estimadas', () => {
    const { game, ctx } = seeded();
    assert.equal(game.estimateRoute('nao_existe'), null);
    assert.equal(game.estimateRoute(ctx.REGIONS.johto.routes[0].id), null);
    assert.equal(game.getRouteMetrics('nao_existe'), null);
});

test('real × estimado: real só com amostra mínima; sem amostra usa estimativa ou fica pendente', () => {
    const { game } = seeded();
    setAgg(game, 'kanto_route1', { ms: 5 * MIN });                  // curto demais
    assert.equal(game.getRouteMetrics('kanto_route1', false), null);
    assert.equal(game.getRouteMetrics('kanto_route1', true).source, 'estimated');
    setAgg(game, 'kanto_route1', { ms: 30 * MIN, xp: 5000 });
    const m = game.getRouteMetrics('kanto_route1', false);
    assert.equal(m.source, 'real');
    assert.equal(m.rates.xpPerHour, 10000);
});

test('comparação sem estimar: linhas pendentes aparecem marcadas (a interface estima em fatias)', () => {
    const { game } = seeded();
    const cmp = game.compareRoutes({ estimate: false, routeIds: ids });
    assert.equal(cmp.rows.length, 3);
    assert.ok(cmp.rows.every(r => r.pending && r.rates === null && r.source === null));
    assert.equal(cmp.pendingCount, 3);
    setAgg(game, 'kanto_route2', { ms: 20 * MIN });
    const c2 = game.compareRoutes({ estimate: false, routeIds: ids });
    assert.equal(c2.pendingCount, 2);
    assert.equal(c2.rows.find(r => r.routeId === 'kanto_route2').source, 'real');
});

test('melhor XP / dinheiro / captura em rotas diferentes (exemplo da especificação)', () => {
    const { game } = seeded();
    game.gameState.currentRoute = 'kanto_route1';
    setAgg(game, 'kanto_route1', { xp: 1100, money: 850, captures: 9 });
    setAgg(game, 'kanto_route2', { xp: 1750, money: 620, captures: 5 });
    setAgg(game, 'kanto_route3', { xp: 1300, money: 1450, captures: 6 });
    const cmp = game.compareRoutes({ estimate: false, routeIds: ids });
    assert.equal(cmp.best.xp.routeId, 'kanto_route2');
    assert.equal(cmp.best.money.routeId, 'kanto_route3');
    assert.equal(cmp.best.captures.routeId, 'kanto_route1');
    assert.equal(cmp.rows.find(r => r.routeId === 'kanto_route2').rates.xpPerHour, 1750);
    assert.equal(cmp.rows.find(r => r.routeId === 'kanto_route3').rates.moneyPerHour, 1450);
});

test('recomendação depende do objetivo e traz o ganho em % com a fonte (real/estimado)', () => {
    const { game } = seeded();
    game.gameState.currentRoute = 'kanto_route1';
    setAgg(game, 'kanto_route1', { xp: 1100, money: 850, captures: 9 });
    setAgg(game, 'kanto_route2', { xp: 1300, money: 620, captures: 5 });
    setAgg(game, 'kanto_route3', { xp: 1100, money: 1450, captures: 6 });
    const cmp = game.compareRoutes({ estimate: false, routeIds: ids });
    const xp = game.recommendRouteForGoal('xp', cmp);
    assert.deepEqual(plain({ id: xp.routeId, gain: xp.gainPct, src: xp.source }), { id: 'kanto_route2', gain: 18, src: 'real' });
    assert.equal(xp.text, '+18% de XP/h real em relação à rota atual.');
    const money = game.recommendRouteForGoal('money', cmp);
    assert.equal(money.routeId, 'kanto_route3');
    assert.equal(money.gainPct, 71);
    assert.match(money.text, /lucro\/h/);
    const caps = game.recommendRouteForGoal('captures', cmp);
    assert.equal(caps.none, true, 'a rota atual já é a melhor em capturas');
    assert.match(caps.text, /já é a melhor/);
});

test('recomendação só informa: nunca troca a rota nem mexe no estado', () => {
    const { game } = seeded();
    setAgg(game, 'kanto_route1', { xp: 100 });
    setAgg(game, 'kanto_route2', { xp: 900 });
    const before = JSON.stringify([game.gameState.currentRoute, game.gameState.automation]);
    const cmp = game.compareRoutes({ estimate: false, routeIds: ids });
    const rec = game.recommendRouteForGoal('xp', cmp);
    assert.equal(rec.routeId, 'kanto_route2');
    game.noteRouteRecommended(rec);
    assert.equal(game.gameState.currentRoute, 'kanto_route1');
    assert.equal(JSON.stringify([game.gameState.currentRoute, game.gameState.automation]), before);
});

test('ganho pequeno (< mínimo) não recomenda trocar; sem dados não recomenda nada', () => {
    const { game } = seeded();
    setAgg(game, 'kanto_route1', { xp: 1000 });
    setAgg(game, 'kanto_route2', { xp: 1030 });
    const cmp = game.compareRoutes({ estimate: false, routeIds: ids });
    assert.equal(game.recommendRouteForGoal('xp', cmp).none, true);
    const empty = game.compareRoutes({ estimate: false, routeIds: ['kanto_route3'] });
    const r = game.recommendRouteForGoal('xp', empty);
    assert.equal(r.none, true);
    assert.match(r.text, /não há dados/);
});

test('rota difícil que destrói a economia: dinheiro usa o LUCRO (descontando poções) e a rota ganha avisos', () => {
    const { game } = seeded();
    game.gameState.currentRoute = 'kanto_route1';
    setAgg(game, 'kanto_route1', { money: 500, potions: 2, healCost: 80 });
    setAgg(game, 'kanto_route2', { money: 3000, potions: 400, healCost: 16000, victories: 90, defeats: 10 });
    const cmp = game.compareRoutes({ estimate: false, routeIds: ids.slice(0, 2) });
    const hard = cmp.rows.find(r => r.routeId === 'kanto_route2');
    assert.ok(hard.rates.moneyPerHour > 2000 && hard.rates.profitPerHour < 0);
    assert.ok(hard.warnings.some(w => w.code === 'potion_burn'));
    assert.equal(cmp.best.money.routeId, 'kanto_route1', 'o dinheiro "bruto" maior não vence quando o lucro é negativo');
    assert.equal(game.recommendRouteForGoal('money', cmp).none, true);
});

test('rotas com vitória baixa não viram "melhor" mesmo rendendo mais XP', () => {
    const { game } = seeded();
    setAgg(game, 'kanto_route1', { xp: 1000 });
    setAgg(game, 'kanto_route2', { xp: 99999, victories: 10, defeats: 90 });
    const cmp = game.compareRoutes({ estimate: false, routeIds: ids.slice(0, 2) });
    assert.equal(cmp.best.xp.routeId, 'kanto_route1');
    assert.ok(cmp.rows[1].warnings.some(w => w.code === 'low_win_rate'));
});

test('objetivo Shiny usa a chance esperada (batalhas/h × taxa), não o acaso das amostras', () => {
    const { game } = seeded();
    setAgg(game, 'kanto_route1', { battles: 100, shinies: 1 });
    setAgg(game, 'kanto_route2', { battles: 300, shinies: 0 });
    const cmp = game.compareRoutes({ estimate: false, routeIds: ids.slice(0, 2) });
    assert.equal(cmp.best.shiny.routeId, 'kanto_route2');
});

test('candidatos: rota atual + poucas rotas na faixa de nível, limite configurável, só desbloqueadas', () => {
    const { game, ctx } = seeded();
    const c = game.getCandidateRoutes();
    assert.equal(c[0], game.gameState.currentRoute);
    assert.ok(c.length <= ctx.ECONOMY_CONFIG.compare.maxCandidates);
    assert.equal(new Set(c).size, c.length);
    for (const id of c) assert.ok(game._checkRouteAccess(id).ok);
    game.econCfg = { ...ctx.ECONOMY_CONFIG, compare: { ...ctx.ECONOMY_CONFIG.compare, maxCandidates: 3 } };
    assert.equal(game.getCandidateRoutes().length, 3);
});

test('comparação completa de 8 candidatas termina em poucos segundos e marca todas como estimadas', () => {
    const { game } = seeded();
    const t0 = Date.now();
    const cmp = game.compareRoutes();
    assert.ok(Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
    assert.ok(cmp.rows.length >= 2);
    assert.ok(cmp.rows.every(r => r.source === 'estimated' && r.rates));
    const again = Date.now();
    game.compareRoutes();
    assert.ok(Date.now() - again < 100, 'segunda vez vem do cache');
    const rec = game.recommendRouteForGoal('xp', cmp);
    assert.ok(rec.none || (rec.routeId && /estimado/.test(rec.text)));
});

test('eventos route_recommended (limitado) e route_selected (com origem)', () => {
    const { game, ctx } = seeded();
    const clock = new ctx.ManualClock(1_000_000);
    game.clock = clock;
    const rec = { routeId: 'kanto_route2', goal: 'xp', gainPct: 20, source: 'estimated' };
    const seen = [];
    game.bus.on('*', (e) => { if (e.type.startsWith('route_')) seen.push(e); });
    assert.equal(game.noteRouteRecommended(rec), true);
    assert.equal(game.noteRouteRecommended(rec), false, 'mesma recomendação em seguida não repete');
    assert.equal(game.noteRouteRecommended({ none: true }), false);
    clock.advance(6 * MIN);
    assert.equal(game.noteRouteRecommended(rec), true);
    assert.equal(game.selectHuntRoute('kanto_route2', 'recommended').ok, true);
    assert.equal(game.selectHuntRoute('kanto_route2', 'recommended').unchanged, true);
    assert.equal(game.selectHuntRoute('nao_existe').ok, false);
    const types = seen.map(e => e.type);
    assert.equal(types.filter(t => t === 'route_recommended').length, 2);
    assert.equal(types.filter(t => t === 'route_selected').length, 1, 'só quando a rota realmente mudou');
    assert.equal(seen.find(e => e.type === 'route_selected').source, 'recommended');
});
