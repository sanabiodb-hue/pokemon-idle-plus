'use strict';
// Fase 6 · F6.3: engine de upgrades + registro de modificadores
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, plain, ivs } = require('./helpers/game');
const { createSimGame } = require('../tools/automation-sim');

const HOUR = 3600000;
const setLv = (game, id, level) => { game.gameState.upgrades = { ...(game.gameState.upgrades || {}), [id]: level }; game._invalidateModifiers(); };
const rich = (game, n = 1e9) => game.earnMoney(n, 'reward');

test('catálogo: exatamente os 5 upgrades aprovados, com build e requisitos', () => {
    const { game } = newGame();
    const cat = game.getUpgradeCatalog();
    assert.deepEqual(plain(cat.map(u => u.id)), ['heal_efficiency', 'potion_capacity', 'hunt_speed', 'hunt_xp', 'hunt_profit']);
    assert.deepEqual(plain(cat.map(u => u.build)), ['support', 'support', 'speed', 'xp', 'money']);
    for (const u of cat) {
        assert.equal(u.level, 0);
        assert.ok(u.name && u.description && u.maxLevel >= 10 && u.cost > 0 && u.effectNext);
    }
    const by = Object.fromEntries(cat.map(u => [u.id, u]));
    assert.equal(by.heal_efficiency.locked, false);
    assert.equal(by.potion_capacity.locked, false);
    assert.equal(by.hunt_speed.locked, true);
    assert.deepEqual(plain(by.hunt_speed.missing.map(m => [m.id, m.level, m.have])), [['heal_efficiency', 2, 0]]);
    assert.equal(by.hunt_profit.missing.length, 2);
    assert.match(by.hunt_xp.effectNext, /\+5% de EXP/);
});

test('custo crescente: segue a fórmula base × growth^nível × escala de progresso, sem nunca diminuir', () => {
    const { game, ctx } = newGame();
    const def = ctx.ECONOMY_CONFIG.upgrades.hunt_xp;
    setLv(game, 'potion_capacity', 2);
    let last = 0;
    for (let lv = 0; lv < def.maxLevel; lv++) {
        setLv(game, 'hunt_xp', lv);
        const cost = game.getUpgradeCost('hunt_xp');
        assert.equal(cost, Math.ceil(def.cost.base * Math.pow(def.cost.growth, lv)));
        assert.ok(cost > last);
        last = cost;
    }
    setLv(game, 'hunt_xp', def.maxLevel);
    assert.equal(game.getUpgradeCost('hunt_xp'), null);
});

test('escala de progresso: o mesmo upgrade custa mais quando o jogador está mais avançado', () => {
    const { game } = newGame();
    const c5 = game.getUpgradeCost('heal_efficiency');
    game.roster.primaryOf(25).level = 10000;
    const c10k = game.getUpgradeCost('heal_efficiency');
    assert.equal(c5, 150);
    assert.equal(c10k, 150 * 50);
});

test('comprar: gasta o custo, sobe 1 nível, registra razão e emite upgrade_purchased + money_spent', () => {
    const { game } = newGame();
    rich(game, 1000);
    const seen = [];
    game.bus.on('*', (e) => { if (['upgrade_purchased', 'money_spent'].includes(e.type)) seen.push(e); });
    const r = game.buyUpgrade('heal_efficiency');
    assert.deepEqual(plain(r), { ok: true, id: 'heal_efficiency', level: 1, cost: 150 });
    assert.equal(game.getUpgradeLevel('heal_efficiency'), 1);
    assert.equal(game.getMoney(), 850);
    assert.equal(game.gameState.economy.byReason.upgrade_purchase.spent, 150);
    assert.deepEqual(plain(seen.map(e => [e.type, e.reason || e.id])), [['money_spent', 'upgrade_purchase'], ['upgrade_purchased', 'heal_efficiency']]);
    assert.equal(seen[0].upgrade, 'heal_efficiency');
});

