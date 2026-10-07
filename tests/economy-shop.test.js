'use strict';
// Fase 6 · F6.2: loja de poções (preço progressivo, teto, compra atômica)
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, plain } = require('./helpers/game');

const setLevel = (game, lv) => { game.roster.primaryOf(25).level = lv; };

test('preço da poção cresce com o progresso (tabela inicial) e nunca fica abaixo do preço base', () => {
    const { game, ctx } = newGame();
    const cfg = ctx.ECONOMY_CONFIG.potion;
    const expected = [[5, 40], [100, 200], [1000, 630], [10000, 2000], [24500, 3130]];
    for (const [lv, price] of expected) {
        setLevel(game, lv);
        assert.equal(game.getPotionPrice(), price, `nível ${lv}`);
        assert.ok(price >= cfg.basePrice);
    }
    assert.equal(ctx.baseGoldPerWin(1), 2);
    assert.equal(ctx.baseGoldPerWin(10000), 200);
});

test('o preço só sobe: perder nível (ex.: evolução que reinicia o nível) não barateia a poção', () => {
    const { game } = newGame();
    setLevel(game, 2000);
    const high = game.getPotionPrice();
    setLevel(game, 1);
    assert.equal(game.getPotionPrice(), high);
    assert.equal(game.gameState.economy.progressLevel, 2000);
});

test('preço e níveis vêm da configuração (nada fixo no código): trocar a config muda o preço', () => {
    const { game, ctx } = newGame();
    game.econCfg = { ...ctx.ECONOMY_CONFIG, potion: { ...ctx.ECONOMY_CONFIG.potion, basePrice: 100, winsPerPotion: 1 } };
    assert.equal(game.getPotionPrice(), 100);
    assert.equal(game.getPotionCapacity(), 30);
    game.econCfg.potion.capacityBase = 12;
    assert.equal(game.getPotionCapacity(), 12);
});

test('comprar 1, 5 e 10: cobra preço × quantidade, entrega, registra razão e emite eventos', () => {
    const { game } = newGame();
    game.earnMoney(1000, 'reward');
    const seen = [];
    game.bus.on('*', (e) => { if (['money_spent', 'potion_bought'].includes(e.type)) seen.push(e); });
    const price = game.getPotionPrice();
    assert.equal(price, 40);
    let r = game.buyPotions(1);
    assert.deepEqual(plain({ ok: r.ok, qty: r.qty, total: r.total, stock: r.stock }), { ok: true, qty: 1, total: 40, stock: 11 });
    r = game.buyPotions(5);
    assert.equal(r.total, 200);
    assert.equal(game.getPotions(), 16);
    r = game.buyPotions(10);
    assert.equal(r.total, 400);
    assert.equal(game.getPotions(), 26);
    assert.equal(game.getMoney(), 1000 - 40 - 200 - 400);
    assert.equal(game.gameState.economy.byReason.potion_purchase.spent, 640);
    const bought = seen.filter(e => e.type === 'potion_bought');
    assert.deepEqual(plain(bought.map(e => [e.qty, e.unitPrice, e.total, e.stock])), [[1, 40, 40, 11], [5, 40, 200, 16], [10, 40, 400, 26]]);
    const spent = seen.filter(e => e.type === 'money_spent');
    assert.equal(spent.length, 3);
    assert.ok(spent.every(e => e.reason === 'potion_purchase' && e.item === 'potion'));
});

test('teto de estoque: começa em 30; compra além do espaço é cortada; cheio recusa', () => {
    const { game } = newGame();
    game.earnMoney(100000, 'reward');
    assert.equal(game.getPotionCapacity(), 30);
    game.gameState.inventory.potions = 28;
    game.getPotionPrice();
    const r = game.buyPotions(5);
    assert.equal(r.qty, 2);
    assert.equal(r.clamped, true);
    assert.equal(game.getPotions(), 30);
    assert.equal(r.total, 80, 'só paga o que levou');
    const before = JSON.stringify([game.getMoney(), game.gameState.economy, game.getPotions()]);
    assert.equal(game.buyPotions(1).code, 'capacity_full');
    assert.equal(JSON.stringify([game.getMoney(), game.gameState.economy, game.getPotions()]), before);
});

