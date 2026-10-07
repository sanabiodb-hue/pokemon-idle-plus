'use strict';
// Fase 6 · F6.6: simulador econômico (jogador-robô, perfis, builds, horizontes)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { plain } = require('./helpers/game');
const sim = require('../tools/simulate-economy');

const MIN = 60000, HOUR = 3600000;
const SHORT = [['10 min', 10 * MIN], ['1 h', HOUR], ['4 h', 4 * HOUR]];

test('perfis iniciais: novo, intermediário e avançado nascem com equipe, regiões, upgrades e dinheiro coerentes', () => {
    const n = sim.createPlayer('new', 'none');
    assert.equal(n.game.getMoney(), 0);
    assert.equal(n.game.getPotions(), 10);
    assert.deepEqual(plain(n.game.gameState.upgrades), {});
    assert.equal(n.game.isRegionUnlocked('johto'), false);
    const i = sim.createPlayer('intermediate', 'xp');
    assert.equal(i.game.isRegionUnlocked('johto'), true);
    assert.equal(i.game.isRegionUnlocked('hoenn'), false);
    assert.equal(i.game.getMoney(), 20000);
    assert.equal(i.game.gameState.party.length, 5);
    assert.equal(i.game.getUpgradeLevel('hunt_xp'), 2);
    assert.equal(i.game.isGoldUnlocked(), true);
    const a = sim.createPlayer('advanced', 'money');
    assert.equal(a.game.isRegionUnlocked('sinnoh'), true);
    assert.ok(a.game.getProgressLevel() >= 900);
    assert.ok(a.game.getPotionPrice() > n.game.getPotionPrice());
    assert.equal(a.game.getUpgradeLevel('hunt_profit'), 4);
});

test('jogador-robô: determinístico (mesma semente = mesmos números) e só usa a API do núcleo', () => {
    const run = () => sim.runPlayer('new', 'xp', { horizons: SHORT, seed: 5 });
    const a = run(), b = run();
    assert.deepEqual(plain(a.snapshots), plain(b.snapshots));
    assert.deepEqual(plain(a.log), plain(b.log));
    const c = sim.runPlayer('new', 'xp', { horizons: SHORT, seed: 6 });
    assert.notDeepEqual(plain(a.snapshots), plain(c.snapshots));
});

test('instantâneos: acumulados nunca diminuem, saldo nunca negativo, ganho − gasto = saldo, tempos em ordem', () => {
    for (const build of ['none', 'xp', 'money', 'speed']) {
        const r = sim.runPlayer('new', build, { horizons: SHORT, seed: 7 });
        assert.equal(r.snapshots.length, SHORT.length);
        let prev = null;
        for (const sn of r.snapshots) {
            assert.ok(sn.moneyNow >= 0);
            assert.equal(sn.moneyEarned - sn.moneySpent, sn.moneyNow, `${build} ${sn.label}`);
            assert.ok(sn.xp >= 0 && sn.potionPrice >= 40);
            if (prev) for (const k of ['moneyEarned', 'moneySpent', 'xp', 'potionsUsed', 'potionsBought', 'upgrades', 'battles']) assert.ok(sn[k] >= prev[k], `${build} ${k}`);
            prev = sn;
        }
        const l = r.log;
        if (l.firstPurchaseMs !== null && l.secondUpgradeMs !== null) assert.ok(l.secondUpgradeMs >= l.firstPurchaseMs);
        assert.equal(l.upgradeSpend + l.potionSpend, r.snapshots.at(-1).moneySpent, 'tudo que foi gasto tem origem (poção ou upgrade)');
    }
});

