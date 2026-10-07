'use strict';
// Fase 6 · F6.1: economia central (earnMoney / spendMoney / razões / eventos / save / offline)
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, plain, runOffline } = require('./helpers/game');

const win = (game, id = 19, level = 4) => game._processVictoryRewards(game.createWildPokemon(id, level, 0), 25, 100, 100);
const conserve = (game) => assert.equal(game.gameState.gold, game.gameState.economy.earned - game.gameState.economy.spent, 'saldo = ganho − gasto');

test('dinheiro desde o início: vitória no jogo novo rende moedas; lojas antigas continuam bloqueadas', () => {
    const { game } = newGame({ seed: 1 });
    assert.equal(game.getMoney(), 0);
    assert.equal(game.isGoldUnlocked(), false, 'a regra antiga de desbloqueio não mudou');
    assert.equal(game.isMoneyEarningEnabled(), true);
    const r = win(game);
    assert.ok(r.goldGained >= 1);
    assert.equal(game.getMoney(), r.goldGained);
    assert.equal(game.gameState.stats.totalGold, r.goldGained);
    assert.equal(game.buyGem().success, false, 'gemas seguem bloqueadas até a insígnia');
    assert.match(game.buyGem().message, /bloqueado/);
    conserve(game);
});

test('com earnFromStart desligado o comportamento antigo volta (sem insígnia, sem moeda)', () => {
    const { game, ctx } = newGame({ seed: 2 });
    game.econCfg = { ...ctx.ECONOMY_CONFIG, earnFromStart: false };
    assert.equal(win(game).goldGained, 0);
    game.gameState.badges.kanto = { unlocked: true };
    assert.ok(win(game).goldGained > 0);
});

test('earnMoney: valida valor e origem; não cria dinheiro por entrada inválida', () => {
    const { game } = newGame();
    const before = JSON.stringify([game.gameState.gold, game.gameState.economy, game.gameState.stats.totalGold]);
    for (const bad of [0, -5, 1.5, NaN, Infinity, '10', null, undefined, {}]) assert.equal(game.earnMoney(bad, 'battle').code, 'invalid_amount', String(bad));
    for (const bad of [undefined, null, '', 'hack', 'potion_purchase', 7]) assert.equal(game.earnMoney(10, bad).code, 'invalid_reason', String(bad));
    assert.equal(JSON.stringify([game.gameState.gold, game.gameState.economy, game.gameState.stats.totalGold]), before);
    assert.equal(game.earnMoney(10, 'battle').ok, true);
    assert.equal(game.getMoney(), 10);
});

test('spendMoney: saldo nunca fica negativo; falha não altera nada nem emite evento', () => {
    const { game } = newGame();
    game.earnMoney(100, 'reward');
    const seen = [];
    game.bus.on('money_spent', (e) => seen.push(e));
    const before = JSON.stringify(game.gameState.economy);
    const r = game.spendMoney(101, 'potion_purchase');
    assert.deepEqual(plain({ ok: r.ok, code: r.code, need: r.need, have: r.have }), { ok: false, code: 'insufficient_funds', need: 101, have: 100 });
    assert.equal(game.getMoney(), 100);
    assert.equal(JSON.stringify(game.gameState.economy), before);
    assert.equal(seen.length, 0);
    for (const bad of [0, -1, 2.5, NaN]) assert.equal(game.spendMoney(bad, 'potion_purchase').code, 'invalid_amount');
    assert.equal(game.spendMoney(10, 'battle').code, 'invalid_reason', 'razão de ganho não serve para gasto');
    assert.equal(game.spendMoney(100, 'potion_purchase').ok, true);
    assert.equal(game.getMoney(), 0);
    assert.equal(game.spendMoney(1, 'potion_purchase').ok, false);
    assert.equal(game.getMoney(), 0);
    conserve(game);
});

