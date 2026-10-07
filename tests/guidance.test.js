'use strict';
// 第 4 阶段：新手引导、下一步建议、道路进度、目标
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain, runOffline } = require('./helpers/game');

const expFor = (ctx, id, lv) => ctx.getExpForLevel(ctx.POKEMON_DATA[id].expGroup, lv);
const guided = (o = {}) => newGame({ guide: true, ...o });
const win = (game, id = 19, level = 3) => game._processVictoryRewards(game.createWildPokemon(id, level, 0), 25, 100, 100);
const tick = (game) => { game._guideLastUpdate = 0; };      // 越过“每秒最多检查一次”的节流

test('全新游戏：引导开启，第一步是“看第一场战斗”，下一步建议就是它', () => {
    const { game } = guided();
    assert.equal(game.gameState.guide.onboarding, 'active');
    assert.equal(game.guideCurrentStep().id, 'battle');
    const a = game.getNextAction();
    assert.equal(a.type, 'onboarding');
    assert.equal(a.stepNo, 1);
    assert.equal(a.stepTotal, 5);
    assert.deepEqual(plain(a.progress), { current: 0, total: 1 });
});

test('按玩法完成 5 步：战斗 → 捕获 → PC → 组队 → 探索；每步发经验奖励、触发回调，最后引导结束', () => {
    const { game, ctx } = guided({ seed: 2 });
    const events = [];
    game.onGuideEvent = (e) => events.push(e);
    const pika = game.roster.primaryOf(25);

    win(game, 19);                                     // 第一场胜利（同时捕获小拉达 → 2 种）
    tick(game); game.guideUpdate();
    assert.deepEqual(plain(events.map(e => e.id)), ['battle', 'capture']);
    assert.ok(events.every(e => e.exp > 0));
    assert.equal(game.guideCurrentStep().id, 'pc');

    game.guideNote('pcOpened');                        // 打开了 PC 页面
    assert.equal(events.at(-1).id, 'pc');
    assert.equal(game.guideCurrentStep().id, 'party');
    const second = game.roster.pc.uids()[0];
    assert.equal(game.partyAdd(second).ok, true);      // 加入队伍（服务内部会触发检查）
    assert.equal(events.at(-1).id, 'party');
    assert.equal(game.guideCurrentStep().id, 'explore');

    game.changeRoute('kanto_route2');
    assert.equal(events.at(-1).id, 'explore');
    assert.equal(events.at(-1).last, true);
    assert.equal(game.gameState.guide.onboarding, 'done');
    assert.equal(game.guideCurrentStep(), null);
    assert.equal(events.length, 5);
    assert.ok(pika.exp > expFor(ctx, 25, 5), '奖励经验发到了出战宝可梦身上');
});

test('奖励有上限：一次不超过出战宝可梦升一级所需经验；没有出战宝可梦等级上限时也不会出错', () => {
    const { game, ctx } = guided();
    const pika = game.roster.primaryOf(25);
    const need = expFor(ctx, 25, 6) - expFor(ctx, 25, 5);
    const before = pika.exp;
    const amount = game._guideReward(1);
    assert.equal(amount, need);
    assert.equal(pika.exp - before, need);
    pika.level = ctx.MAX_POKEMON_LEVEL;
    assert.equal(game._guideReward(1), 0);
});

test('乱序也能识别：已经完成的后续步骤，到那一步时一并结算（不会卡在“打开 PC”）', () => {
    const { game } = guided({ seed: 3 });
    const events = [];
    game.onGuideEvent = (e) => events.push(e.id);
    game.guideNote('pcOpened');                        // 先打开了 PC（此时前面的步骤还没完成）
    game.guideNote('routeChanged');
    assert.deepEqual(plain(events), [], '一步一步来：当前步（战斗）没完成，后面的不结算');
    win(game, 19);
    tick(game); game.guideUpdate();
    assert.deepEqual(plain(events), ['battle', 'capture', 'pc']);
    assert.equal(game.guideCurrentStep().id, 'party');
});

test('跳过引导：之后不再给步骤，目标仍然正常工作；也可以重新开始', () => {
    const { game } = guided();
    assert.equal(game.guideSkipOnboarding(), true);
    assert.equal(game.gameState.guide.onboarding, 'skipped');
    assert.equal(game.guideCurrentStep(), null);
    assert.notEqual(game.getNextAction().type, 'onboarding');
    assert.equal(game.guideSkipOnboarding(), false);
    game.guideRestartOnboarding();
    assert.equal(game.guideCurrentStep().id, 'battle');
});

