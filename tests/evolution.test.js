'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, dispose, catchRange, ivs, plain } = require('./helpers/game');

test('进化链工具：基础形态与全部后续形态', () => {
    const { game } = newGame();
    assert.equal(game.getBasePokemonId(3), 1);
    assert.equal(game.getBasePokemonId(1), 1);
    assert.deepEqual(plain(game.getAllEvolutions(1)), [2, 3]);
    assert.deepEqual(plain(game.getAllEvolutions(3)), []);
    // 分支进化：臭臭花 → 霸王花 / 美丽花
    assert.deepEqual(plain(game.getAllEvolutions(44)).sort((a, b) => a - b), [45, 182]);
    dispose(game);
});

test('升级到进化等级：生成 Lv1 的进化形态，继承个体值，并替换队伍成员', () => {
    const { game, ctx } = newGame();
    game.catchPokemonWithIvs(1, 5, { hp: 31, atk: 20, def: 10, spAtk: 5, spDef: 1, speed: 0 });
    game.gameState.team = [1];
    game.gameState.activePokemonIndex = 0;
    const events = [];
    game.onBattleEvent = (e, d) => events.push([e, d]);
    game.addExpToPokemon(1, ctx.getExpForLevel('mediumSlow', 16));
    assert.equal(game.gameState.caughtPokemon[1].level, 16);
    const evo = game.gameState.caughtPokemon[2];
    assert.ok(evo, '应得到妙蛙草');
    assert.equal(evo.level, 1);
    assert.deepEqual(plain(evo.ivs), { hp: 31, atk: 20, def: 10, spAtk: 5, spDef: 1, speed: 0 });
    assert.equal(game.gameState.pokedex[2], 'caught');
    assert.deepEqual(plain(game.gameState.team), [2]);
    const ev = events.find(e => e[0] === 'evolved');
    assert.ok(ev);
    assert.equal(ev[1].oldId, 1);
    assert.equal(ev[1].newId, 2);
    dispose(game);
});

test('未到进化等级不进化', () => {
    const { game, ctx } = newGame();
    game.catchPokemonWithIvs(1, 5, ivs(1));
    game.addExpToPokemon(1, ctx.getExpForLevel('mediumSlow', 15));
    assert.equal(game.gameState.caughtPokemon[2], undefined);
    dispose(game);
});

test('捕获时若等级已达标（checkEvolutionOnCatch）不会替换队伍', () => {
    const { game } = newGame();
    game.catchPokemonWithIvs(1, 20, ivs(1));
    // catchPokemonWithIvs 以传入等级存储；进化检查按存储等级判断
    assert.ok(game.gameState.caughtPokemon[2], '等级 20 ≥ 16，应已生成妙蛙草');
    assert.deepEqual(plain(game.gameState.team), [25]);
    dispose(game);
});

test('闪光会沿进化链传播（基础形态 → 进化形态）', () => {
    const { game, ctx } = newGame();
    game.catchPokemonWithIvs(1, 5, ivs(1));
    game.gameState.shinyDex[1] = true;
    game._touchSpecies(1);
    game.addExpToPokemon(1, ctx.getExpForLevel('mediumSlow', 16));
    assert.equal(game.gameState.shinyDex[2], true);
    dispose(game);
});

test('跨世代进化受地区解锁限制（金/银世代的超音蝠 → 叉字蝠）', () => {
    const { game, ctx } = newGame();
    game.catchPokemonWithIvs(42, 41, ivs(1));            // 大嘴蝠，进化目标 169 属于城都
    game.addExpToPokemon(42, ctx.getExpForLevel('medium', 42));
    assert.equal(game.gameState.caughtPokemon[169], undefined, '城都未解锁，不应进化');
    assert.equal(game._isEvolutionRegionUnlocked(169), false);
    assert.equal(game._isEvolutionRegionUnlocked(10), true);

    catchRange(game, 1, 151, ivs(0));                    // 集齐关都 → 解锁城都
    assert.equal(game._isEvolutionRegionUnlocked(169), true);
    game.checkEvolution(42);
    assert.ok(game.gameState.caughtPokemon[169], '解锁后应可进化');
    dispose(game);
});

test('进化目标所在区间与 REGION_POKEDEX_RANGES 一致（边界编号）', () => {
    const { game, ctx } = newGame();
    for (const [region, [a, b]] of Object.entries(ctx.REGION_POKEDEX_RANGES)) {
        const unlocked = game.isRegionUnlocked(region);
        assert.equal(game._isEvolutionRegionUnlocked(a), unlocked, `${region} 起点 #${a}`);
        assert.equal(game._isEvolutionRegionUnlocked(b), unlocked, `${region} 终点 #${b}`);
    }
    dispose(game);
});

test('同进化链个体值取每项最大值', () => {
    const { game } = newGame();
    game.catchPokemonWithIvs(1, 5, { hp: 10, atk: 31, def: 0, spAtk: 0, spDef: 0, speed: 0 });
    game.catchPokemonWithIvs(2, 1, { hp: 31, atk: 5, def: 7, spAtk: 0, spDef: 0, speed: 0 });
    for (const id of [1, 2]) {
        const iv = plain(game.gameState.caughtPokemon[id].ivs);
        assert.equal(iv.hp, 31);
        assert.equal(iv.atk, 31);
        assert.equal(iv.def, 7);
    }
    dispose(game);
});