test('eventos econômicos: quantidade, razão, saldo, carimbo de tempo e sessão (quando há caçada)', () => {
    const { game, ctx } = newGame({ seed: 3 });
    const clock = new ctx.ManualClock(5_000_000);
    game.clock = clock;
    const seen = [];
    game.bus.on('*', (e) => { if (e.type.startsWith('money_')) seen.push(e); });
    game.earnMoney(50, 'reward');
    const { seq, ...first } = plain(seen[0]);
    assert.ok(seq > 0);
    assert.deepEqual(first, { type: 'money_earned', t: 5_000_000, amount: 50, reason: 'reward', balance: 50, sessionId: null });
    game.dispatchAutomationAction({ type: 'START_HUNT' });
    game.stopBattle();
    const sid = game.getHuntSession().id;
    clock.advance(1000);
    win(game);
    const battle = seen.find(e => e.reason === 'battle');
    assert.equal(battle.sessionId, sid);
    assert.equal(battle.t, 5_001_000);
    game.spendMoney(5, 'potion_purchase');
    const spent = seen.at(-1);
    assert.deepEqual(plain({ type: spent.type, amount: spent.amount, reason: spent.reason, sessionId: spent.sessionId }), { type: 'money_spent', amount: 5, reason: 'potion_purchase', sessionId: sid });
    game.dispatchAutomationAction({ type: 'STOP_HUNT' });
    game.earnMoney(1, 'reward');
    assert.equal(seen.at(-1).sessionId, null);
});

test('toda movimentação tem origem: razões conhecidas, contabilidade por razão e conservação', () => {
    const { game, ctx } = newGame({ seed: 4 });
    for (let i = 0; i < 20; i++) win(game);
    game.earnMoney(500, 'reward');
    game.spendMoney(120, 'potion_purchase');
    game.spendMoney(30, 'upgrade_purchase');
    const eco = game.gameState.economy;
    const known = ctx.ECONOMY_CONFIG.reasons.earn.concat(ctx.ECONOMY_CONFIG.reasons.spend);
    for (const k of Object.keys(eco.byReason)) assert.ok(known.includes(k), k);
    assert.equal(eco.byReason.reward.earned, 500);
    assert.equal(eco.byReason.potion_purchase.spent, 120);
    assert.equal(eco.earned, Object.values(eco.byReason).reduce((a, r) => a + r.earned, 0));
    assert.equal(eco.spent, Object.values(eco.byReason).reduce((a, r) => a + r.spent, 0));
    conserve(game);
    assert.equal(eco.byReason.battle.earned, game.gameState.stats.totalGold - 500);
});

test('lojas antigas passam por spendMoney (com razão) e mantêm preço e mensagens', () => {
    const { game, ctx } = newGame({ seed: 5 });
    game.gameState.badges.kanto = { unlocked: true };
    game.earnMoney(10000, 'reward');
    const r = game.buyGem();
    assert.equal(r.success, true);
    assert.equal(game.getMoney(), 9000);
    const all = game.buyAllGems();
    assert.equal(all.success, true);
    assert.equal(all.spent, 9000);
    assert.equal(game.getMoney(), 0);
    assert.equal(game.buyGem().success, false);
    assert.equal(game.gameState.economy.byReason.gem_purchase.spent, 10000);
    game.earnMoney(2000000, 'reward');
    game.isTalentUnlocked = () => true;
    assert.equal(game.resetTalents().success, true);
    assert.equal(game.gameState.economy.byReason.talent_reset.spent, 1000000);
    game.isBerryUnlocked = () => true;
    game.earnMoney(ctx.BERRY_SEED_PRICE, 'reward');
    const berryId = Object.keys(ctx.BERRY_DATA)[0];
    const beforeSeed = game.getMoney();
    assert.equal(game.plantBerry(berryId).success, true);
    assert.equal(game.getMoney(), beforeSeed - ctx.BERRY_SEED_PRICE);
    assert.equal(game.gameState.economy.byReason.berry_seed.spent, ctx.BERRY_SEED_PRICE);
    conserve(game);
});