test('老存档（没有 guide 字段）：有进度就视为老玩家，直接跳过引导，且已满足的目标不会读档就一起弹奖励', () => {
    const { game, ctx, storage } = guided();
    for (let id = 1; id <= 30; id++) if (!game.gameState.caughtPokemon[id]) game.catchPokemonWithIvs(id, 1, ivs(3));
    game.gameState.stats.totalBattles = 300;
    delete game.gameState.guide;
    game.gameState.currentEnemy = null;
    game.saveNow();
    const { game: g2 } = guided({ storage, load: true });
    const events = [];
    g2.onGuideEvent = (e) => events.push(e);
    assert.equal(g2.gameState.guide.onboarding, 'done');
    assert.ok(g2.gameState.guide.claimed.catch_25 && g2.gameState.guide.claimed.win_200);
    g2.guideUpdate({ force: true });
    assert.deepEqual(plain(events), []);
    void ctx;
});

test('存档里的引导进度被保留；非法字段被丢弃（白名单重建）', () => {
    const { game, ctx, storage } = guided({ seed: 2 });
    win(game, 19);
    tick(game); game.guideUpdate();
    game.gameState.currentEnemy = null;
    game.saveNow();
    const { game: g2 } = guided({ storage, load: true });
    assert.deepEqual(plain(g2.gameState.guide), plain(game.gameState.guide));
    const out = ctx.sanitizeGuideState({ onboarding: 'hacked', steps: { battle: 5, evil: 1, __proto__: { x: 1 } }, flags: { pcOpened: 'yes', routeChanged: true }, claimed: { catch_10: 3, nope: 1 }, counters: { evolutions: -5 } });
    assert.equal(out.onboarding, 'active');
    assert.deepEqual(plain(out.steps), { battle: 5 });
    assert.deepEqual(plain(out.flags), { pcOpened: false, routeChanged: true });
    assert.deepEqual(plain(out.claimed), { catch_10: 3 });
    assert.equal(out.counters.evolutions, 0);
    assert.equal(ctx.sanitizeGuideState('junk'), null);
    assert.equal(Object.prototype.x, undefined);
});

test('guideNote 只接受已知的标记（__proto__ 之类被忽略）', () => {
    const { game } = guided();
    game.guideNote('__proto__');
    game.guideNote('constructor');
    game.guideNote('nonsense');
    assert.equal(Object.keys(game.gameState.guide.flags).sort().join(), 'pcOpened,routeChanged');
});

test('道路进度：每条道路一共几种、抓到几种、还缺哪些', () => {
    const { game } = guided();
    const r1 = game.getRoute('kanto_route1');
    assert.deepEqual(plain(game.getRouteProgress(r1)), { total: 2, caught: 0, missing: [19, 16], newCount: 2 });
    game.catchPokemonWithIvs(19, 1, ivs(1));
    assert.deepEqual(plain(game.getRouteProgress(r1)), { total: 2, caught: 1, missing: [16], newCount: 1 });
});

test('推荐道路：当前道路抓齐后，推荐下一条有新宝可梦且等级打得过的；等级差太多时退而求其次', () => {
    const { game } = guided();
    game.catchPokemonWithIvs(19, 1, ivs(1)); game.catchPokemonWithIvs(16, 1, ivs(1));
    const rec = game.getRecommendedRoute();
    assert.equal(rec.route.id, 'kanto_route2');
    assert.equal(rec.progress.newCount, 2);
    // 玩家只有 Lv5：常磐森林(11~15)要求 ≤ 5*1.5+5=12.5 → 也算可以去，但排在第 2 条之后
    game.changeRoute('kanto_route2');
    game.catchPokemonWithIvs(10, 1, ivs(1)); game.catchPokemonWithIvs(13, 1, ivs(1));
    assert.equal(game.getRecommendedRoute().route.id, 'kanto_viridian_forest');
    // 集齐关都图鉴 → 城都解锁，推荐它的道路；城都也抓齐后再没有可推荐的（图鉴范围之外的地区仍未解锁）
    const gs = game.gameState;
    for (let id = 1; id <= 251; id++) gs.pokedex[id] = 'caught';
    for (let id = 252; id <= 1073; id++) delete gs.pokedex[id];
    const rec2 = game.getRecommendedRoute();
    assert.ok(rec2 === null || rec2.regionId !== 'kanto');
});

