'use strict';
// Fase 6 · F6.8: metas de balanceamento (rodam o simulador econômico; se alguém mexer nos números e quebrar a progressão, isto avisa)
//   T1 primeira compra em até 15 min; T2 segundo upgrade em até 60 min; T3 requisitos dos 3 estilos em até 2 h
//   T4 sempre existe algo para comprar: ≤ 1,5 h entre compras nas primeiras 8 h e espera ≤ 1 h pelo upgrade mais barato disponível em 24 h
//   T5 nenhum estilo domina: o melhor em XP e o melhor em moedas são estilos diferentes; "sem upgrades" nunca vence em 24 h
//   T6 poções: custo efetivo ≤ 25% da renda do jogador novo; T7 sem explosão de custo e efeitos com teto
const test = require('node:test');
const assert = require('node:assert/strict');
const sim = require('../tools/simulate-economy');
const { newGame } = require('./helpers/game');

const HOUR = 3600000, MIN = 60000;
const H = [['1 h', HOUR], ['8 h', 8 * HOUR], ['24 h', 24 * HOUR]];
let cmp;
const compare = () => cmp || (cmp = sim.compareBuilds('new', { horizons: H, seed: 1 }));

test('T1/T2: jogador novo faz a primeira compra rápido e o segundo upgrade logo depois', { timeout: 120000 }, () => {
    const c = compare();
    for (const b of ['xp', 'money', 'speed']) {
        const l = c.runs[b].log;
        assert.ok(l.firstPurchaseMs !== null && l.firstPurchaseMs <= 15 * MIN, `${b} 1ª compra ${l.firstPurchaseMs / MIN} min`);
        assert.ok(l.secondUpgradeMs !== null && l.secondUpgradeMs <= 60 * MIN, `${b} 2º upgrade ${l.secondUpgradeMs / MIN} min`);
    }
});

test('T3: os requisitos dos três estilos são cumpridos em até 2 h', () => {
    const c = compare();
    for (const b of ['xp', 'money', 'speed']) {
        const target = sim.BUILDS[b].target;
        assert.ok(c.runs[b].log.unlockMs[target] !== undefined && c.runs[b].log.unlockMs[target] <= 2 * HOUR, `${b}: ${c.runs[b].log.unlockMs[target] / MIN} min`);
    }
});

test('T4: nas primeiras 24 h há sempre algo próximo para comprar (≤ 1,5 h entre compras nas primeiras 8 h; ≤ 1 h de espera pelo mais barato)', () => {
    const c = compare();
    for (const b of ['xp', 'money', 'speed']) {
        const times = c.runs[b].log.purchaseTimes;
        let prev = 0, early = 0;
        for (const t of times) { if (t > 8 * HOUR) break; early = Math.max(early, t - prev); prev = t; }
        assert.ok(early <= 1.5 * HOUR, `${b}: ${(early / HOUR).toFixed(1)} h nas primeiras 8 h`);
        assert.ok(c.runs[b].log.maxWaitMs <= HOUR, `${b}: espera ${(c.runs[b].log.maxWaitMs / HOUR).toFixed(1)} h pelo upgrade mais barato`);
    }
});

test('T5: nenhum estilo domina — XP e moedas têm vencedores diferentes e comprar upgrades sempre vale a pena em 24 h', () => {
    const c = compare();
    const last = c.winners.at(-1);
    assert.notEqual(last.xp.build, last.moneyEarned.build);
    assert.equal(last.xp.build, 'xp');
    assert.equal(last.moneyEarned.build, 'money');
    const none = c.runs.none.snapshots.at(-1);
    for (const b of ['xp', 'money', 'speed']) {
        const sn = c.runs[b].snapshots.at(-1);
        assert.ok(sn.xp > none.xp * 1.15 || sn.moneyEarned > none.moneyEarned * 1.15, `${b} deveria passar "sem upgrades" em pelo menos uma métrica`);
    }
    // o estilo Velocidade é um generalista: melhora XP e moedas ao mesmo tempo (sem ser o melhor em nenhuma)
    const speed = c.runs.speed.snapshots.at(-1);
    assert.ok(speed.xp > none.xp * 1.1 && speed.moneyEarned > none.moneyEarned * 1.1);
});

test('T6: poção não vira o único gasto — no jogador novo, poções ≤ 25% do que foi gasto em 24 h', () => {
    const c = compare();
    for (const b of ['xp', 'money', 'speed']) {
        const sn = c.runs[b].snapshots.at(-1);
        assert.ok(sn.potionSpend <= 0.25 * Math.max(1, sn.moneySpent) + 1000, `${b}: poções ${sn.potionSpend} de ${sn.moneySpent}`);
    }
});

test('T7: sem explosão de custo — custo do último nível ÷ do primeiro respeita o crescimento configurado e não passa de 4.000×', () => {
    const { ctx } = newGame();
    for (const def of Object.values(ctx.ECONOMY_CONFIG.upgrades)) {
        assert.ok(def.cost.growth >= 1.2 && def.cost.growth <= 1.6 && (def.cost.lateGrowth || def.cost.growth) <= 1.6, def.id);
        const early = Math.min(def.maxLevel - 1, def.cost.lateFrom ?? def.maxLevel - 1);
        const ratio = Math.pow(def.cost.growth, early) * Math.pow(def.cost.lateGrowth || def.cost.growth, def.maxLevel - 1 - early);
        assert.ok(ratio <= 4000, `${def.id}: ${Math.round(ratio)}×`);
        assert.ok(def.maxLevel >= 10 && def.maxLevel <= 20);
    }
});

test('T7: efeitos com teto — nenhum upgrade passa de +100% e o ritmo nunca fica abaixo de 70%', () => {
    const { game, ctx } = newGame();
    const defs = ctx.ECONOMY_CONFIG.upgrades;
    game.gameState.upgrades = Object.fromEntries(Object.values(defs).map(d => [d.id, d.maxLevel]));
    game._invalidateModifiers();
    assert.ok(game.getModifier('exp').mult <= 2 + 1e-9);
    assert.ok(game.getModifier('gold').mult <= 2 + 1e-9);
    assert.ok(game.getModifier('battle_tempo').mult >= 0.7 - 1e-9);
    assert.ok(game.getPotionHealPercent() <= 1);
    assert.ok(game.getPotionCapacity() <= 100);
});

test('a recomendação nunca sugere uma rota cujas poções consomem mais de metade da renda dela', () => {
    const { game } = newGame();
    const a = game.ensureAnalyzer();
    const mk = (o) => ({ ms: 3600000, battles: 100, victories: 100, defeats: 0, xp: 1000, money: 1000, captures: 5, shinies: 0, potions: 0, healCost: 0, qualitySum: 0, last: 1, ...o });
    a.routes.kanto_route1 = mk({ xp: 1000 });
    a.routes.kanto_route2 = mk({ xp: 9000, potions: 100, healCost: 800 });            // 80% da renda em poções
    a.routes.kanto_route3 = mk({ xp: 3000, potions: 20, healCost: 300 });             // 30%: aceitável
    game.getCandidateRoutes = () => ['kanto_route1', 'kanto_route2', 'kanto_route3'];
    const cmp2 = game.compareRoutes({ estimate: false });
    assert.equal(cmp2.best.xp.routeId, 'kanto_route3');
    assert.ok(cmp2.rows.find(r => r.routeId === 'kanto_route2').warnings.some(w => w.code === 'potion_heavy_cost'));
});
