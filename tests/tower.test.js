'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, catchRange, ivs, plain } = require('./helpers/game');

function towerReady() {
    const env = newGame();
    catchRange(env.game, 906, 1025, ivs(0));
    return env;
}

test('挑战塔：图鉴未完成时不能进入', () => {
    const { game } = newGame();
    assert.equal(game.enterTower().success, false);
});

test('挑战塔：进入后暂停主线，敌人为闪光满个体值，等级随层数递增', () => {
    const { game, ctx } = towerReady();
    const res = game.enterTower();
    assert.equal(res.success, true);
    assert.equal(game._towerMode, true);
    assert.equal(game.gameState.tower.enemies.length, 6);
    game.startTowerBattle();
    game.stopBattle();
    const w = game.currentBattle.wild;
    assert.equal(w.isShiny, true);
    assert.equal(w.level, game.getTowerFloorLevel(1));
    assert.deepEqual(plain(w.ivs), plain({ hp: 31, atk: 31, def: 31, spAtk: 31, spDef: 31, speed: 31 }));
    assert.ok(game.currentBattle.derived, '塔战斗同样缓存了战斗内常量');
    assert.equal(game.getTowerFloorLevel(2) - game.getTowerFloorLevel(1), 1000);
    assert.ok(ctx.TOWER_MAX_FLOOR >= 255);
});

test('挑战塔：击败 6 只通关一层，更新最高层与全局加成；失败重置本层进度', () => {
    const { game } = towerReady();
    game.enterTower();
    const events = [];
    game.onBattleEvent = (e, d) => events.push([e, plain(d)]);
    for (let i = 0; i < 6; i++) {
        game.startTowerBattle();
        game.stopBattle();
        game.currentBattle.wildCurrentHp = 0;
        game.onTowerEnemyDefeated();
    }
    assert.equal(game.gameState.tower.highestFloor, 1);
    assert.equal(game.gameState.tower.currentFloor, 2);
    assert.equal(game._towerMode, false);
    assert.equal(game.getTowerBonus(), 1);
    assert.ok(events.some(e => e[0] === 'towerFloorCleared'));

    game.enterTower();
    game.startTowerBattle(); game.stopBattle();
    game.onTowerEnemyDefeated(); // 击败第 1 只
    game.stopBattle();
    assert.equal(game.gameState.tower.currentEnemyIndex, 1);
    game.onTowerPlayerFainted();
    assert.equal(game.gameState.tower.currentEnemyIndex, 0);
    assert.equal(game._towerMode, false);
});

test('读档时塔内战斗状态不跨会话保留（inBattle 复位），层数进度保留', () => {
    const { game, storage } = towerReady();
    game.enterTower();
    game.saveNow();
    const { game: g2 } = newGame({ storage, load: true });
    assert.equal(g2.gameState.tower.inBattle, false);
    assert.equal(g2._towerMode, false);
    assert.equal(g2.gameState.tower.currentFloor, 1);
});
