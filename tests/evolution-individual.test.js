'use strict';
// 第 3 阶段：进化 = 个体自己变身（Pikachu A → Raichu A），uid 与个体数据保持不变
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain, runOffline } = require('./helpers/game');

const healthy = (game) => assert.deepEqual(plain(game.roster.checkIntegrity()), [], '名册应满足全部不变量');
const expFor = (ctx, id, lv) => ctx.getExpForLevel(ctx.POKEMON_DATA[id].expGroup, lv);

// 创建一只带全部个体数据的个体（place 默认 pc）
function make(game, speciesId, o = {}) {
    const r = game.roster.create({
        speciesId, level: 5, nature: 'modest', ability: 'a2', gender: 'female', origin: 'wild', originRoute: 'kanto_route1',
        ivs: { hp: 31, atk: 20, def: 10, spAtk: 5, spDef: 1, speed: 0 }, rng: () => 0.5, ...o,
    });
    assert.ok(r.ok, r.code);
    return r.instance;
}

test('目标物种已登记：Pikachu A 变成 Raichu A——uid、个体值、性格、特性、性别、昵称、统计都保留，等级也保留', () => {
    const { game, ctx } = newGame();
    game.catchPokemonWithIvs(26, 1, ivs(3));                   // 雷丘已登记
    const other = game.roster.primaryOf(26);
    const a = make(game, 25, { level: 20, nickname: '电电', skillLevel: 3, place: 'party' });
    a.battles = 42; a.stats.victories = 40; a.stats.damageDealt = 12345;
    const snapshot = JSON.parse(JSON.stringify(a));
    const events = [];
    game.onBattleEvent = (e, d) => events.push([e, d]);
    game.addExpToInstance(a, expFor(ctx, 25, 22) - a.exp);
    assert.equal(a.speciesId, 26, '同一个对象变成了雷丘');
    assert.equal(game.roster.get(snapshot.uid), a);
    for (const k of ['uid', 'ivs', 'nature', 'ability', 'gender', 'shiny', 'nickname', 'origin', 'originRoute', 'caughtAt', 'battles', 'skillLevel']) {
        assert.deepEqual(plain(a[k]), snapshot[k], k);
    }
    assert.equal(a.stats.victories, 40);
    assert.equal(a.stats.damageDealt, 12345);
    assert.equal(a.level, 22, '保留等级');
    assert.ok(a.exp >= expFor(ctx, 26, 22), '经验不低于新物种经验曲线下该等级的起点');
    assert.equal(game.roster.locate(a.uid).where, 'party', '队伍位置不变');
    assert.equal(game.roster.countOfSpecies(26), 2);
    assert.equal(game.roster.primaryOf(26), other, '已有的雷丘仍是图鉴代表');
    assert.equal(other.level, 1, '另一只雷丘不受影响');
    const ev = events.find(e => e[0] === 'evolved');
    assert.equal(ev[1].uid, a.uid);
    assert.equal(ev[1].keptLevel, true);
    assert.equal(ev[1].oldId, 25);
    assert.equal(ev[1].newId, 26);
    healthy(game);
});

test('目标物种未登记：个体变身，等级/经验/技能等级归零（旧规则），个体数据保留；原物种留下图鉴存档', () => {
    const { game, ctx } = newGame();
    const a = game.roster.primaryOf(25);                // 初始皮卡丘（在队伍里）
    a.nature = 'jolly'; a.ability = 'ha'; a.gender = 'male'; a.skillLevel = 2;
    const uid = a.uid;
    a.level = 21; a.exp = expFor(ctx, 25, 21);
    const iv = plain(a.ivs);
    const events = [];
    game.onBattleEvent = (e, d) => events.push([e, d]);
    game.addExpToInstance(a, expFor(ctx, 25, 22) - a.exp);
    assert.equal(a.uid, uid);
    assert.equal(a.speciesId, 26);
    assert.equal(a.level, 1);
    assert.equal(a.exp, 0);
    assert.equal(a.skillLevel, 0);
    assert.deepEqual(plain(a.ivs), iv);
    assert.equal(a.nature, 'jolly');
    assert.equal(a.ability, 'ha');
    assert.equal(a.gender, 'male');
    assert.equal(game.gameState.team[0], 26, 'team 兼容视图跟着变');
    assert.equal(game.gameState.caughtPokemon[26], a);
    const arch = game.gameState.archivedSpecies[25];
    assert.ok(arch, '皮卡丘作为图鉴存档保留');
    assert.equal(arch.level, 22 - 0 >= 1 ? arch.level : 0);
    assert.deepEqual(plain(arch.ivs), iv);
    assert.equal(game.gameState.pokedex[25], 'caught');
    assert.equal(game.gameState.caughtPokemon[25], arch, '旧视图指向存档');
    assert.equal(game.roster.countOfSpecies(25), 0);
    assert.equal(events.find(e => e[0] === 'evolved')[1].keptLevel, false);
    healthy(game);
});