test('save/load não duplica nem perde dinheiro; economia sobrevive; carregar duas vezes dá o mesmo', () => {
    const a = newGame({ seed: 6 });
    for (let i = 0; i < 10; i++) win(a.game);
    a.game.spendMoney(3, 'potion_purchase');
    const snap = plain({ gold: a.game.gameState.gold, eco: a.game.gameState.economy, total: a.game.gameState.stats.totalGold });
    a.game.saveNow();
    for (let i = 0; i < 2; i++) {
        const b = newGame({ storage: a.storage, load: true });
        assert.deepEqual(plain({ gold: b.game.gameState.gold, eco: b.game.gameState.economy, total: b.game.gameState.stats.totalGold }), snap);
        b.game.saveNow();
    }
});

test('saneamento do save: números inválidos e razões desconhecidas não entram', () => {
    const { ctx, game } = newGame();
    const clean = ctx.sanitizeEconomyState({ earned: -5, spent: 'x', byReason: { battle: { earned: 10, spent: -1 }, hack: { earned: 99 }, potion_purchase: 'lixo' } });
    assert.deepEqual(plain(clean), { earned: 0, spent: 0, byReason: { battle: { earned: 10, spent: 0 } } });
    assert.deepEqual(plain(ctx.sanitizeEconomyState(null)), { earned: 0, spent: 0, byReason: {} });
    const raw = JSON.parse(JSON.stringify(game.gameState));
    raw.economy = 'oops'; raw.gold = -50;
    const s = ctx.sanitizeSave(raw);
    const st = s.state || s.save || s;
    assert.equal(st.gold, 0, 'saldo negativo vira 0');
});

test('offline: o dinheiro entra pela mesma via, uma única vez, e o relatório bate com o razão', async () => {
    const a = newGame({ seed: 7 });
    const before = a.game.getMoney();
    await runOffline(a.game, 20 * 60 * 1000);
    const gained = a.game.getMoney() - before;
    assert.ok(gained > 0);
    assert.equal(a.game.lastOfflineSummary.goldGained, gained);
    assert.equal(a.game.gameState.economy.byReason.battle.earned, gained);
    conserve(a.game);
    a.game.saveNow();
    const b = newGame({ storage: a.storage, load: true });
    assert.equal(b.game.getMoney(), a.game.getMoney(), 'recarregar não repete a ausência');
    assert.equal(b.game.gameState.economy.earned, a.game.gameState.economy.earned);
});

test('estatística da caçada e razão do dinheiro batem (online, driver rápido e offline)', async () => {
    const a = newGame({ seed: 8 });
    a.game.dispatchAutomationAction({ type: 'START_HUNT' });
    a.game.stopBattle();
    for (let i = 0; i < 6; i++) win(a.game);
    await runOffline(a.game, 15 * 60 * 1000);
    const s = a.game.getHuntSession();
    assert.equal(s.stats.money, a.game.gameState.economy.byReason.battle.earned);
});

test('teto de saldo: nunca passa do máximo configurado', () => {
    const { game, ctx } = newGame();
    const max = ctx.ECONOMY_CONFIG.maxMoney;
    game.gameState.gold = max - 5;
    assert.equal(game.earnMoney(100, 'reward').amount, 5);
    assert.equal(game.getMoney(), max);
    assert.equal(game.earnMoney(1, 'reward').amount, 0);
});

test('invariante estático: só o módulo da economia altera gameState.gold', () => {
    const root = path.resolve(__dirname, '..', 'js');
    const offenders = [];
    const walk = (dir) => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, f.name);
            if (f.isDirectory()) { walk(p); continue; }
            if (!f.name.endsWith('.js') || /economy[\\/]economy\.js$/.test(p) || f.name === 'save-manager.js') continue;
            fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
                if (/\.gold\s*(\+|-|\*)?=(?!=)/.test(line) && !/^\s*(\/\/|\*)/.test(line)) offenders.push(`${f.name}:${i + 1}: ${line.trim()}`);
            });
        }
    };
    walk(root);
    assert.deepEqual(offenders, []);
});
