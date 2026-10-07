'use strict';
// 第 3 阶段：正常玩法里的“真实捕获”——每次捕获都是一只新的个体
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, catchRange, ivs, perfectIvs, plain, sequenceRng, runOffline } = require('./helpers/game');

const healthy = (game) => assert.deepEqual(plain(game.roster.checkIntegrity()), [], '名册应满足全部不变量');

function wild(game, id, o = {}) {
    // 生成野怪时不动用调用方设置好的随机序列
    const saved = game.rng;
    game.rng = () => 0.5;
    const w = game.createWildPokemon(id, o.level || 5, 0);
    game.rng = saved;
    if (o.ivs) w.ivs = { ...o.ivs };
    w.isShiny = !!o.shiny;
    return w;
}

// 先让物种 id 有一只主个体（Lv1，指定个体值）
function own(game, id, v = 10) {
    game.catchPokemonWithIvs(id, 1, ivs(v));
    return game.roster.primaryOf(id);
}

test('首次捕获：创建个体，带随机性格/性别/特性槽位，来历 wild，放进 PC', () => {
    const { game, ctx } = newGame();
    game.gameState.currentRoute = 'kanto_route1';
    game.rng = sequenceRng([0.5, 0.9, 0.1, 0.9]);       // rollTraits：性格 #12，性别雌，特性槽 a1/hidden 判定
    const events = [];
    game.onCatch = (e) => events.push(e);
    game.processDefeat(wild(game, 16, { ivs: ivs(20) }));
    const inst = game.roster.primaryOf(16);
    assert.ok(inst);
    assert.equal(inst.origin, 'wild');
    assert.equal(inst.level, 1);
    assert.equal(inst.nature, ctx.POKEMON_NATURES[12].id);
    assert.equal(inst.gender, 'female');
    assert.equal(inst.ability, 'a1');
    assert.deepEqual(plain(inst.ivs), ivs(20));
    assert.equal(game.roster.locate(inst.uid).where, 'pc');
    assert.equal(game.gameState.pokedex[16], 'caught');
    assert.equal(events.length, 1);
    assert.equal(events[0].isFirstCatch, true);
    assert.equal(events[0].uid, inst.uid);
    healthy(game);
});

test('首次捕获闪光野怪：个体是闪光，图鉴的闪光记录同步', () => {
    const { game } = newGame();
    game.processDefeat(wild(game, 16, { shiny: true }));
    const inst = game.roster.primaryOf(16);
    assert.equal(inst.shiny, true);
    assert.equal(game.gameState.shinyDex[16], true);
    healthy(game);
});

test('重复捕获（默认策略 all，概率命中）：新增一只独立个体，原个体不变', () => {
    const { game, ctx } = newGame();
    const first = own(game, 16, 10);
    const before = JSON.stringify(first);
    game.rng = sequenceRng([0.01, 0.99, 0.2, 0.7, 0.9]);   // 概率判定 0.01 < 5%，其后是性格/性别/特性
    const events = [];
    game.onCatch = (e) => events.push(e);
    const catchesBefore = game.gameState.stats.totalCatches;
    game.processDefeat(wild(game, 16, { ivs: ivs(25) }));
    assert.equal(game.roster.countOfSpecies(16), 2);
    const second = game.roster.ofSpecies(16).find(i => i.uid !== first.uid);
    assert.notEqual(second.uid, first.uid);
    assert.equal(second.level, 1);
    assert.equal(second.origin, 'wild');
    assert.deepEqual(plain(second.ivs), ivs(25), '新个体有自己的个体值');
    assert.equal(second.nature, ctx.POKEMON_NATURES[Math.floor(0.99 * 25)].id);
    assert.equal(game.roster.locate(second.uid).where, 'pc');
    assert.equal(game.roster.primaryOf(16), first, '图鉴代表仍是第一只');
    // 第一只只受“个体值取高”的旧规则影响（25 > 10）
    assert.deepEqual(plain(first.ivs), ivs(25));
    assert.equal(JSON.stringify({ ...first, ivs: null }), JSON.stringify({ ...JSON.parse(before), ivs: null }));
    assert.equal(game.gameState.stats.totalCatches, catchesBefore + 1);
    assert.equal(events.length, 1);
    assert.equal(events[0].isDuplicate, true);
    assert.equal(events[0].uid, second.uid);
    healthy(game);
});