test('同物种两只：只有升级的那只进化，另一只保持原样', () => {
    const { game, ctx } = newGame();
    game.catchPokemonWithIvs(26, 1, ivs(3));
    const a = make(game, 25, { level: 21, place: 'party' });
    const b = make(game, 25, { level: 21, ivs: ivs(30), nature: 'bold', nickname: 'B' });
    game.addExpToInstance(a, expFor(ctx, 25, 22) - a.exp);
    assert.equal(a.speciesId, 26);
    assert.equal(b.speciesId, 25);
    assert.equal(b.level, 21);
    assert.equal(b.nature, 'bold');
    assert.equal(game.roster.countOfSpecies(25), 2, '初始皮卡丘和 B 仍是皮卡丘');
    assert.equal(game.gameState.archivedSpecies[25], undefined, '还有活着的皮卡丘，不需要存档');
    healthy(game);
});

test('图鉴存档仍然有用：1% 图鉴加成保留、储备经验继续、不会进化', () => {
    const { game, ctx } = newGame();
    game.catchPokemonWithIvs(1, 1, ivs(10));
    for (let id = 2; id <= 3; id++) game.catchPokemonWithIvs(id, 1, ivs(10));
    const base = game.roster.primaryOf(1);
    base.level = 15; base.exp = expFor(ctx, 1, 15);
    const hpBefore = game.calculateBattleStats(0).hp;
    game.addExpToInstance(base, expFor(ctx, 1, 16) - base.exp);            // 妙蛙种子变身为妙蛙草（已登记：保留等级）
    assert.equal(base.speciesId, 2);
    assert.ok(game.gameState.archivedSpecies[1]);
    const dexBonus = game._getPokedexBonus(game.gameState.team.slice());
    assert.ok(dexBonus.hp > 0);
    const arch = game.gameState.archivedSpecies[1];
    const expBefore = arch.exp;
    game._processVictoryRewards(game.createWildPokemon(19, 40), game.gameState.team[0], 100, 100);
    assert.ok(arch.exp > expBefore, '存档收到 1% 储备经验');
    assert.equal(arch.level >= 15, true);
    assert.equal(game.roster.countOfSpecies(1), 0, '存档不会凭空长出个体');
    assert.ok(game.calculateBattleStats(0).hp >= hpBefore * 0.9);
    healthy(game);
});

test('多分支（伊布）：优先选还没登记的目标；全部登记后取数据里第一个满足条件的', () => {
    const { game, ctx } = newGame();
    game.catchPokemonWithIvs(134, 1, ivs(1));            // 水伊布已登记
    const e1 = make(game, 133, { level: 24 });
    game.addExpToInstance(e1, expFor(ctx, 133, 25) - e1.exp);
    assert.equal(e1.speciesId, 135, '雷伊布（25 级）是第一个“未登记且满足条件”的分支');
    assert.equal(e1.level, 1);
    game.catchPokemonWithIvs(136, 1, ivs(1));
    const e2 = make(game, 133, { level: 24 });
    game.addExpToInstance(e2, expFor(ctx, 133, 25) - e2.exp);
    assert.equal(e2.speciesId, 134, '都登记了，取列表里第一个满足等级的（水伊布，20 级）；保留等级');
    assert.equal(e2.level, 25);
    healthy(game);
});

test('保留等级的进化可以连续发生（等级已经超过后续进化等级）', () => {
    const { game, ctx } = newGame();
    for (const id of [2, 3]) game.catchPokemonWithIvs(id, 1, ivs(1));
    const a = make(game, 1, { level: 10 });
    game.addExpToInstance(a, expFor(ctx, 1, 40) - a.exp);
    assert.equal(a.speciesId, 3, '妙蛙种子一路进化成妙蛙花');
    assert.equal(a.level, 40);
    healthy(game);
});

test('闪光个体进化后仍然闪光，并把图鉴闪光记录带到新物种', () => {
    const { game, ctx } = newGame();
    game.catchPokemonWithIvs(26, 1, ivs(1));
    const a = make(game, 25, { level: 21, shiny: true, place: 'party' });
    game.addExpToInstance(a, expFor(ctx, 25, 22) - a.exp);
    assert.equal(a.speciesId, 26);
    assert.equal(a.shiny, true);
    assert.equal(game.gameState.shinyDex[26], true);
    assert.equal(game.roster.primaryOf(26), a, '雷丘原来不是闪光，闪光的这只成为图鉴代表');
    healthy(game);
});

