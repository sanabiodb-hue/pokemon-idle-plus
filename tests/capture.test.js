'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, dispose, catchRange, ivs, sequenceRng, plain, mulberry32 } = require('./helpers/game');

test('首次击败：100% 捕获，记录野怪个体值，等级为 1', () => {
    const { game } = newGame();
    const wild = game.createWildPokemon(19, 4);
    wild.ivs = { hp: 3, atk: 4, def: 5, spAtk: 6, spDef: 7, speed: 8 };
    const catches = [];
    game.onCatch = (c) => catches.push(c);
    const before = game.gameState.stats.totalCatches;
    game.processDefeat(wild);
    const st = game.gameState.caughtPokemon[19];
    assert.ok(st);
    assert.equal(st.level, 1);
    assert.deepEqual(plain(st.ivs), { hp: 3, atk: 4, def: 5, spAtk: 6, spDef: 7, speed: 8 });
    assert.equal(game.gameState.pokedex[19], 'caught');
    assert.equal(game.gameState.stats.totalCatches, before + 1);
    assert.equal(catches.length, 1);
    assert.equal(catches[0].isFirstCatch, true);
    dispose(game);
});

test('重复击败：个体值只升不降，并通知更新的属性', () => {
    const { game } = newGame();
    game.catchPokemonWithIvs(19, 1, { hp: 10, atk: 20, def: 5, spAtk: 0, spDef: 0, speed: 31 });
    const catches = [];
    game.onCatch = (c) => catches.push(c);
    const wild = game.createWildPokemon(19, 4);
    wild.ivs = { hp: 15, atk: 3, def: 5, spAtk: 1, spDef: 0, speed: 2 };
    game.processDefeat(wild);
    assert.deepEqual(plain(game.gameState.caughtPokemon[19].ivs), { hp: 15, atk: 20, def: 5, spAtk: 1, spDef: 0, speed: 31 });
    assert.equal(catches.length, 1);
    assert.equal(catches[0].isFirstCatch, false);
    assert.deepEqual(plain(catches[0].updatedStats).map(u => u.stat).sort(), ['hp', 'spAtk']);
    // 完全不如已有 → 无通知
    catches.length = 0;
    const worse = game.createWildPokemon(19, 4);
    worse.ivs = ivs(0);
    game.processDefeat(worse);
    assert.equal(catches.length, 0);
    dispose(game);
});

test('击败闪光野怪后记录闪光，并传播给整条进化链', () => {
    const { game } = newGame();
    game.catchPokemonWithIvs(1, 5, ivs(1));
    game.catchPokemonWithIvs(3, 1, ivs(1));
    const wild = game.createWildPokemon(2, 10);
    wild.isShiny = true;
    game._processVictoryRewards(wild, 25, 100, 100);
    assert.equal(game.gameState.shinyDex[2], true);
    assert.equal(game.gameState.shinyDex[1], true);
    assert.equal(game.gameState.shinyDex[3], true);
    dispose(game);
});

test('集齐关都图鉴的那一次捕获：触发城都解锁与关都徽章事件', () => {
    const { game } = newGame();
    catchRange(game, 1, 150, ivs(0));
    const events = [];
    game.onBattleEvent = (e, d) => events.push([e, plain(d)]);
    const last = game.createWildPokemon(151, 10);
    game.processDefeat(last);
    assert.ok(events.some(e => e[0] === 'regionUnlocked' && e[1].regionId === 'johto'));
    assert.ok(events.some(e => e[0] === 'badgeUnlocked' && e[1].regionId === 'kanto'));
    assert.equal(game.hasBadge('kanto'), true);
    dispose(game);
});

test('刷新野怪：按权重选择、等级落在配置范围内', () => {
    const { game } = newGame();
    const route = game.getRoute('kanto_route1');   // 19: 55, 16: 45
    game.rng = sequenceRng([0.10, 0.5, 0, 0, 0, 0, 0, 0, 0.9]);
    const a = game.generateWildPokemon(route);
    assert.equal(a.id, 19);
    game.rng = sequenceRng([0.99, 0.0, 0, 0, 0, 0, 0, 0, 0.9]);
    const b = game.generateWildPokemon(route);
    assert.equal(b.id, 16);
    assert.equal(b.level, 1);
    const rnd = mulberry32(5);
    game.rng = rnd;
    for (let i = 0; i < 200; i++) {
        const w = game.generateWildPokemon(route);
        const entry = route.pokemon.find(p => p.id === w.id);
        assert.ok(w.level >= entry.levelRange[0] && w.level <= entry.levelRange[1]);
        assert.equal(w.isWild, true);
        assert.ok(w.currentHp > 0);
    }
    dispose(game);
});

test('合众徽章：已 6V+闪光 的宝可梦出现权重降低', () => {
    const { game } = newGame();
    const route = game.getRoute('kanto_route1');
    game.gameState.badges.unova = { unlocked: true, gem: null };
    // 把 #19 做成 6V+闪光，权重 55 → 5.5；总权重 50.5；rand=0.5*50.5=25.25 → 第一项(5.5)扣完后落在 #16
    game.catchPokemonWithIvs(19, 1, { hp: 31, atk: 31, def: 31, spAtk: 31, spDef: 31, speed: 31 });
    game.gameState.shinyDex[19] = true;
    game.rng = sequenceRng([0.5, 0, 0, 0, 0, 0, 0, 0, 0.9]);
    assert.equal(game.generateWildPokemon(route).id, 16);
    // 没有徽章时同样的随机数 → #19
    game.gameState.badges = {};
    game.rng = sequenceRng([0.5 * 0.2, 0, 0, 0, 0, 0, 0, 0, 0.9]);
    assert.equal(game.generateWildPokemon(route).id, 19);
    dispose(game);
});

test('闪光概率：基础 1/4096，叠加徽章/天赋/挑战塔', () => {
    const { game, ctx } = newGame();
    assert.equal(game.getShinyRate(), ctx.BASE_SHINY_RATE);
    game.gameState.badges.sinnoh = { unlocked: true, gem: null };   // +100%
    assert.equal(game.getShinyRate(), ctx.BASE_SHINY_RATE * 2);
    game.gameState.talents.shiny_bonus = 50;                         // +50%
    game.gameState.tower.highestFloor = 100;                         // +100%
    assert.ok(Math.abs(game.getShinyRate() - ctx.BASE_SHINY_RATE * 2 * 1.5 * 2) < 1e-15);
    // 判定：rng < rate 才闪光
    game.rng = sequenceRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.0]);
    assert.equal(game.createWildPokemon(19, 5).isShiny, true);
    game.rng = sequenceRng([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.9]);
    assert.equal(game.createWildPokemon(19, 5).isShiny, false);
    dispose(game);
});

test('队伍管理：最多 6 只、不能重复、至少保留 1 只、不能移除出战者', () => {
    const { game } = newGame();
    catchRange(game, 1, 10, ivs(0));
    for (const id of [1, 2, 3, 4, 5]) assert.equal(game.addToTeamFromPokedex(id), true);
    assert.equal(game.addToTeamFromPokedex(6), false, '已满 6 只');
    assert.equal(game.addToTeamFromPokedex(5), false, '重复');
    assert.equal(game.addToTeamFromPokedex(151), false, '未捕获');
    assert.equal(game.removeFromTeam(game.gameState.activePokemonIndex), false);
    assert.equal(game.removeFromTeam(1), true);
    assert.equal(game.gameState.team.length, 5);
    dispose(game);
});
