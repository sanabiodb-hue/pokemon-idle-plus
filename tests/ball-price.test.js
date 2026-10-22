'use strict';
// F9.9: o preço da bola (compra manual e reposição automática, a MESMA função de nível) segue o nível da rota selecionada, nunca acima do nível de progresso;
// o preço da poção e das melhorias não muda.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { newGame } = require('./helpers/game');

const plain = (o) => JSON.parse(JSON.stringify(o));
const gpw = (lvl) => Math.max(1, Math.floor(Math.sqrt(Math.max(1, lvl)) * 2));            // ouro base por vitória (fórmula independente)
const potionPrice = (lvl) => Math.max(40, Math.ceil(10 * gpw(lvl)));                      // poção: base 40, 10 vitórias (fórmula independente)
const BALLS = [['pokeball', 1, 0.1], ['greatball', 3, 0.3], ['ultraball', 6, 0.6]];       // [id, piso, fator de vitórias]
const ballPriceModel = (id, lvl) => { const b = BALLS.find(x => x[0] === id); return Math.max(b[1], Math.ceil(b[2] * gpw(lvl))); };
const on = (opts = {}) => { const g = newGame({ balls: true, ...opts }); vm.runInContext('BALL_RESTOCK_ENABLED = true', g.ctx.sandbox); return g; };
function setProgress(game, level) { const lead = game._partyInstance(0); lead.level = level; game._touchInstance(lead); game._pricingCap = () => 1e12; }
const mid = (r) => Math.round((r.levelRange[0] + r.levelRange[1]) / 2);

test('F9.9 A: tabela de preços por nível de rota — nível = min(nível médio da rota, nível de progresso); compra manual e reposição leem a mesma função', () => {
    const { game, ctx } = on({ seed: 3 });
    const routes = { kanto_route1: 'kanto_route1', kanto_route24: 'kanto_route24', johto_route29: 'johto_route29', hoenn_route121: 'hoenn_route121', unova_route6: 'unova_route6', paldea_route12: 'paldea_route12' };
    for (const progress of [5, 30, 100, 400, 1000, 5000]) {
        setProgress(game, progress);
        for (const rid of Object.keys(routes)) {
            game.gameState.currentRoute = rid;
            const r = game.getRoute(rid);
            const expectedLevel = Math.min(mid(r), game.getPricingLevel());
            assert.equal(game.getBallPricingLevel(), expectedLevel, `${rid} @ progresso ${progress}`);
            for (const [id] of BALLS) {
                const shop = game.getShopItems().find(i => i.id === id).price;
                assert.equal(shop, ballPriceModel(id, expectedLevel), `${id} na loja: ${rid} @ ${progress}`);
                assert.equal(shop, ctx.ballPrice(ctx.getBallType(id), game.getBallPricingLevel()), 'a loja e a função pura concordam');
            }
            assert.ok(game.getBallPricingLevel() <= game.getPricingLevel(), 'nunca mais cara que o preço por progresso');
        }
    }
});

test('F9.9 A: rota fraca com nível alto — a bola custa pelo nível da rota (nível 400 na rota 1: 1 em vez de 4; nível 1000: 1 em vez de 7)', () => {
    const { game } = on({ seed: 3 });
    for (const [progress, byProgress] of [[400, 4], [1000, 7]]) {
        setProgress(game, progress); game.gameState.currentRoute = 'kanto_route1';
        assert.equal(game.getShopItems().find(i => i.id === 'pokeball').price, 1);
        assert.equal(ballPriceModel('pokeball', progress), byProgress, 'antes (preço pelo maior nível)');
    }
});

test('F9.9 A: sem rota válida o preço volta ao nível de progresso (fallback conservador); Torre usa a rota selecionada, igual aos outros modos', () => {
    const { game } = on({ seed: 3 });
    setProgress(game, 1000);
    for (const bad of [null, undefined, 'nao_existe', '', 5]) {
        game.gameState.currentRoute = bad;
        assert.equal(game.getBallPricingLevel(), game.getPricingLevel(), `rota ${String(bad)}`);
        assert.equal(game.getShopItems().find(i => i.id === 'ultraball').price, ballPriceModel('ultraball', game.getPricingLevel()));
    }
    game.gameState.currentRoute = 'kanto_route1';
    const normal = game.getBallPricingLevel();
    game._towerMode = true; assert.equal(game.getBallPricingLevel(), normal, 'Torre: a mesma regra (a rota selecionada continua a mesma)'); game._towerMode = false;
});