test('requisitos: bloqueado não compra e não gasta; ao cumprir, desbloqueia', () => {
    const { game } = newGame();
    rich(game);
    const before = game.getMoney();
    assert.equal(game.buyUpgrade('hunt_speed').code, 'locked');
    assert.equal(game.getMoney(), before);
    assert.equal(game.getUpgradeLevel('hunt_speed'), 0);
    game.buyUpgrade('heal_efficiency');
    assert.equal(game.buyUpgrade('hunt_speed').code, 'locked', 'ainda falta nível 2');
    game.buyUpgrade('heal_efficiency');
    assert.equal(game.buyUpgrade('hunt_speed').ok, true);
    assert.equal(game.buyUpgrade('hunt_profit').code, 'locked', 'lucro pede também capacidade 2');
    game.buyUpgrade('potion_capacity'); game.buyUpgrade('potion_capacity');
    assert.equal(game.buyUpgrade('hunt_profit').ok, true);
    assert.equal(game.buyUpgrade('hunt_xp').ok, true);
});

test('nível máximo, dinheiro insuficiente, id inválido e offline: nada muda', () => {
    const { game } = newGame();
    const snap = () => JSON.stringify([game.getMoney(), game.gameState.upgrades, game.gameState.economy]);
    assert.equal(game.buyUpgrade('heal_efficiency').code, 'insufficient_funds');
    for (const bad of ['__proto__', 'constructor', 'x', undefined, null, 5]) assert.equal(game.buyUpgrade(bad).code, 'unknown_upgrade', String(bad));
    rich(game, 1e9);
    setLv(game, 'heal_efficiency', 10);
    const s0 = snap();
    assert.equal(game.buyUpgrade('heal_efficiency').code, 'max_level');
    game._isOfflineSimulating = true;
    assert.equal(game.buyUpgrade('potion_capacity').code, 'busy');
    game._isOfflineSimulating = false;
    assert.equal(snap(), s0);
    const poor = newGame().game;
    poor.earnMoney(149, 'reward');
    const s1 = JSON.stringify([poor.getMoney(), poor.gameState.upgrades]);
    assert.equal(poor.buyUpgrade('heal_efficiency').code, 'insufficient_funds');
    assert.equal(JSON.stringify([poor.getMoney(), poor.gameState.upgrades]), s1);
});