test('重复捕获（策略 all，概率未命中）：不新增个体，只按旧规则提升主个体个体值', () => {
    const { game } = newGame();
    const first = own(game, 16, 10);
    game.rng = sequenceRng([0.5]);
    game.processDefeat(wild(game, 16, { ivs: ivs(25) }));
    assert.equal(game.roster.countOfSpecies(16), 1);
    assert.deepEqual(plain(first.ivs), ivs(25));
});

test('多次遇到同一物种：长期下来确实会攒出多只，uid 互不相同', () => {
    const { game } = newGame({ seed: 5 });
    own(game, 16, 10);
    for (let i = 0; i < 400; i++) game.processDefeat(wild(game, 16, { ivs: game.generateIVs() }));
    const list = game.roster.ofSpecies(16);
    assert.ok(list.length >= 5 && list.length <= 60, `期望约 20 只，实际 ${list.length}`);
    assert.equal(new Set(list.map(i => i.uid)).size, list.length);
    healthy(game);
});

test('策略 better：只有个体值总和高于所有已有个体才收，且不消耗随机数', () => {
    const { game } = newGame();
    game.gameState.settings = { captureDuplicates: 'better' };
    own(game, 16, 10);
    let draws = 0;
    game.rng = () => { draws++; return 0.5; };
    game.processDefeat(wild(game, 16, { ivs: ivs(10) }));           // 持平：不收
    game.processDefeat(wild(game, 16, { ivs: ivs(5) }));            // 更低：不收
    assert.equal(game.roster.countOfSpecies(16), 1);
    game.processDefeat(wild(game, 16, { ivs: ivs(11) }));           // 更高：收
    assert.equal(game.roster.countOfSpecies(16), 2);
    game.processDefeat(wild(game, 16, { ivs: ivs(11) }));           // 与新个体持平：不收
    assert.equal(game.roster.countOfSpecies(16), 2);
    assert.equal(draws, 4, '只有收下时的特质判定（4 次）消耗随机数');
});

test('策略 off：旧版行为，从不收重复（闪光也不收）', () => {
    const { game } = newGame();
    game.gameState.settings = { captureDuplicates: 'off' };
    own(game, 16, 10);
    let draws = 0;
    game.rng = () => { draws++; return 0.001; };
    game.processDefeat(wild(game, 16, { ivs: ivs(31) }));
    game.processDefeat(wild(game, 16, { ivs: ivs(31), shiny: true }));
    assert.equal(game.roster.countOfSpecies(16), 1);
    assert.equal(draws, 0);
});

test('未知策略值回退到默认（all）', () => {
    const { game } = newGame();
    game.gameState.settings = { captureDuplicates: 'bogus' };
    assert.equal(game.getCaptureDuplicatePolicy(), 'all');
});

test('闪光野怪：不受概率限制，必定收下；没有闪光主个体时它成为图鉴代表，闪光记录传播给进化链', () => {
    const { game } = newGame();
    const first = own(game, 1, 10);                 // 妙蛙种子（非闪光）
    game.rng = sequenceRng([0.99]);                  // 即使概率判定很差，闪光也必收
    const w = wild(game, 1, { ivs: ivs(3), shiny: true });
    game._processVictoryRewards(w, 25, 100, 100);
    const list = game.roster.ofSpecies(1);
    assert.equal(list.length, 2);
    const shiny = list.find(i => i.shiny);
    assert.ok(shiny);
    assert.equal(game.roster.primaryOf(1), shiny, '闪光个体成为图鉴代表（图鉴的闪光记录跟着主个体走）');
    assert.equal(first.shiny, false, '原来那只不会被改成闪光');
    assert.equal(game.gameState.shinyDex[1], true);
    assert.equal(game.gameState.caughtPokemon[1], shiny);
    healthy(game);
});