test('F9.9 A: rota ACIMA do nível de progresso — o preço da bola nunca passa do preço por progresso', () => {
    const { game } = on({ seed: 3 });
    setProgress(game, 50); game.gameState.currentRoute = 'paldea_route12';
    assert.equal(game.getPricingLevel(), 50); assert.equal(game.getBallPricingLevel(), 50);
    assert.equal(game.getShopItems().find(i => i.id === 'pokeball').price, ballPriceModel('pokeball', 50));
});

test('F9.9 A: a poção e as melhorias NÃO mudam — preço da poção e escala das melhorias seguem o nível de progresso, não a rota', () => {
    const { game } = on({ seed: 3 });
    for (const progress of [5, 30, 100, 400, 1000]) {
        setProgress(game, progress);
        const lvl = game.getPricingLevel();
        for (const rid of ['kanto_route1', 'kanto_route24', 'hoenn_route121']) {
            game.gameState.currentRoute = rid;
            assert.equal(game.getPotionPrice(), potionPrice(lvl), `poção @ ${progress} na ${rid}`);
            assert.equal(game.getShopItems().find(i => i.id === 'potion').price, potionPrice(lvl));
        }
        const before = game._upgradeCostScale();
        game.gameState.currentRoute = 'kanto_route1'; const a = game._upgradeCostScale();
        game.gameState.currentRoute = 'hoenn_route121'; const b = game._upgradeCostScale();
        assert.equal(a, before); assert.equal(b, before, 'a escala das melhorias não depende da rota');
    }
});

test('F9.9 A: a reposição automática compra ao MESMO preço da loja na rota atual (quantidade × preço do item = ouro gasto), e a compra manual segue atômica', () => {
    const { game } = on({ seed: 3 });
    game.gameState.account = { benefits: ['autoRestock'] };
    for (const [progress, rid] of [[400, 'kanto_route1'], [400, 'hoenn_route121'], [1000, 'unova_route6']]) {
        setProgress(game, progress); game.gameState.currentRoute = rid;
        const inv = game.ensureInventory(); inv.ballsGranted = true; delete inv.balls; game.gameState.gold = 100_000;
        const price = game.getShopItems().find(i => i.id === 'pokeball').price;
        const r = game._restockBalls();
        assert.equal(r.qty, 30); assert.equal(r.total, 30 * price, `${rid}: reposição = quantidade × preço da loja`); assert.equal(game.getMoney(), 100_000 - 30 * price);
    }
    // compra manual: atomicidade preservada (recusa = estado idêntico) e débito = quantidade × preço exibido
    setProgress(game, 400); game.gameState.currentRoute = 'kanto_route1'; game.gameState.gold = 1000; delete game.ensureInventory().balls;
    game.getProgressLevel();
    const price = game.getShopItems().find(i => i.id === 'greatball').price;
    const ok = game.buyShopItem('greatball', 10); assert.equal(ok.ok, true); assert.equal(ok.total, 10 * price); assert.equal(game.getMoney(), 1000 - 10 * price);
    game.gameState.gold = price * 3 - 1; const snap = JSON.stringify({ g: game.gameState.gold, i: game.gameState.inventory });
    assert.equal(game.buyShopItem('greatball', 3).code, 'insufficient_funds'); assert.equal(JSON.stringify({ g: game.gameState.gold, i: game.gameState.inventory }), snap, 'recusa: nada muda');
});

test('F9.9 A: trocar a rota muda o preço do mesmo item na hora (a loja lê o jogo a cada consulta)', () => {
    const { game } = on({ seed: 3 });
    setProgress(game, 1000);
    const price = (rid) => { game.gameState.currentRoute = rid; return game.getShopItems().find(i => i.id === 'ultraball').price; };
    const weak = price('kanto_route1'), strong = price('unova_route6'), other = price('kanto_route1');
    assert.equal(weak, ballPriceModel('ultraball', 3)); assert.equal(strong, ballPriceModel('ultraball', 1000), 'rota acima do progresso: teto no preço por progresso'); assert.ok(strong > weak); assert.equal(other, weak);
});
