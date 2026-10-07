'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, dispose, catchRange, ivs, perfectIvs, plain } = require('./helpers/game');

test('初始只有关都解锁；集齐 #1-151 后城都解锁', () => {
    const { game } = newGame();
    assert.equal(game.isRegionUnlocked('kanto'), true);
    assert.equal(game.isRegionUnlocked('johto'), false);
    assert.equal(game.isRegionUnlocked('nonexistent'), false);
    catchRange(game, 1, 150, ivs(0));
    assert.equal(game.isRegionUnlocked('johto'), false, '缺一只都不行');
    const p = game.getRegionUnlockProgress('johto');
    assert.equal(p.total, 151);
    assert.equal(p.current, 150);
    assert.equal(p.percent, 99);
    catchRange(game, 151, 151, ivs(0));
    assert.equal(game.isRegionUnlocked('johto'), true);
    assert.equal(game.getRegionUnlockProgress('johto').percent, 100);
    dispose(game);
});

test('逐个地区的解锁条件都指向上一地区的完整图鉴', () => {
    const { game, ctx } = newGame();
    const order = Object.keys(ctx.REGIONS);
    for (let i = 1; i < order.length; i++) {
        const [a, b] = ctx.REGION_POKEDEX_RANGES[order[i - 1]];
        catchRange(game, a, b, ivs(0));
        assert.equal(game.isRegionUnlocked(order[i]), true, `${order[i]} 应在集齐 ${order[i - 1]} 后解锁`);
    }
    dispose(game);
});

test('changeRoute：未解锁地区的路线被拒绝，已解锁可切换', () => {
    const { game, ctx } = newGame();
    const firstJohto = ctx.REGIONS.johto.routes[0].id;
    assert.equal(game.changeRoute(firstJohto), false);
    assert.equal(game.gameState.currentRoute, 'kanto_route1');
    assert.equal(game.changeRoute('kanto_route2'), true);
    assert.equal(game.gameState.currentRoute, 'kanto_route2');
    catchRange(game, 1, 151, ivs(0));
    assert.equal(game.changeRoute(firstJohto), true);
    dispose(game);
});

test('getPokedexStatsByRegion 使用统一区间', () => {
    const { game } = newGame();
    catchRange(game, 1, 10, ivs(0));
    const s = game.getPokedexStatsByRegion('kanto');
    assert.equal(s.total, 151);
    assert.equal(s.caught, 11); // 1-10 + 初始皮卡丘(#25)
    assert.equal(game.getPokedexStatsByRegion('mega').total, 48);
    dispose(game);
});

test('通关地区图鉴后自动发放徽章，并解锁对应系统', () => {
    const { game } = newGame();
    assert.equal(game.hasBadge('kanto'), false);
    assert.equal(game.isGoldUnlocked(), false);
    catchRange(game, 1, 151, ivs(0));
    assert.equal(game.tryUnlockBadge('kanto'), true);
    assert.equal(game.hasBadge('kanto'), true);
    assert.equal(game.isGoldUnlocked(), true);
    assert.equal(game.tryUnlockBadge('kanto'), false, '重复发放应返回 false');
    assert.equal(game.tryUnlockBadge('johto'), false, '图鉴未完成不能发放');
    dispose(game);
});

test('自动换图：当前路线全员 6V+闪光后，前往下一个未完成路线', () => {
    const { game, ctx } = newGame();
    game.gameState.settings.autoRouteSwitch = true;
    const route = game.getRoute('kanto_route1');
    for (const e of route.pokemon) {
        game.catchPokemonWithIvs(e.id, 1, perfectIvs());
        game.gameState.shinyDex[e.id] = true;
        game._touchSpecies(e.id);
    }
    assert.equal(game.isRouteComplete6VShiny('kanto_route1'), true);
    const r = game.tryAutoRouteSwitch();
    assert.ok(r, '应发生切换');
    assert.notEqual(r.routeId, 'kanto_route1');
    assert.equal(game.gameState.currentRoute, r.routeId);
    assert.equal(game.gameState.currentEnemy, null);
    // 条件改为仅 6V：同样满足
    game.gameState.settings.routeSwitchCondition = '6v_only';
    assert.equal(game._isRouteCompleteByCondition('kanto_route1'), true);
    void ctx;
    dispose(game);
});

test('自动换图关闭时不切换', () => {
    const { game } = newGame();
    game.gameState.settings.autoRouteSwitch = false;
    assert.equal(game.tryAutoRouteSwitch(), null);
    dispose(game);
});

test('REGION_POKEDEX_RANGES 与 REGIONS 解锁条件完全一致', () => {
    const { ctx } = newGame();
    const keys = Object.keys(ctx.REGIONS);
    keys.forEach((k, i) => {
        if (i === 0) return;
        assert.deepEqual(plain(ctx.REGIONS[k].unlockCondition.range), plain(ctx.REGION_POKEDEX_RANGES[keys[i - 1]]));
    });
});
