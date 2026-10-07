'use strict';
// 第 3 阶段：主循环端到端——
//   捕获 → 捕获重复 → 一只放进队伍 → 另一只留在 PC → 战斗 → 获得经验 → 进化 → 保存 → 重新加载
// 全程只走真实玩法路径（battleTick / 胜利结算 / 队伍与 PC 服务），不直接改个体数据。
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain, runOffline } = require('./helpers/game');

const healthy = (game) => assert.deepEqual(plain(game.roster.checkIntegrity()), [], '名册应满足全部不变量');

// 用真正的战斗循环击败一只指定的野生宝可梦
function defeatInBattle(game, wild) {
    game.gameState.currentEnemy = wild;
    game.startBattle();
    game.stopBattle();
    const b = game.currentBattle;
    b.wildCurrentHp = 1;
    b.playerTimer = b.playerNextAttack;      // 立即出手
    b.enemyTimer = 0;
    const saved = game.rng;
    game.rng = () => 0.99;                   // 战斗里的随机（暴击/闪避/伤害浮动）固定；捕获判定由策略决定
    game.battleTick();
    game.rng = saved;
    game.stopBattle();
    assert.equal(game.gameState.currentEnemy, null, '敌人被击败');
}

function wildOf(game, id, level, ivSet, shiny = false) {
    const saved = game.rng;
    game.rng = () => 0.5;
    const w = game.createWildPokemon(id, level, 0);
    game.rng = saved;
    w.ivs = { ...ivSet };
    w.isShiny = shiny;
    return w;
}

test('主循环：捕获 → 捕获重复 → 队伍/PC → 战斗升级 → 进化 → 保存 → 重新加载，全程一致', () => {
    const { game, ctx, storage } = newGame({ seed: 77 });
    game.gameState.settings = { captureDuplicates: 'better' };      // 个体值更高就必收：结果不依赖运气
    const events = [];
    game.onBattleEvent = (e, d) => events.push([e, d]);
    game.onCatch = (c) => events.push(['catch', c]);

    // 1) 捕获：第一只绿毛虫
    defeatInBattle(game, wildOf(game, 10, 3, ivs(8)));
    const first = game.roster.primaryOf(10);
    assert.ok(first, '第一只被捕获');
    assert.equal(game.roster.locate(first.uid).where, 'pc');

    // 2) 捕获重复：更高个体值的第二只——必须是另一只个体，有自己的 uid
    defeatInBattle(game, wildOf(game, 10, 3, ivs(20)));
    const list = game.roster.ofSpecies(10);
    assert.equal(list.length, 2);
    const second = list.find(i => i.uid !== first.uid);
    assert.notEqual(second.uid, first.uid);
    assert.deepEqual(plain(second.ivs), ivs(20), '第二只有自己的个体值');
    assert.equal(events.filter(e => e[0] === 'catch' && e[1].isDuplicate).length, 1);

    // 3) 一只放进队伍，另一只留在 PC（用界面用的服务）
    assert.equal(game.partyAdd(first.uid).ok, true);
    assert.equal(game.roster.locate(first.uid).where, 'party');
    assert.equal(game.roster.locate(second.uid).where, 'pc');
    game.renamePokemon(first.uid, '毛毛');
    const firstIvsAfterCatch = plain(first.ivs);

    // 4) 战斗获得经验：队伍里的绿毛虫和皮卡丘一起升级；PC 里的那只没有上场
    let guard = 0;
    while (first.speciesId === 10 && guard++ < 300) {
        defeatInBattle(game, wildOf(game, 19, 40, ivs(5)));
    }

    // 5) 进化：同一只个体变成铁甲蛹（图鉴里还没有）——uid、昵称、个体值不变，等级归零
    assert.equal(first.speciesId, 11, '队伍里的那只绿毛虫进化了');
    assert.equal(first.nickname, '毛毛');
    assert.deepEqual(plain(first.ivs), firstIvsAfterCatch, '进化不改个体值');
    assert.equal(game.roster.get(first.uid), first);
    assert.equal(game.roster.locate(first.uid).where, 'party');
    assert.equal(second.speciesId, 10, 'PC 里的另一只仍是绿毛虫');
    assert.equal(second.battles, 0);
    assert.equal(second.stats.victories, 0, 'PC 里的那只没有参加过战斗');
    assert.equal(game.gameState.caughtPokemon[10], second, '绿毛虫的图鉴代表换成了还活着的那只');
    assert.equal(game.gameState.caughtPokemon[11], first);
    assert.ok(events.some(e => e[0] === 'evolved' && e[1].uid === first.uid && e[1].oldId === 10 && e[1].newId === 11));
    healthy(game);

    // 6) 保存 → 重新加载：所有个体、位置、昵称、图鉴代表一致
    game.gameState.currentEnemy = null;
    assert.equal(game.saveNow().ok, true);
    const before = plain(game.gameState);
    const { game: g2 } = newGame({ storage, load: true });
    assert.deepEqual(plain(g2.gameState), before, '读档后的状态与保存前逐项一致');
    assert.equal(g2.roster.get(first.uid).speciesId, 11);
    assert.equal(g2.roster.get(first.uid).nickname, '毛毛');
    assert.equal(g2.roster.locate(first.uid).where, 'party');
    assert.equal(g2.roster.locate(second.uid).where, 'pc');
    assert.equal(g2.gameState.caughtPokemon[10], g2.roster.get(second.uid));
    assert.equal(g2.gameState.caughtPokemon[11], g2.roster.get(first.uid));
    healthy(g2);

    // 7) 读档后继续玩：仍然可以战斗、获得经验、捕获，uid 不重复
    const lv = g2.roster.get(first.uid).exp;
    defeatInBattle(g2, wildOf(g2, 19, 40, ivs(5)));
    assert.ok(g2.roster.get(first.uid).exp > lv);
    defeatInBattle(g2, wildOf(g2, 10, 3, ivs(31)));
    const uids = Object.keys(g2.gameState.ownedPokemon);
    assert.equal(new Set(uids).size, uids.length);
    assert.equal(g2.roster.countOfSpecies(10), 2, '读档后又捕获了一只更好的（原来那只留在 PC）');
    healthy(g2);
    void ctx;
});