test('sem dinheiro: não compra nada (nem parcial) e não altera estoque, saldo ou razão', () => {
    const { game } = newGame();
    game.earnMoney(100, 'reward');
    game.getPotionPrice();                                   // consultar o preço registra o nível de progresso
    const before = JSON.stringify([game.getMoney(), game.gameState.economy, game.getPotions()]);
    const r = game.buyPotions(10);
    assert.deepEqual(plain({ ok: r.ok, code: r.code, need: r.need, have: r.have }), { ok: false, code: 'insufficient_funds', need: 400, have: 100 });
    assert.equal(JSON.stringify([game.getMoney(), game.gameState.economy, game.getPotions()]), before);
    assert.equal(game.buyPotions(2).ok, true);
    assert.equal(game.getMoney(), 20);
    assert.equal(game.buyPotions(1).ok, false);
    assert.equal(game.getMoney(), 20);
});

test('entradas inválidas: quantidade, item desconhecido, offline em andamento', () => {
    const { game } = newGame();
    game.earnMoney(100000, 'reward');
    for (const bad of [0, -1, 1.5, '5', null, undefined, NaN, 1001]) assert.equal(game.buyPotions(bad).code, 'invalid_quantity', String(bad));
    for (const bad of ['__proto__', 'constructor', 'toString', 'ball', undefined, 7]) assert.equal(game.buyShopItem(bad, 1).code, 'unknown_item', String(bad));
    game._isOfflineSimulating = true;
    assert.equal(game.buyPotions(1).code, 'busy');
    game._isOfflineSimulating = false;
    assert.equal(game.getPotions(), 10);
    assert.equal(game.getMoney(), 100000);
});

test('compra repetida/reentrante não duplica poções: estoque ganho = dinheiro gasto ÷ preço', () => {
    const { game } = newGame();
    game.earnMoney(100000, 'reward');
    const price = game.getPotionPrice();
    const m0 = game.getMoney(), p0 = game.getPotions();
    let nested = 0;
    game.bus.on('money_spent', () => { if (nested++ < 1) game.buyPotions(1); });     // alguém tenta comprar de dentro do evento
    game.buyPotions(2);
    for (let i = 0; i < 5; i++) game.buyPotions(1);
    const gained = game.getPotions() - p0;
    assert.equal(gained, (m0 - game.getMoney()) / price);
    assert.ok(game.getPotions() <= game.getPotionCapacity());
});

test('estoque e progresso persistem; recarregar não cria poções nem dinheiro', () => {
    const a = newGame({ seed: 4 });
    a.game.earnMoney(5000, 'reward');
    setLevel(a.game, 100);
    a.game.buyPotions(10);
    const snap = plain({ p: a.game.getPotions(), m: a.game.getMoney(), lv: a.game.gameState.economy.progressLevel });
    a.game.saveNow();
    for (let i = 0; i < 2; i++) {
        const b = newGame({ storage: a.storage, load: true });
        assert.deepEqual(plain({ p: b.game.getPotions(), m: b.game.getMoney(), lv: b.game.gameState.economy.progressLevel }), snap);
        assert.equal(b.game.getPotionPrice(), 200);
        b.game.saveNow();
    }
});

test('catálogo da loja: preço, efeito, estoque, teto, atalhos e se dá para comprar', () => {
    const { game } = newGame();
    let [item] = game.getShopItems();
    assert.deepEqual(plain({ id: item.id, price: item.price, stock: item.stock, capacity: item.capacity, room: item.room, packs: item.packs, canBuyOne: item.canBuyOne }),
        { id: 'potion', price: 40, stock: 10, capacity: 30, room: 20, packs: [1, 5, 10], canBuyOne: false });
    assert.match(item.description, /50%/);
    game.earnMoney(40, 'reward');
    [item] = game.getShopItems();
    assert.equal(item.canBuyOne, true);
});

test('loop de poção: caçada para sem poções, comprar libera e uma nova caçada começa', () => {
    const { game } = newGame({ seed: 9 });
    game.gameState.inventory.potions = 0;
    game.earnMoney(500, 'reward');
    game.dispatchAutomationAction({ type: 'START_HUNT' });
    game.stopBattle(); game.startBattle(); game.stopBattle();
    game.currentBattle.playerCurrentHp = 1;
    game._checkLowHp(game.currentBattle, true);
    assert.equal(game.getHuntSession().stopReason, 'no_potions');
    assert.equal(game.buyPotions(5).ok, true);
    assert.equal(game.dispatchAutomationAction({ type: 'START_HUNT' }).ok, true);
    game.currentBattle.playerCurrentHp = 1;
    game._checkLowHp(game.currentBattle, true);
    assert.equal(game.getPotions(), 4, 'uma poção usada pela cura automática');
    assert.equal(game.isHuntRunning(), true);
    game.stopBattle();
});