test('invariante: nível só sobe com pagamento — soma dos custos = gasto registrado, níveis = compras ok', () => {
    const { game } = newGame({ seed: 5 });
    let rngState = 12345;
    const rnd = () => (rngState = (rngState * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const ids = ['heal_efficiency', 'potion_capacity', 'hunt_speed', 'hunt_xp', 'hunt_profit', 'bogus'];
    let paid = 0, bought = 0;
    for (let i = 0; i < 400; i++) {
        if (rnd() < 0.3) game.earnMoney(Math.floor(rnd() * 3000) + 1, 'reward');
        const id = ids[Math.floor(rnd() * ids.length)];
        const m0 = game.getMoney();
        const r = game.buyUpgrade(id);
        if (r.ok) { paid += r.cost; bought++; assert.equal(m0 - game.getMoney(), r.cost); } else assert.equal(game.getMoney(), m0);
        assert.ok(game.getMoney() >= 0);
    }
    const levels = Object.values(game.gameState.upgrades || {}).reduce((a, b) => a + b, 0);
    assert.equal(levels, bought);
    assert.equal((game.gameState.economy.byReason.upgrade_purchase || { spent: 0 }).spent, paid);
    assert.equal(game.gameState.gold, game.gameState.economy.earned - game.gameState.economy.spent);
});

test('compra reentrante (de dentro do evento) paga cada nível separadamente', () => {
    const { game } = newGame();
    rich(game, 100000);
    let again = 0;
    game.bus.on('upgrade_purchased', () => { if (again++ < 2) game.buyUpgrade('potion_capacity'); });
    const m0 = game.getMoney();
    game.buyUpgrade('potion_capacity');
    const level = game.getUpgradeLevel('potion_capacity');
    assert.equal(level, 3);
    const expected = [0, 1, 2].reduce((a, n) => a + Math.ceil(120 * Math.pow(1.4, n)), 0);
    assert.equal(m0 - game.getMoney(), expected);
});

test('modificadores: registro único, valores por upgrade e padrão neutro', () => {
    const { game } = newGame();
    for (const stat of ['exp', 'gold', 'battle_delay', 'potion_heal', 'potion_cap']) assert.deepEqual(plain(game.getModifier(stat)), { mult: 1, add: 0 }, stat);
    assert.deepEqual(plain(game.getModifier('desconhecido')), { mult: 1, add: 0 });
    setLv(game, 'hunt_xp', 10);
    setLv(game, 'hunt_profit', 4);
    setLv(game, 'hunt_speed', 5);
    setLv(game, 'heal_efficiency', 5);
    setLv(game, 'potion_capacity', 3);
    assert.ok(Math.abs(game.getModifier('exp').mult - 1.5) < 1e-9);
    assert.ok(Math.abs(game.getModifier('gold').mult - 1.2) < 1e-9);
    assert.ok(Math.abs(game.getModifier('battle_delay').mult - 0.8) < 1e-9);
    assert.ok(Math.abs(game.getModifier('potion_heal').mult - 1.4) < 1e-9);
    assert.equal(game.getModifier('potion_cap').add, 18);
    setLv(game, 'hunt_speed', 15);
    assert.ok(Math.abs(game.getModifier('battle_delay').mult - 0.4) < 1e-9, 'piso do intervalo');
});

test('efeitos reais no núcleo: EXP, moedas, intervalo, cura da poção e capacidade', () => {
    const base = newGame({ seed: 7 });
    const up = newGame({ seed: 7 });
    setLv(up.game, 'hunt_xp', 10);
    setLv(up.game, 'hunt_profit', 10);
    setLv(up.game, 'hunt_speed', 10);
    setLv(up.game, 'heal_efficiency', 5);
    setLv(up.game, 'potion_capacity', 5);
    const win = (g) => g._processVictoryRewards(Object.assign(g.createWildPokemon(19, 40, 0), { isShiny: false }), 25, 100, 100);
    const a = win(base.game), b = win(up.game);
    assert.equal(b.expGained, Math.floor(a.expGained * 1.5));
    assert.equal(b.goldGained, Math.floor(a.goldGained * 1.5));
    assert.equal(up.game._getNextBattleDelay(2000), 800 * 0.6);
    assert.equal(base.game._getNextBattleDelay(2000), 800);
    assert.equal(up.game._getNextBattleDelay(300), 300 * 0.6);
    assert.equal(base.game.getPotionCapacity(), 30);
    assert.equal(up.game.getPotionCapacity(), 60);
    assert.ok(Math.abs(up.game.getPotionHealPercent() - 0.7) < 1e-9);
    for (const g of [base.game, up.game]) { g.startBattle(); g.stopBattle(); g.currentBattle.playerCurrentHp = 1; }
    const hb = base.game.usePotion().amount, hu = up.game.usePotion().amount;
    assert.equal(hb, Math.ceil(base.game.currentBattle.playerMaxHp * 0.5));
    assert.ok(hu > hb);
    assert.equal(up.game.getPotionHealPercent() <= 1, true);
    setLv(up.game, 'heal_efficiency', 10);
    assert.equal(up.game.getPotionHealPercent(), 0.9);
});

test('Live e Fast usam os mesmos modificadores: mesmo XP/moedas por vitória com upgrades', () => {
    const N = 20;
    const mk = (policy) => {
        const x = createSimGame({ seed: 41, policy, starterLevel: 25, shinyRate: 0 });
        x.game.gameState.settings.captureDuplicates = 'off';
        const route = { id: 'kanto_route1', name: 'Mono', levelRange: [4, 4], pokemon: [{ id: 19, weight: 1, levelRange: [4, 4] }] };
        x.game.getRoute = () => route;
        setLv(x.game, 'hunt_xp', 8); setLv(x.game, 'hunt_profit', 6); setLv(x.game, 'hunt_speed', 4);
        return x;
    };
    const fast = mk({ heal: { enabled: false }, stopConditions: { battleLimit: N } });
    const live = mk({ heal: { enabled: false } });
    const rf = fast.ctx.simulateHunt(fast.game, 24 * HOUR);
    for (let i = 0; i < N; i++) live.game._processVictoryRewards(Object.assign(live.game.createWildPokemon(19, 4, 0), { isShiny: false }), 25, 100, 100);
    const sl = live.game.getHuntSession();
    assert.equal(rf.victories, N);
    assert.equal(rf.xp, sl.stats.xp);
    assert.equal(rf.money, sl.stats.money);
});

test('velocidade de caça: o driver rápido faz mais batalhas por hora com o upgrade (mesma semente)', () => {
    const run = (lv) => {
        const x = createSimGame({ seed: 11, policy: { heal: { enabled: false } }, starterLevel: 25, shinyRate: 0 });
        setLv(x.game, 'hunt_speed', lv);
        return x.ctx.simulateHunt(x.game, HOUR).battles;
    };
    const b0 = run(0), b15 = run(15);
    assert.ok(b15 > b0 * 1.1, `${b0} → ${b15}`);
});

test('eficiência de cura: menos poções gastas por hora numa rota que machuca', () => {
    const run = (lv) => {
        const x = createSimGame({ seed: 12, policy: { heal: { enabled: true, whenHpBelowPercent: 50 } }, starterLevel: 14, routeId: 'kanto_route2', potions: 99999, shinyRate: 0 });
        setLv(x.game, 'heal_efficiency', lv);
        return x.ctx.simulateHunt(x.game, HOUR);
    };
    const a = run(0), b = run(10);
    assert.ok(a.potionsUsed > 0);
    assert.ok(b.potionsUsed < a.potionsUsed, `${a.potionsUsed} → ${b.potionsUsed}`);
});

test('save/load: níveis persistem, não se duplicam e o cache de modificadores é refeito', () => {
    const a = newGame({ seed: 8 });
    rich(a.game, 100000);
    a.game.buyUpgrade('heal_efficiency'); a.game.buyUpgrade('heal_efficiency'); a.game.buyUpgrade('potion_capacity'); a.game.buyUpgrade('potion_capacity');
    a.game.buyUpgrade('hunt_xp');
    const snap = plain({ up: a.game.gameState.upgrades, gold: a.game.getMoney() });
    a.game.saveNow();
    for (let i = 0; i < 2; i++) {
        const b = newGame({ storage: a.storage, load: true });
        assert.deepEqual(plain({ up: b.game.gameState.upgrades, gold: b.game.getMoney() }), snap);
        assert.ok(Math.abs(b.game.getModifier('exp').mult - 1.05) < 1e-9);
        assert.equal(b.game.getPotionCapacity(), 42);
        b.game.saveNow();
    }
});

test('saneamento: ids desconhecidos, níveis negativos/acima do máximo e lixo são descartados', () => {
    const { ctx } = newGame();
    assert.deepEqual(plain(ctx.sanitizeUpgradesState({ heal_efficiency: 99, hunt_xp: -3, hunt_speed: 'x', hack: 5, potion_capacity: 3.9, hunt_profit: '7' })), { heal_efficiency: 10, potion_capacity: 3, hunt_profit: 7 });
    assert.deepEqual(plain(ctx.sanitizeUpgradesState(null)), {});
    assert.deepEqual(plain(ctx.sanitizeUpgradesState([1, 2])), {});
});

test('sem "if upgrade X" espalhado: o núcleo só consulta modificadores, não ids de upgrade', () => {
    const root = path.resolve(__dirname, '..', 'js');
    const ids = ['heal_efficiency', 'potion_capacity', 'hunt_speed', 'hunt_xp', 'hunt_profit'];
    const allowed = new Set(['config.js', 'upgrades.js', 'hunt-view.js', 'economy-view.js', 'analyzer.js']);
    const offenders = [];
    const walk = (dir) => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, f.name);
            if (f.isDirectory()) { walk(p); continue; }
            if (!f.name.endsWith('.js') || allowed.has(f.name) || /pokemon-data|route-data/.test(f.name)) continue;
            const text = fs.readFileSync(p, 'utf8');
            for (const id of ids) if (text.includes(id) || text.includes('getUpgradeLevel(')) offenders.push(`${f.name}: ${id}`);
        }
    };
    walk(root);
    assert.deepEqual([...new Set(offenders)].filter(x => !x.startsWith('lzstring')), []);
});
