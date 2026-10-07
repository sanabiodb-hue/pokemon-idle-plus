'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, dispose, catchRange, ivs, plain, runOffline, mulberry32 } = require('./helpers/game');

function strongPikachu(game, level = 30) {
    const st = game.gameState.caughtPokemon[25];
    st.level = level;
    st.exp = game.ctx ? 0 : 0;
    game._touchSpecies(25);
}

test('离线结算：生成摘要（战斗数、经验、新捕获），事件不再丢失', async () => {
    const { game, ctx } = newGame({ seed: 3 });
    // 小火龙 Lv15，离线期间会升到 16 并进化
    game.catchPokemonWithIvs(4, 15, ivs(10));
    const st = game.gameState.caughtPokemon[4];
    st.exp = ctx.getExpForLevel('mediumSlow', 15);
    game.gameState.team = [4];
    game.gameState.activePokemonIndex = 0;
    game._invalidateAllCaches();

    const data = await runOffline(game, 20 * 60 * 1000);
    assert.ok(data.battles > 50, `应完成大量战斗，实际 ${data.battles}`);
    const s = data.summary;
    assert.ok(s, 'offlineEnd 必须携带 summary');
    assert.equal(s.battles, data.battles);
    assert.ok(s.expGained > 0);
    assert.ok(s.newCatches.length >= 1, '路线1 的新宝可梦应被记录');
    assert.ok(s.newCatches.every(c => c.name && c.id));
    assert.ok(s.events.some(e => e.event === 'evolved'), '进化事件必须保留在摘要里');
    assert.deepEqual(plain(data.offlineEvents), plain(s.events));
    assert.ok(s.levelUps.length >= 1);
    assert.ok(game.gameState.caughtPokemon[5], '小火龙应进化成火恐龙');
    assert.equal(game.lastOfflineSummary, s);
    dispose(game);
});

test('离线结算结束后回调全部恢复，且不处于静默状态', async () => {
    const { game } = newGame();
    const handlers = { onCatch: () => {}, onLevelUp: () => {} };
    game.onCatch = handlers.onCatch;
    game.onLevelUp = handlers.onLevelUp;
    await runOffline(game, 5 * 60 * 1000);
    assert.equal(game.onCatch, handlers.onCatch);
    assert.equal(game.onLevelUp, handlers.onLevelUp);
    assert.equal(game._isOfflineSimulating, false);
    assert.equal(game._offlineSimState, null);
    dispose(game);
});

test('回归：离线时间很短（走提前返回分支）时回调也必须恢复', async () => {
    const { game } = newGame();
    const marker = () => {};
    game.onLevelUp = marker;
    const data = await runOffline(game, 500);
    assert.equal(data.battles, 0);
    assert.equal(game.onLevelUp, marker, '旧版本在此分支会永久丢失 UI 回调');
    assert.equal(game._isOfflineSimulating, false);
    dispose(game);
});

test('挑战塔模式下不做主线离线结算（避免污染塔进度）', () => {
    const { game } = newGame();
    game._towerMode = true;
    const events = [];
    game.onBattleEvent = (e) => events.push(e);
    const expBefore = game.gameState.stats.totalExp;
    game._processOfflineBattles(3600 * 1000);
    assert.equal(game._isOfflineSimulating, false);
    assert.equal(game._offlineSimState, null);
    assert.equal(game.gameState.stats.totalExp, expBefore);
    assert.deepEqual(events, []);
    // 页面重新可见时同样不处理
    game._hiddenAt = Date.now() - 3600 * 1000;
    game._onPageVisible();
    assert.equal(game._isOfflineSimulating, false);
    assert.equal(game._hiddenAt, null);
    game._towerMode = false;
    dispose(game);
});

test('正在离线结算时再次触发会被忽略（不重入）', async () => {
    const { game } = newGame();
    const done = runOffline(game, 3 * 3600 * 1000);   // 足够长，需要多批才能完成
    assert.equal(game._isOfflineSimulating, true);
    const simBefore = game._offlineSimState;
    game._processOfflineBattles(60 * 1000);
    assert.equal(game._offlineSimState, simBefore);
    const data = await done;
    assert.ok(data.battles > 0);
    dispose(game);
});

