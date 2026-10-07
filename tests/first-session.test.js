'use strict';
// 第 4 阶段：第一次游玩的完整旅程（引导 + 统计 + 反馈数据），以及 PC 整理
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain, createMemoryStorage } = require('./helpers/game');

const expFor = (ctx, id, lv) => ctx.getExpForLevel(ctx.POKEMON_DATA[id].expGroup, lv);
const win = (game, id = 19, level = 3) => game._processVictoryRewards(game.createWildPokemon(id, level, 0), 25, 100, 100);

function journeyGame(seed = 31) {
    const env = newGame({ guide: true, seed });
    const analytics = new env.ctx.Analytics({ storage: createMemoryStorage(), now: Date.now, rng: Math.random });
    env.game.analytics = analytics;
    const events = [];
    env.game.onGuideEvent = (e) => events.push(e);
    return { ...env, analytics, events };
}
const names = (a) => a.state.queue.map(e => e.n);

test('新玩家的第一次游玩：打开 → 第一次操作 → 战斗 → 捕获 → PC → 组队 → 探索 → 进化，统计与引导同步推进', () => {
    const { game, ctx, analytics, events } = journeyGame();
    analytics.startSession({ new_player: true });
    analytics.once('first_action', { via: 'pointerdown' });
    game.startBattle(); game.stopBattle();                 // battle_start

    // 看第一场战斗 + 捕获新伙伴
    win(game, 19);
    game._guideLastUpdate = 0; game.guideUpdate();
    assert.deepEqual(plain(events.map(e => e.id)), ['battle', 'capture']);
    assert.equal(game.getNextAction().id, 'pc');
    assert.equal(game.getNextAction().cta.tab, 'tab-pc');

    // 打开 PC → 组队 → 探索新道路
    game.notePcOpened();
    assert.equal(game.getNextAction().id, 'party');
    assert.equal(game.partyAdd(game.roster.pc.uids()[0]).ok, true);
    assert.equal(game.getNextAction().id, 'explore');
    game.changeRoute('kanto_route2');
    assert.equal(game.gameState.guide.onboarding, 'done');

    // 引导结束后：下一步建议不再是引导
    assert.notEqual(game.getNextAction().type, 'onboarding');

    // 进化
    const pika = game.roster.primaryOf(25);
    pika.level = 21; pika.exp = expFor(ctx, 25, 22) - 3;
    game.addExpToInstance(pika, 5);

    const got = names(analytics);
    for (const n of ['game_open', 'session_start', 'first_action', 'battle_start', 'battle_complete', 'first_capture', 'pc_open', 'route_change', 'onboarding_step', 'evolution']) {
        assert.ok(got.includes(n), `缺少事件 ${n}`);
    }
    // 漏斗顺序：打开 < 第一次操作 < 第一场战斗 < 第一次捕获 < PC < 进化
    const at = (n) => analytics.state.queue.findIndex(e => e.n === n);
    assert.ok(at('game_open') < at('first_action') && at('first_action') < at('battle_start') && at('battle_start') < at('first_capture') && at('first_capture') < at('pc_open') && at('pc_open') < at('evolution'));
    const summary = analytics.getSummary();
    assert.equal(summary.lastStep, 'evolution');
    assert.equal(summary.counters.battles, 1);
    assert.equal(summary.counters.captures, 1);
    assert.equal(summary.counters.evolutions, 1);
    assert.equal(summary.counters.pcOpens, 1);
    assert.equal(summary.secondsToFirst.evolution !== null && summary.secondsToFirst.capture !== null, true);
    // 5 个引导步骤事件
    assert.equal(analytics.state.queue.filter(e => e.n === 'onboarding_step').length, 5);
});

test('卡在第一条道路上：抓齐后下一步建议是“前往新道路”，并带推荐道路和一键前往', () => {
    const { game } = journeyGame();
    game.guideSkipOnboarding();
    assert.equal(game.getNextAction().type !== 'route', true, '还没抓齐时不催着换路');
    game.catchPokemonWithIvs(19, 1, ivs(1)); game.catchPokemonWithIvs(16, 1, ivs(1));
    const a = game.getNextAction();
    assert.equal(a.type, 'route');
    assert.equal(a.cta.route, 'kanto_route2');
    assert.match(a.text, /Rota 2/);
    assert.match(a.text, /2 espécies novas/);
    assert.equal(game.changeRoute(a.cta.route), true);
    assert.notEqual(game.getNextAction().type === 'route' && game.getNextAction().cta.route === 'kanto_route2', true, '去了之后不会再推荐同一条');
});