test('build "sem upgrades" nunca compra upgrade; as outras compram só a cadeia do alvo (e apoio quando o alvo enche)', () => {
    const none = sim.runPlayer('new', 'none', { horizons: SHORT, seed: 8 });
    assert.equal(none.log.upgradesBought, 0);
    assert.deepEqual(plain(none.snapshots.at(-1).levels), {});
    const speed = sim.runPlayer('new', 'speed', { horizons: SHORT, seed: 8 });
    const lv = speed.snapshots.at(-1).levels;
    assert.ok(Object.keys(lv).every(id => ['heal_efficiency', 'hunt_speed', 'potion_capacity'].includes(id)), JSON.stringify(lv));
    const xp = sim.runPlayer('new', 'xp', { horizons: SHORT, seed: 8 });
    assert.ok(Object.keys(xp.snapshots.at(-1).levels).every(id => ['potion_capacity', 'hunt_xp', 'heal_efficiency'].includes(id)));
});

test('desbloqueios medidos: raízes desbloqueadas desde o início; alvo desbloqueia ao cumprir requisitos', () => {
    const r = sim.runPlayer('new', 'money', { horizons: SHORT, seed: 9 });
    assert.equal(r.log.unlockMs.heal_efficiency, 0);
    assert.equal(r.log.unlockMs.potion_capacity, 0);
    if (r.log.unlockMs.hunt_profit !== undefined) assert.ok(r.log.unlockMs.hunt_profit >= 0);
});

test('comparação de builds: tabela por horizonte, vencedores e cruzamento com "sem upgrades"', () => {
    const cmp = sim.compareBuilds('new', { horizons: SHORT, seed: 10 });
    assert.deepEqual(Object.keys(cmp.runs), ['none', 'xp', 'money', 'speed']);
    assert.equal(cmp.winners.length, SHORT.length);
    for (const w of cmp.winners) {
        assert.ok(['none', 'xp', 'money', 'speed'].includes(w.xp.build));
        assert.ok(['none', 'xp', 'money', 'speed'].includes(w.moneyEarned.build));
    }
    for (const b of ['xp', 'money', 'speed']) assert.ok(b in cmp.crossings);
    const top = cmp.winners.at(-1);
    for (const b of Object.keys(cmp.runs)) assert.ok(cmp.runs[b].snapshots.at(-1).xp <= top.xp.value);
});

test('"depois de 24 horas, onde está quem começou do zero?": 24 h de um jogador novo fecham com números completos', () => {
    const r = sim.runPlayer('new', 'none', { horizons: [['24 h', 24 * HOUR]], seed: 11 });
    const sn = r.snapshots[0];
    for (const k of ['moneyEarned', 'moneyNow', 'xp', 'captures', 'potionsUsed', 'potionsBought', 'upgrades', 'route', 'effectivePotionCost', 'potionPrice']) assert.ok(k in sn, k);
    assert.ok(sn.xp > 0 && sn.moneyEarned > 0 && sn.battles > 1000);
});

test('o simulador econômico termina rápido: 4 builds × 4 h de um jogador novo em segundos', () => {
    const t0 = Date.now();
    sim.compareBuilds('new', { horizons: SHORT, seed: 12 });
    assert.ok(Date.now() - t0 < 20000, `${Date.now() - t0} ms`);
});

test('o robô não escreve dinheiro à mão: a única atribuição a gold no simulador é a preparação do perfil', () => {
    const text = fs.readFileSync(path.resolve(__dirname, '..', 'tools', 'simulate-economy.js'), 'utf8');
    const lines = text.split('\n').filter(l => /\.gold\s*(\+|-)?=(?!=)/.test(l));
    assert.equal(lines.length, 1);
    assert.match(lines[0], /gameState\.gold = 0/);
});

test('upgrades de perfil avançado/intermediário já valem nos números (modificadores ativos)', () => {
    const a = sim.createPlayer('advanced', 'none');
    assert.ok(a.game.getModifier('exp').mult > 1.2);
    assert.ok(a.game.getPotionCapacity() > 30);
    const n = sim.createPlayer('new', 'none');
    assert.equal(n.game.getModifier('exp').mult, 1);
});
