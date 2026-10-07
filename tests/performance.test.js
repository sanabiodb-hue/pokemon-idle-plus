'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, catchRange, ivs } = require('./helpers/game');

test('大图鉴（1000+ 只）下，换人/开战的属性计算不再按图鉴规模放大', () => {
    const { game } = newGame();
    catchRange(game, 1, 1073, ivs(15));
    for (const id of [1, 4, 7, 150, 151]) game.addToTeamFromPokedex(id);
    game.calculateBattleStats(0);                          // 预热
    let statCalls = 0, created = 0;
    const calc = game.calculateStats.bind(game);
    const create = game.createPokemon.bind(game);
    game.calculateStats = (p) => { statCalls++; return calc(p); };
    game.createPokemon = (...a) => { created++; return create(...a); };

    const wild = game.createWildPokemon(19, 50);           // 野怪自身会调用 1 次 calculateStats
    statCalls = 0;
    for (let i = 0; i < 20; i++) game.getBestTeamMemberForEnemy(wild);   // 20 次 × 6 名队员
    assert.equal(created, 0, '选择最优队员不应构造宝可梦对象');
    assert.ok(statCalls <= 20, `只应为野怪计算属性（每次 1 次），实际 ${statCalls}`);

    // 战斗开始（含 calculateBattleStats、缓存战斗常量）
    statCalls = 0; created = 0;
    game.gameState.currentEnemy = null;
    game.startBattle();
    game.stopBattle();
    assert.ok(statCalls <= 3, `startBattle 的属性计算次数应为常数，实际 ${statCalls}`);
    assert.equal(created, 0);
});

test('1000+ 只图鉴下 2000 次 calculateBattleStats 耗时在宽松预算内', () => {
    const { game } = newGame();
    catchRange(game, 1, 1073, ivs(15));
    game.calculateBattleStats(0);
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < 2000; i++) game.calculateBattleStats(0);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 1500, `缓存命中时应当很快，实际 ${ms.toFixed(0)}ms`);
});

test('升级一只图鉴宝可梦后，下一次属性计算只重算该物种', () => {
    const { game } = newGame();
    catchRange(game, 1, 500, ivs(15));
    game.calculateBattleStats(0);
    let statCalls = 0;
    const calc = game.calculateStats.bind(game);
    game.calculateStats = (p) => { statCalls++; return calc(p); };
    game.addExpToPokemon(400, 1e8);
    game.calculateBattleStats(0);
    assert.ok(statCalls <= 2, `实际 ${statCalls}`);
});

test('宝石加成缓存：镶嵌/卸下后立即生效', () => {
    const { game } = newGame();
    game.gameState.badges.kanto = { unlocked: true, gem: null };
    assert.equal(game.getGemBonuses().hp_bonus, 0);
    game.gameState.gems = [{ uid: 'g1', quality: 'common', qualityName: '普通', qualityColor: '#a0a0a0', attrs: [{ id: 'hp_bonus', value: 4 }], locked: false }];
    assert.equal(game.equipGem('kanto', 'g1').success, true);
    assert.equal(game.getGemBonuses().hp_bonus, 4);
    assert.equal(game.unequipGem('kanto').success, true);
    assert.equal(game.getGemBonuses().hp_bonus, 0);
});