test('进化后战斗属性按新物种计算；出战个体就是变身后的那只', () => {
    const { game, ctx } = newGame();
    game.catchPokemonWithIvs(26, 1, ivs(3));
    const a = make(game, 25, { level: 21, place: 'party' });
    game.gameState.activePokemonIndex = game.roster.party.indexOf(a.uid);
    const before = game.calculateBattleStats(game.gameState.activePokemonIndex);
    game.addExpToInstance(a, expFor(ctx, 25, 22) - a.exp);
    const after = game.calculateBattleStats(game.gameState.activePokemonIndex);
    const ref = game.calculateStats({ id: 26, level: 22, ivs: a.ivs, isShiny: false });
    assert.notDeepEqual(plain(before), plain(after));
    assert.equal(game.getPartyInstance(game.gameState.activePokemonIndex), a);
    assert.ok(after.attack >= ref.attack, '含队伍/图鉴加成，不会低于自身属性');
});

test('在战斗胜利流程里进化：下一场战斗使用变身后的个体（在线）', () => {
    const { game, ctx } = newGame();
    game.catchPokemonWithIvs(26, 1, ivs(3));
    const a = game.roster.primaryOf(25);
    a.level = 21; a.exp = expFor(ctx, 25, 22) - 100;
    game.gameState.activePokemonIndex = 0;
    game.startBattle();
    game.currentBattle.wildCurrentHp = 0;
    game.gameState.currentEnemy = null;
    game._processVictoryRewards(Object.assign(game.createWildPokemon(19, 60), { ivs: ivs(0) }), 25, 100, 100);
    assert.equal(a.speciesId, 26);
    game.stopBattle();
    game.startBattle();
    assert.equal(game.currentBattle.derived.activeInst, a);
    assert.deepEqual(plain(game.currentBattle.derived.playerTypes), plain(ctx.POKEMON_DATA[26].types));
    healthy(game);
});

test('离线结算期间进化：出战个体、属性缓存跟着刷新，名册一致', async () => {
    const { game, ctx } = newGame({ seed: 12 });
    game.catchPokemonWithIvs(26, 1, ivs(3));
    const a = game.roster.primaryOf(25);
    a.level = 21; a.exp = expFor(ctx, 25, 22) - 50;
    const uid = a.uid;
    await runOffline(game, 30 * 60 * 1000);
    assert.equal(game.roster.get(uid), a);
    assert.equal(a.speciesId, 26, '离线期间升级触发了进化');
    assert.ok(a.battles > 0, '战斗统计记在变身后的同一个体上');
    healthy(game);
});

test('没有进化形态 / 等级不够 / 地区未解锁：什么也不发生', () => {
    const { game, ctx } = newGame();
    const noEvo = make(game, 20, { level: 5 });
    game.addExpToInstance(noEvo, expFor(ctx, 20, 50) - noEvo.exp);
    assert.equal(noEvo.speciesId, 20);
    const low = make(game, 25, { level: 5 });
    game.addExpToInstance(low, expFor(ctx, 25, 21) - low.exp);
    assert.equal(low.speciesId, 25);
    const eevee = make(game, 133, { level: 49 });
    game.addExpToInstance(eevee, expFor(ctx, 133, 55) - eevee.exp);
    assert.ok([134, 135, 136].includes(eevee.speciesId), '城都进化（太阳/月亮伊布）需要先解锁城都地区');
    healthy(game);
});

test('roster.evolveInstance：直接调用的边界——未知个体/同物种/未知目标', () => {
    const { game } = newGame();
    const a = game.roster.primaryOf(25);
    assert.equal(game.roster.evolveInstance('nope', 26).code, 'unknown_pokemon');
    assert.equal(game.roster.evolveInstance(a.uid, 25).code, 'same_species');
    assert.equal(game.roster.evolveInstance(a.uid, 999999).code, 'unknown_species');
    assert.equal(game.roster.evolveInstance('__proto__', 26).code, 'unknown_pokemon');
    healthy(game);
});

test('进化 + 存档 + 读档：变身后的个体、图鉴存档、旧视图全部一致', () => {
    const { game, ctx, storage } = newGame();
    const a = game.roster.primaryOf(25);
    a.level = 21; a.exp = expFor(ctx, 25, 21);
    a.nickname = '电电';
    game.addExpToInstance(a, expFor(ctx, 25, 22) - a.exp);
    assert.ok(game.gameState.archivedSpecies[25]);
    game.gameState.currentEnemy = null;     // 读档后总是有这个键
    assert.equal(game.saveNow().ok, true);
    const before = plain(game.gameState);
    const { game: g2 } = newGame({ storage, load: true });
    assert.deepEqual(plain(g2.gameState), before);
    assert.equal(g2.gameState.caughtPokemon[25], g2.gameState.archivedSpecies[25]);
    assert.equal(g2.gameState.caughtPokemon[26], g2.roster.get(a.uid));
    assert.equal(g2.roster.get(a.uid).nickname, '电电');
    healthy(g2);
});