test('notePcOpened：打开 PC 完成引导步骤，统计 pc_open 每次会话只记一次但计数累加', () => {
    const { game, analytics } = journeyGame();
    analytics.startSession();
    game.notePcOpened(); game.notePcOpened(); game.notePcOpened();
    assert.equal(analytics.state.queue.filter(e => e.n === 'pc_open').length, 1);
    assert.equal(analytics.state.counters.pcOpens, 3);
    assert.equal(game.gameState.guide.flags.pcOpened, true);
});

test('整理重复：闪光、有昵称、队伍里的不受影响；只有一只的物种不动', () => {
    const { game } = newGame();
    const mk = (speciesId, o) => { const r = game.roster.create({ speciesId, rng: () => 0.5, ...o }); assert.ok(r.ok); return r.instance; };
    const weak = mk(16, { level: 3, ivs: ivs(5) });
    const best = mk(16, { level: 9, ivs: ivs(10) });
    const midHighIv = mk(16, { level: 9, ivs: ivs(20) });          // 同级，个体值更高 → 保留这只
    const shiny = mk(16, { level: 1, shiny: true });
    const named = mk(16, { level: 1, nickname: '小波' });
    const solo = mk(19, { level: 4 });
    const preview = game.previewReleaseDuplicates();
    assert.deepEqual(plain([...preview].sort()), plain([weak.uid, best.uid, midHighIv.uid].sort()),
        '波波有闪光和昵称两只受保护的：普通的三只都放生；拉达只有一只，不动');
    assert.ok(!preview.includes(shiny.uid) && !preview.includes(named.uid) && !preview.includes(solo.uid));
});

test('整理重复（无受保护个体）：保留等级最高、同级取个体值最高的一只；队伍里有同种时 PC 里的全部可放生', () => {
    const { game } = newGame();
    const mk = (speciesId, o) => { const r = game.roster.create({ speciesId, rng: () => 0.5, ...o }); assert.ok(r.ok); return r.instance; };
    const a = mk(16, { level: 3, ivs: ivs(5) });
    const b = mk(16, { level: 9, ivs: ivs(10) });
    const c = mk(16, { level: 9, ivs: ivs(20) });
    mk(19, { level: 4 });
    const toRelease = new Set(game.previewReleaseDuplicates());
    assert.deepEqual(plain([...toRelease].sort()), plain([a.uid, b.uid].sort()));
    const r = game.releaseDuplicates();
    assert.equal(r.released, 2);
    assert.equal(game.roster.has(c.uid), true);
    assert.equal(game.roster.countOfSpecies(16), 1);
    assert.equal(game.roster.primaryOf(16), c, '图鉴代表重新指向留下的那只');
    assert.deepEqual(plain(game.roster.checkIntegrity()), []);
    assert.equal(game.releaseDuplicates().released, 0, '再整理一次什么也不会发生');
    // 队伍里有同种：PC 里的同种全部多余
    const d = mk(25, { level: 2 });
    assert.deepEqual(plain(game.previewReleaseDuplicates()), plain([d.uid]));
});

test('整理重复不会碰队伍，也不会让物种消失（图鉴代表、旧视图一致）', () => {
    const { game } = newGame();
    const mk = (speciesId, o) => { const r = game.roster.create({ speciesId, rng: () => 0.5, ...o }); return r.instance; };
    for (let i = 0; i < 10; i++) mk(16, { level: 1 + i, ivs: ivs(i) });
    const before = game.gameState.party.slice();
    game.releaseDuplicates();
    assert.deepEqual(plain(game.gameState.party), plain(before));
    assert.equal(game.roster.countOfSpecies(16), 1);
    assert.equal(game.gameState.caughtPokemon[16], game.roster.primaryOf(16));
    assert.deepEqual(plain(game.roster.checkIntegrity()), []);
});

test('每条道路的进度数据：未抓到的数量随捕获减少；地区解锁进度给出“还差几种”', () => {
    const { game } = newGame();
    const route = game.getRoute('kanto_route2');
    assert.equal(game.getRouteProgress(route).newCount, 4);
    game.catchPokemonWithIvs(10, 1, ivs(1));
    assert.equal(game.getRouteProgress(route).newCount, 3);
    const p = game.getRegionUnlockProgress('johto');
    assert.equal(p.total - p.current, 149, '初始皮卡丘 + 刚抓的绿毛虫，关都 151 种还差 149 种');
});