test('闪光传播：击败闪光野怪后整条进化链都有闪光记录（捕获逻辑先写 shinyDex 也不会漏传）', () => {
    const { game } = newGame();
    game.catchPokemonWithIvs(2, 1, ivs(5));
    own(game, 1, 10);
    game._processVictoryRewards(wild(game, 1, { shiny: true }), 25, 100, 100);
    assert.equal(game.gameState.shinyDex[1], true);
    assert.equal(game.gameState.shinyDex[2], true, '进化链上已拥有的形态也得到闪光记录');
    healthy(game);
});

test('已有闪光主个体时，再遇到闪光：额外收下一只闪光个体，但不改图鉴代表', () => {
    const { game } = newGame();
    const first = own(game, 16, 10);
    first.shiny = true; game.gameState.shinyDex[16] = true;
    game.processDefeat(wild(game, 16, { shiny: true, ivs: ivs(30) }));
    assert.equal(game.roster.countOfSpecies(16), 2);
    assert.equal(game.roster.primaryOf(16), first);
    assert.ok(game.roster.ofSpecies(16).every(i => i.shiny));
});

test('同物种已有 20 只：不再自动收普通重复（不消耗随机数），闪光不受限制', () => {
    const { game, ctx } = newGame();
    own(game, 16, 10);
    while (game.roster.countOfSpecies(16) < ctx.DUPLICATE_SPECIES_CAP) game.roster.create({ speciesId: 16, rng: () => 0.5 });
    let draws = 0;
    game.rng = () => { draws++; return 0.0; };
    game.processDefeat(wild(game, 16, { ivs: ivs(30) }));
    assert.equal(game.roster.countOfSpecies(16), ctx.DUPLICATE_SPECIES_CAP);
    assert.equal(draws, 0);
    game.gameState.settings = { captureDuplicates: 'better' };
    game.processDefeat(wild(game, 16, { ivs: ivs(31) }));
    assert.equal(game.roster.countOfSpecies(16), ctx.DUPLICATE_SPECIES_CAP, 'better 也受上限限制');
    game.processDefeat(wild(game, 16, { shiny: true }));
    assert.equal(game.roster.countOfSpecies(16), ctx.DUPLICATE_SPECIES_CAP + 1, '闪光不受上限限制');
    healthy(game);
});

test('PC 放不下：不收重复；闪光会发出 captureBlocked 事件，名册不变', () => {
    const { game } = newGame();
    own(game, 16, 10);
    game.roster.hasRoom = () => false;
    const events = [];
    game.onBattleEvent = (e, d) => events.push([e, d]);
    game.processDefeat(wild(game, 16, { shiny: true }));
    assert.equal(game.roster.countOfSpecies(16), 1);
    assert.equal(events.filter(e => e[0] === 'captureBlocked').length, 1);
    healthy(game);
});

test('hasRoom：箱子数达到上限且全部装满才是满', () => {
    const { game, ctx } = newGame();
    const boxes = game.gameState.pc.boxes;
    assert.equal(game.roster.hasRoom(), true);
    while (boxes.length < ctx.PC_MAX_BOXES) game.roster.pc.addBox('');
    for (const b of boxes) b.slots.fill('x');
    assert.equal(game.roster.hasRoom(), false);
    boxes[3].slots[7] = null;
    assert.equal(game.roster.hasRoom(), true);
});

