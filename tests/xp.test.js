'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, dispose, catchRange, ivs } = require('./helpers/game');

test('经验曲线：四个经验组在 100 级的总经验', () => {
    const { ctx } = newGame();
    assert.equal(ctx.getExpForLevel('fast', 100), 800000);
    assert.equal(ctx.getExpForLevel('medium', 100), 1000000);
    assert.equal(ctx.getExpForLevel('slow', 100), 1250000);
    assert.equal(ctx.getExpForLevel('mediumSlow', 100), 1059860);
    assert.equal(ctx.getExpForLevel('medium', 1), 0);
    assert.equal(ctx.getExpForLevel('medium', 0), 0);
});

test('addExpToPokemon：连续升级、返回 true、通知起止等级', () => {
    const { game, ctx } = newGame();
    const seen = [];
    game.onLevelUp = (i) => seen.push(i);
    const need = ctx.getExpForLevel('medium', 11); // 皮卡丘为 medium 组
    assert.equal(game.addExpToPokemon(25, need), true);
    const st = game.gameState.caughtPokemon[25];
    assert.equal(st.level, 11);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].startLevel, 5);
    assert.equal(seen[0].level, 11);
    assert.equal(game.addExpToPokemon(25, 0), false);
    dispose(game);
});

test('addExpToPokemon：未捕获/等级上限返回 false 且不改动数据', () => {
    const { game, ctx } = newGame();
    assert.equal(game.addExpToPokemon(150, 1000), false);
    assert.equal(game.gameState.caughtPokemon[150], undefined);
    const st = game.gameState.caughtPokemon[25];
    st.level = ctx.MAX_POKEMON_LEVEL;
    const exp = st.exp;
    assert.equal(game.addExpToPokemon(25, 1e9), false);
    assert.equal(st.exp, exp);
    dispose(game);
});

test('基础经验产出：种族值总和/3 × 等级系数（100 级后固定 2.0）', () => {
    const { game } = newGame();
    const total = 35 + 55 + 40 + 50 + 50 + 90;   // 皮卡丘
    const base = Math.floor(total / 3);
    assert.equal(game.getBaseExpYield(25, 5), Math.floor(base * 1.0));
    assert.equal(game.getBaseExpYield(25, 30), Math.floor(base * 1.3));
    assert.equal(game.getBaseExpYield(25, 100), Math.floor(base * 2.0));
    assert.equal(game.getBaseExpYield(25, 5000), Math.floor(base * 2.0));
    dispose(game);
});

test('经验加成按固定顺序逐级取整（徽章 → 天赋 → 挑战塔）', () => {
    const { game } = newGame();
    const b = { badgeExp: 0.5, talentExp: 10, towerBonus: 7 };
    // 101 → floor(151.5)=151 → floor(166.1)=166 → floor(177.62)=177
    assert.equal(game._applyExpBonuses(101, b), 177);
    assert.equal(game._applyExpBonuses(101, { badgeExp: null, talentExp: 0, towerBonus: 0 }), 101);
    dispose(game);
});

test('胜利结算：出战 100%、队友 50%、图鉴其余 1%（向上取整）', () => {
    const { game } = newGame();
    catchRange(game, 1, 20, ivs(0));
    game.addToTeamFromPokedex(4);                 // 队伍：皮卡丘(出战) + 小火龙
    const wild = game.createWildPokemon(19, 40);
    const base = game.getBaseExpYield(19, 40);
    const expected = Math.floor(base * 40 / 7);
    const before = {
        pika: game.gameState.caughtPokemon[25].exp,
        char: game.gameState.caughtPokemon[4].exp,
        bulb: game.gameState.caughtPokemon[1].exp,
    };
    const r = game._processVictoryRewards(wild, 25, 100, 50);
    assert.equal(r.expGained, expected);
    assert.equal(game.gameState.caughtPokemon[25].exp - before.pika, expected);
    assert.equal(game.gameState.caughtPokemon[4].exp - before.char, Math.floor(expected * 0.5));
    assert.equal(game.gameState.caughtPokemon[1].exp - before.bulb, Math.ceil(expected * 0.01));
    assert.equal(r.newPlayerHp, 60);              // 胜利回血 10%
    assert.equal(game.gameState.stats.totalExp, expected);
    assert.equal(game.gameState.stats.totalBattles, 1);
    dispose(game);
});

test('天赋：怪物等级提升公式 L\' = L + (30000-L)×X/100，≥30000 不受影响', () => {
    const { game } = newGame();
    assert.equal(game.getMonsterLevelBoost(100), 100);
    game.gameState.talents.team_exp_bonus = 50;
    assert.equal(game.getMonsterLevelBoost(100), Math.round(100 + (30000 - 100) * 0.5));
    assert.equal(game.getMonsterLevelBoost(30000), 30000);
    assert.equal(game.getMonsterLevelBoost(40000), 40000);
    dispose(game);
});