test('在线与离线共用同一套胜利结算：结果逐项一致', () => {
    const run = (offline) => {
        const { game } = newGame({ seed: 11 });
        catchRange(game, 1, 30, ivs(0));
        game.addToTeamFromPokedex(4);
        const wildRng = mulberry32(99);
        const sim = offline ? { bonuses: game.getProgressBonuses(), pokedexExpAccumulator: {} } : null;
        for (let i = 0; i < 30; i++) {
            const prev = game.rng; game.rng = wildRng;
            const wild = game.generateWildPokemon(game.getRoute('kanto_route2'));
            game.rng = prev;
            game._processVictoryRewards(wild, 25, 100, 50, sim);
        }
        if (sim) game._flushPokedexExpAccumulator(sim.pokedexExpAccumulator);
        const out = plain({ caught: game.gameState.caughtPokemon, gold: game.gameState.gold, stats: game.gameState.stats, dex: game.gameState.pokedex });
        dispose(game);
        return out;
    };
    const online = run(false);
    const offline = run(true);
    assert.deepEqual(online.caught, offline.caught);
    assert.deepEqual(online.stats, offline.stats);
    assert.equal(online.gold, offline.gold);
    assert.deepEqual(online.dex, offline.dex);
});

test('野怪生成：使用缓存参数与实时计算得到相同结果', () => {
    const { game } = newGame();
    const route = game.getRoute('kanto_route3');
    game.gameState.badges.unova = { unlocked: true, gem: null };
    game.gameState.badges.sinnoh = { unlocked: true, gem: null };
    const cache = { shinyRate: game.getShinyRate(), weightReduce: game.getBadgeEffectValue('completed_weight_reduce') };
    for (let seed = 1; seed <= 25; seed++) {
        game.rng = mulberry32(seed);
        const a = plain(game.generateWildPokemon(route));
        game.rng = mulberry32(seed);
        const b = plain(game.generateWildPokemon(route, cache));
        delete a.uid; delete b.uid;
        assert.deepEqual(a, b);
    }
    dispose(game);
});

test('正在回血时离线：时间不够回满则继续回血，不开战', async () => {
    const { game } = newGame();
    game.startBattle();
    game.stopBattle();
    game.currentBattle.playerCurrentHp = 1;
    game.startHealingAfterDefeat();
    assert.ok(game.healTimer);
    const maxHp = game.currentBattle.playerMaxHp;
    const data = await runOffline(game, 2000);
    assert.equal(data.battles, 0);
    assert.ok(game.currentBattle.playerCurrentHp > 1 && game.currentBattle.playerCurrentHp < maxHp);
    dispose(game);
});

test('正在回血时离线很久：先回满再结算战斗', async () => {
    const { game } = newGame();
    game.startBattle();
    game.stopBattle();
    game.currentBattle.playerCurrentHp = 0;
    game.startHealingAfterDefeat();
    const data = await runOffline(game, 10 * 60 * 1000);
    assert.ok(data.battles > 0);
    dispose(game);
});

test('离线时间上限：默认 24 小时，帕底亚徽章 48 小时', () => {
    const { game, ctx } = newGame();
    assert.equal(game.getMaxOfflineTime(), ctx.MAX_OFFLINE_TIME);
    assert.equal(game.getMaxOfflineTime(), 24 * 3600 * 1000);
    game.gameState.badges.paldea = { unlocked: true, gem: null };
    assert.equal(game.getMaxOfflineTime(), 48 * 3600 * 1000);
    dispose(game);
});

test('路线没有野怪时离线结算会终止而不是空转', async () => {
    const { game } = newGame();
    game.getRoute = () => ({ id: 'empty', name: 'x', pokemon: [] });
    const data = await runOffline(game, 3600 * 1000);
    assert.equal(data.battles, 0);
    dispose(game);
});

test('离线后的血量带回战斗，存档里的 battleHp 与之一致', async () => {
    const { game } = newGame();
    game.startBattle();
    game.stopBattle();
    const data = await runOffline(game, 5 * 60 * 1000);
    assert.ok(data.battles > 0);
    const hp = data.battleHpAtEnd;
    assert.ok(hp && hp.playerMaxHp > 0 && hp.playerHp > 0, '结算结束时应写入模拟后的血量');
    assert.ok(game.currentBattle.playerMaxHp > 0, '战斗对象应带回新的血量，而不是沿用结算前的旧值');
    dispose(game);
});