test('主循环（最后一只进化走）：原物种留作图鉴存档，保存/加载后依旧；再次遇到会重新收下', () => {
    const { game, storage } = newGame({ seed: 5 });
    defeatInBattle(game, wildOf(game, 10, 3, ivs(8)));
    const only = game.roster.primaryOf(10);
    assert.equal(game.partyAdd(only.uid).ok, true);
    let guard = 0;
    while (only.speciesId === 10 && guard++ < 300) defeatInBattle(game, wildOf(game, 19, 40, ivs(5)));
    assert.equal(only.speciesId, 11);
    assert.ok(game.gameState.archivedSpecies[10], '绿毛虫留作图鉴存档');
    assert.equal(game.gameState.pokedex[10], 'caught');
    game.gameState.currentEnemy = null;
    game.saveNow();
    const { game: g2 } = newGame({ storage, load: true });
    assert.deepEqual(plain(g2.gameState.archivedSpecies), plain(game.gameState.archivedSpecies));
    healthy(g2);
    defeatInBattle(g2, wildOf(g2, 10, 3, ivs(12)));
    assert.equal(g2.roster.countOfSpecies(10), 1, '再次遇到绿毛虫，收下一只新的');
    assert.equal(g2.gameState.archivedSpecies[10], undefined);
    healthy(g2);
});

test('主循环（离线）：离线期间捕获、升级、进化后保存/加载，一致', async () => {
    const { game, storage } = newGame({ seed: 21 });
    const route = game.getRoute(game.gameState.currentRoute);
    for (const p of route.pokemon) game.catchPokemonWithIvs(p.id, 1, ivs(3));
    const before = game.roster.count();
    await runOffline(game, 60 * 60 * 1000);
    assert.ok(game.roster.count() > before, '离线期间捕获了重复个体');
    healthy(game);
    game.gameState.currentEnemy = null;
    game.saveNow();
    const snap = plain(game.gameState);
    const { game: g2 } = newGame({ storage, load: true });
    assert.deepEqual(plain(g2.gameState), snap);
    healthy(g2);
});

test('同种多只都带着自己的个体数据存档并读回：IV/性格/特性/性别/闪光/等级/XP/昵称各不相同', () => {
    const { game, storage } = newGame({ seed: 8 });
    game.catchPokemonWithIvs(20, 1, ivs(5));
    const traits = [
        { nature: 'jolly', ability: 'a1', gender: 'male', shiny: false, level: 12, ivs: ivs(1), nickname: 'A' },
        { nature: 'calm', ability: 'ha', gender: 'female', shiny: true, level: 40, ivs: ivs(30), nickname: 'B' },
        { nature: 'quirky', ability: 'a2', gender: null, shiny: false, level: 3, ivs: ivs(17), nickname: '' },
    ];
    for (const t of traits) assert.ok(game.roster.create({ speciesId: 20, ...t, rng: () => 0.5 }).ok);
    game.gameState.currentEnemy = null;
    game.saveNow();
    const { game: g2 } = newGame({ storage, load: true });
    const got = g2.roster.ofSpecies(20).filter(i => i.origin !== 'wild');
    assert.equal(got.length, 3);
    for (const t of traits) {
        const i = got.find(x => x.nickname === t.nickname && x.level === t.level);
        assert.ok(i, t.nickname);
        assert.equal(i.nature, t.nature);
        assert.equal(i.ability, t.ability);
        assert.equal(i.gender, t.gender);
        assert.equal(i.shiny, t.shiny);
        assert.deepEqual(plain(i.ivs), plain(t.ivs));
    }
    healthy(g2);
});