test('捕获的个体各自独立：升级、技能、昵称、个体值互不影响', () => {
    const { game, ctx } = newGame();
    const a = own(game, 20, 10);                       // 拉达：没有进化形态，升级不会被进化打断
    game.rng = sequenceRng([0.01, 0.1, 0.1, 0.1, 0.1]);
    game.processDefeat(wild(game, 20, { ivs: perfectIvs() }));
    const b = game.roster.ofSpecies(20).find(i => i.uid !== a.uid);
    game.addExpToInstance(b, ctx.getExpForLevel(ctx.POKEMON_DATA[20].expGroup, 30));
    assert.equal(b.level >= 30, true);
    assert.equal(a.level, 1, '另一只不受影响');
    game.roster.setNickname(b.uid, '小红');
    assert.equal(a.nickname, '');
    b.skillLevel = 5;
    assert.equal(a.skillLevel, 0);
    assert.notDeepEqual(plain(game._getInstanceStats(a)), plain(game._getInstanceStats(b)));
    healthy(game);
});

test('不依赖内部 API：只走战斗胜利流程（_processVictoryRewards）也会攒出同种个体', () => {
    const { game } = newGame({ seed: 9 });
    own(game, 16, 10);
    for (let i = 0; i < 300; i++) {
        game._processVictoryRewards(game.createWildPokemon(16, 5), 25, 100, 100);
    }
    assert.ok(game.roster.countOfSpecies(16) > 1);
    healthy(game);
});

test('图鉴存档（最后一只进化走了）：遇到该物种会收下新的个体并替换存档；策略 off 时只更新存档个体值', () => {
    const { game, ctx } = newGame();
    own(game, 1, 10);
    const base = game.roster.primaryOf(1);
    game.addExpToInstance(base, ctx.getExpForLevel('mediumSlow', 20));      // 妙蛙种子 → 妙蛙草（新登记）
    assert.ok(game.gameState.archivedSpecies[1]);
    game.gameState.settings = { captureDuplicates: 'off' };
    game.processDefeat(wild(game, 1, { ivs: ivs(28) }));
    assert.equal(game.roster.countOfSpecies(1), 0, 'off：不会产生活着的个体');
    assert.deepEqual(plain(game.gameState.archivedSpecies[1].ivs), ivs(28), '存档的个体值按旧规则提升');
    game.gameState.settings = { captureDuplicates: 'all' };
    game.processDefeat(wild(game, 1, { ivs: ivs(12) }));
    assert.equal(game.roster.countOfSpecies(1), 1, '没有活着的个体时直接收下');
    assert.equal(game.gameState.archivedSpecies[1], undefined, '存档被新个体取代');
    assert.equal(game.gameState.caughtPokemon[1], game.roster.primaryOf(1));
    healthy(game);
});

test('离线结算：摘要里统计新收下的个体（含闪光），名册与摘要一致', async () => {
    const { game } = newGame({ seed: 4 });
    const route = game.getRoute(game.gameState.currentRoute);
    for (const p of route.pokemon) own(game, p.id, 5);
    const before = game.roster.count();
    const data = await runOffline(game, 60 * 60 * 1000);
    const s = data.summary;
    assert.ok(Array.isArray(s.duplicateCatches));
    assert.equal(game.roster.count() - before, s.duplicateCatches.length + s.newCatches.length);
    assert.ok(s.duplicateCatches.length > 0, '一小时的战斗应当收下若干只重复个体');
    healthy(game);
});

test('设置：captureDuplicates 会被存档保留，非法值被丢弃', () => {
    const { game, storage } = newGame();
    game.gameState.settings = { captureDuplicates: 'better' };
    game.saveNow();
    const { game: g2 } = newGame({ storage, load: true });
    assert.equal(g2.gameState.settings.captureDuplicates, 'better');
    const { ctx } = newGame();
    const base = JSON.parse(JSON.stringify(game.gameState));
    base.settings = { captureDuplicates: '<script>' };
    const out = ctx.sanitizeSave(base);
    assert.equal(out.ok, true);
    assert.equal(out.state.settings.captureDuplicates, undefined);
    void catchRange;
});