test('下一步建议的优先级：引导 > 当前道路抓齐 > 即将进化 > 最接近完成的目标', () => {
    const { game, ctx } = guided();
    game.guideSkipOnboarding();
    // 当前道路没抓齐 → 不是 route；有即将进化的队伍成员 → evolution
    const pika = game.roster.primaryOf(25);
    pika.level = 20; pika.exp = expFor(ctx, 25, 20);
    let a = game.getNextAction();
    assert.equal(a.type, 'evolution');
    assert.match(a.text, /Faltam 2 níveis/);
    assert.match(a.text, /volta para o Lv\.1/, '新登记的形态会提醒“回到 Lv.1”');
    // 道路抓齐 → route，且带“前往”快捷入口
    game.catchPokemonWithIvs(19, 1, ivs(1)); game.catchPokemonWithIvs(16, 1, ivs(1));
    a = game.getNextAction();
    assert.equal(a.type, 'route');
    assert.equal(a.cta.route, 'kanto_route2');
    // 雷丘已登记：保留等级的文案
    game.changeRoute('kanto_route2');
    game.catchPokemonWithIvs(10, 1, ivs(1)); game.catchPokemonWithIvs(13, 1, ivs(1));
    game.catchPokemonWithIvs(26, 1, ivs(1));
    game.changeRoute('kanto_route1');
    for (const id of [10, 13]) game.gameState.pokedex[id] = 'caught';
    a = game.getNextAction();
    assert.equal(a.type, 'route');
    pika.level = 1; pika.exp = 0;
    game.changeRoute('kanto_route2');
    pika.level = 20; pika.exp = expFor(ctx, 25, 20);
    a = game.getNextAction();
    assert.equal(a.type, 'route', '当前道路(2号)也已抓齐 → 仍然优先推荐新道路');
});

test('没有别的事可做时给出目标：显示最接近完成的目标和进度', () => {
    const { game } = guided();
    game.guideSkipOnboarding();
    game.gameState.stats.totalBattles = 40;          // win_50 完成度 80%
    const a = game.getNextAction();
    assert.equal(a.type, 'goal');
    assert.equal(a.title, 'Vença 50 batalhas');
    assert.deepEqual(plain(a.progress), { current: 40, total: 50 });
});

test('目标达成自动发奖励，只发一次；读档后不会重复发', () => {
    const { game, storage } = guided();
    game.guideSkipOnboarding();
    const events = [];
    game.onGuideEvent = (e) => events.push(e);
    game.gameState.stats.totalBattles = 60;
    game.guideUpdate({ force: true });
    const ids = events.map(e => e.id);
    assert.ok(ids.includes('win_50'));
    assert.ok(events.every(e => e.kind === 'goal' && e.exp > 0));
    game.guideUpdate({ force: true });
    assert.equal(events.length, ids.length, '再检查一次不会重复发');
    game.gameState.currentEnemy = null;
    game.saveNow();
    const { game: g2 } = guided({ storage, load: true });
    const again = [];
    g2.onGuideEvent = (e) => again.push(e);
    g2.guideUpdate({ force: true });
    assert.deepEqual(plain(again), []);
});

test('目标列表：带进度，并把“下一个未解锁地区”作为一个目标（进度 = 图鉴）', () => {
    const { game } = guided();
    const goals = game.getGoals();
    assert.ok(goals.length >= 15);
    const region = goals.find(g => g.region);
    assert.equal(region.id, 'unlock_johto');
    assert.equal(region.target, 151);
    assert.equal(region.current, 1);
    assert.ok(goals.every(g => g.ratio >= 0 && g.ratio <= 1 && g.current <= g.target));
});

test('进化目标：进化一次后完成；老存档里已经有进化形态的也算', () => {
    const { game, ctx } = guided();
    game.guideSkipOnboarding();
    const ev = [];
    game.onGuideEvent = (e) => ev.push(e.id);
    const pika = game.roster.primaryOf(25);
    pika.level = 21; pika.exp = expFor(ctx, 25, 22) - 3;
    game.addExpToInstance(pika, 5);
    assert.equal(game.gameState.guide.counters.evolutions, 1);
    game.guideUpdate({ force: true });
    assert.ok(ev.includes('evolve_first'));
});

test('离线结算结束后会统一检查引导/目标', async () => {
    const { game } = guided({ seed: 9 });
    const ev = [];
    game.onGuideEvent = (e) => ev.push(e.id);
    await runOffline(game, 20 * 60000);
    assert.ok(ev.includes('battle') && ev.includes('capture'));
});

test('一次引导检查不会递归（奖励升级触发进化等也不会重入）', () => {
    const { game, ctx } = guided();
    const pika = game.roster.primaryOf(25);
    pika.level = 21; pika.exp = expFor(ctx, 25, 22) - 1;
    let depth = 0, max = 0;
    const orig = game.guideUpdate.bind(game);
    game.guideUpdate = (o) => { depth++; max = Math.max(max, depth); try { return orig(o); } finally { depth--; } };
    win(game, 19);
    tick(game); game.guideUpdate();
    assert.ok(max <= 2);
});
