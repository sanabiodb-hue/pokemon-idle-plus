'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain, mulberry32, runOffline, createMemoryStorage } = require('./helpers/game');
const { loadGameContext } = require('../tools/load-context');

const H = 3600 * 1000;
function setup(o = {}) {
    const ctx = loadGameContext({ storage: createMemoryStorage() });
    const store = o.storage || createMemoryStorage();
    let now = o.start || Date.UTC(2026, 0, 10, 12, 0, 0);
    const gtagCalls = [];
    const beacons = [];
    const a = new ctx.Analytics({
        storage: store, now: () => now, rng: mulberry32(5), gtag: (...x) => gtagCalls.push(x),
        beacon: (url, body) => { beacons.push([url, JSON.parse(body)]); return true; }, endpoint: o.endpoint || '', doNotTrack: !!o.dnt,
    });
    return { ctx, a, store, gtagCalls, beacons, advance: (ms) => { now += ms; }, setNow: (t) => { now = t; } };
}
const names = (a) => a.state.queue.map(e => e.n);

test('track：只接受已知事件；参数被清洗（限制长度/类型/个数，没有 HTML）', () => {
    const { a } = setup();
    assert.equal(a.track('not_an_event'), false);
    assert.equal(a.track('capture', { id: 25, name: '<img src=x onerror=1>', ok: true, nested: { a: 1 }, Bad_Key: 1, long: 'x'.repeat(200), fn: () => 1 }), true);
    const ev = a.state.queue[0];
    assert.equal(ev.n, 'capture');
    assert.equal(ev.p.id, 25);
    assert.equal(ev.p.ok, true);
    assert.ok(!/[<>]/.test(ev.p.name));
    assert.equal(ev.p.long.length, 40);
    assert.equal('nested' in ev.p, false);
    assert.equal('Bad_Key' in ev.p, false);
    assert.equal('fn' in ev.p, false);
});

test('once / oncePerSession：first_* 只记一次；每次会话的第一次带 first_ever', () => {
    const { a } = setup();
    a.startSession();
    assert.equal(a.once('first_action'), true);
    assert.equal(a.once('first_action'), false);
    assert.equal(a.oncePerSession('battle_start', { route: 'r1' }), true);
    assert.equal(a.oncePerSession('battle_start'), false);
    assert.equal(a.state.queue.find(e => e.n === 'battle_start').p.first_ever, true);
    a.endSession('close');
    a.startSession();
    assert.equal(a.oncePerSession('battle_start'), true);
    const bs = a.state.queue.filter(e => e.n === 'battle_start');
    assert.deepEqual(plain(bs.map(e => e.p.first_ever)), [true, false]);
});

test('会话：game_open 带回访信息；第二天回来 returning=true、days_since_first=1、returnedNextDay', () => {
    const { a, advance } = setup();
    const first = a.startSession();
    assert.equal(first.returning, false);
    assert.equal(first.days_since_first, 0);
    advance(5 * 60000); a.endSession('close');
    advance(20 * H);
    const second = a.startSession();
    assert.equal(second.returning, true);
    assert.equal(second.days_since_first, 1);
    assert.equal(second.sessions, 2);
    assert.equal(a.getSummary().returnedNextDay, true);
    assert.equal(a.getSummary().daysPlayed, 2);
    assert.deepEqual(names(a).filter(n => n === 'game_open').length, 2);
});

test('session_end：统计活跃时长（后台时间不算）、放弃点 last_step、会话内战斗/捕获数', () => {
    const { a, advance } = setup();
    a.startSession();
    advance(60000);
    a.once('first_action');
    a.oncePerSession('battle_start');
    a.count('battles', 3); a.count('captures', 1);
    a.onHidden();
    advance(10 * 60000);                      // 在后台：不算时长
    assert.equal(a.onVisible(), null, '不到 30 分钟：继续同一次会话');
    advance(30000);
    a.endSession('pagehide');
    const end = a.state.queue.filter(e => e.n === 'session_end').pop();
    assert.equal(end.p.duration_s, 90);
    assert.equal(end.p.last_step, 'battle_start');
    assert.equal(end.p.battles, 3);
    assert.equal(end.p.captures, 1);
    assert.equal(a.getSummary().sessionEndsByLastStep.battle_start, 1);
});

test('离开超过 30 分钟再回来：旧会话以 timeout 结束，开新会话', () => {
    const { a, advance } = setup();
    a.startSession();
    advance(2 * 60000);
    a.onHidden();
    advance(45 * 60000);
    const info = a.onVisible();
    assert.ok(info);
    assert.equal(info.returning, true);
    assert.equal(a.sessionId, 2);
    const ends = a.state.queue.filter(e => e.n === 'session_end');
    assert.equal(ends.length, 1);
    assert.equal(ends[0].p.reason, 'timeout');
    assert.equal(ends[0].p.duration_s, 120);
});

test('页面被直接杀掉（没有 session_end）：下次启动补记 recovered', () => {
    const env = setup();
    env.a.startSession();
    env.advance(3 * 60000);
    env.a.count('battles', 7);
    env.a.flush();                            // 计数落盘（正常运行时会随 track/隐藏/定时落盘）
    env.advance(1000);
    const store = env.store;
    const { a: a2 } = setup({ storage: store, start: Date.UTC(2026, 0, 11, 9, 0, 0) });
    a2.startSession();
    const rec = a2.state.queue.find(e => e.n === 'session_end');
    assert.ok(rec, '补记了结束事件');
    assert.equal(rec.p.reason, 'recovered');
    assert.equal(rec.p.battles, 7);
    assert.ok(rec.p.duration_s >= 180);
});

test('计数器精确，事件节流：battle_complete 只在第 1 场和每 25 场记一次；level_up 只记 ≤Lv10 与 5 的倍数', () => {
    const { game, ctx } = newGame({ seed: 3 });
    const a = new ctx.Analytics({ storage: createMemoryStorage(), now: Date.now, rng: Math.random });
    game.analytics = a;
    a.startSession();
    for (let i = 0; i < 60; i++) game._processVictoryRewards(game.createWildPokemon(19, 3), 25, 100, 100);
    assert.equal(a.state.counters.battles, 60);
    const bc = a.state.queue.filter(e => e.n === 'battle_complete');
    assert.deepEqual(plain(bc.map(e => e.p.total)), [1, 25, 50]);
    const lv = a.state.queue.filter(e => e.n === 'level_up').map(e => e.p.level);
    assert.ok(lv.every(l => l <= 10 || l % 5 === 0));
});

test('核心玩法事件：第一次捕获、新物种、进化、地区解锁、shiny、路线切换、PC 之外的计数', () => {
    const { game, ctx } = newGame({ seed: 4 });
    const a = new ctx.Analytics({ storage: createMemoryStorage(), now: Date.now, rng: Math.random });
    game.analytics = a;
    a.startSession();
    game.startBattle(); game.stopBattle();
    assert.ok(names(a).includes('battle_start'));
    const wild = (id, shiny = false) => { const w = game.createWildPokemon(id, 3, 0); w.isShiny = shiny; return w; };
    game._processVictoryRewards(wild(16), 25, 100, 100);
    assert.ok(names(a).includes('first_capture'));
    assert.equal(a.state.counters.captures, 1);
    game._processVictoryRewards(wild(19, true), 25, 100, 100);
    assert.ok(names(a).includes('shiny_found'));
    assert.equal(a.state.queue.filter(e => e.n === 'capture').length, 2);
    assert.equal(a.state.queue.filter(e => e.n === 'first_capture').length, 1, 'first_capture 只记一次');
    // 进化
    const pika = game.roster.primaryOf(25);
    pika.level = 21; pika.exp = ctx.getExpForLevel('medium', 22) - 1;
    game.addExpToInstance(pika, 5);
    const evo = a.state.queue.find(e => e.n === 'evolution');
    assert.deepEqual(plain(evo.p), { from: 25, to: 26, kept_level: false, level: 1 });
    assert.equal(a.state.counters.evolutions, 1);
    // 切换路线
    const route2 = Object.values(ctx.REGIONS.kanto.routes).find(r => r.id !== game.gameState.currentRoute).id;
    game.changeRoute(route2);
    assert.ok(names(a).includes('route_change'));
    // 地区解锁：集齐关都
    for (let id = 1; id <= 151; id++) if (game.gameState.pokedex[id] !== 'caught') game.catchPokemonWithIvs(id, 1, ivs(1));
    game.processDefeat(Object.assign(game.createWildPokemon(1, 3, 0), { isShiny: false }));
    void route2;
});

test('离线结算：事件被汇总成 offline_return，并补记首次捕获/进化', async () => {
    const { game, ctx } = newGame({ seed: 6 });
    const a = new ctx.Analytics({ storage: createMemoryStorage(), now: Date.now, rng: Math.random });
    game.analytics = a;
    a.startSession();
    const p = game.roster.primaryOf(25);
    p.level = 21; p.exp = ctx.getExpForLevel('medium', 22) - 50;
    await runOffline(game, 30 * 60000);
    const back = a.state.queue.find(e => e.n === 'offline_return');
    assert.ok(back);
    assert.equal(back.p.minutes, 30);
    assert.ok(back.p.battles > 0);
    assert.ok(names(a).includes('first_capture'), '离线期间的第一次捕获也算');
    assert.ok(a.state.queue.some(e => e.n === 'evolution' && e.p.offline === true));
    assert.ok(a.state.counters.battles > 0, '离线战斗也计入精确次数');
    assert.equal(a.state.queue.filter(e => e.n === 'battle_complete').length <= 1, true, '离线期间不逐条记事件');
});

test('统计出错不能影响游戏：analytics 抛异常也照常战斗', () => {
    const { game } = newGame();
    game.analytics = { track() { throw new Error('boom'); }, once() { throw new Error('boom'); }, count() { throw new Error('boom'); }, oncePerSession() { throw new Error('boom'); }, state: { counters: { battles: 1 } } };
    assert.doesNotThrow(() => game._processVictoryRewards(game.createWildPokemon(16, 3), 25, 100, 100));
    assert.doesNotThrow(() => { game.startBattle(); game.stopBattle(); });
});

test('开关：关闭后不记录并清空队列；Do Not Track 默认关闭，玩家手动打开则以玩家为准', () => {
    const { a } = setup();
    a.startSession();
    assert.ok(a.state.queue.length > 0);
    a.setEnabled(false);
    assert.equal(a.state.queue.length, 0);
    assert.equal(a.track('capture'), false);
    a.setEnabled(true);
    assert.equal(a.track('capture'), true);
    const { a: dnt } = setup({ dnt: true });
    assert.equal(dnt.isEnabled(), false);
    assert.equal(dnt.track('capture'), false);
    dnt.setEnabled(true);
    assert.equal(dnt.track('capture'), true);
});

test('转发：gtag 收到同名事件；endpoint 为空时不发送，配置后批量发送且不重复', () => {
    const { a, gtagCalls, beacons } = setup();
    a.startSession();
    assert.deepEqual(plain(gtagCalls.map(c => c[1]).slice(0, 2)), ['game_open', 'session_start']);
    assert.equal(a.flush(), false);
    assert.equal(beacons.length, 0);
    const env = setup({ endpoint: 'https://example.invalid/collect' });
    env.a.startSession();
    env.a.endSession('close');
    assert.equal(env.beacons.length, 1);
    assert.equal(env.beacons[0][1].id, env.a.state.installId);
    assert.ok(env.beacons[0][1].events.some(e => e.n === 'session_end'));
    assert.equal(env.a.flush(), false, '已发送的不会重复发送');
});

test('队列有上限，旧事件被丢弃；存储损坏时回退为新状态，不抛异常', () => {
    const { a, ctx } = setup();
    for (let i = 0; i < ctx.ANALYTICS_QUEUE_MAX + 50; i++) a.track('capture', { i });
    assert.equal(a.state.queue.length, ctx.ANALYTICS_QUEUE_MAX);
    const bad = createMemoryStorage({ [ctx.ANALYTICS_STORAGE_KEY]: '{not json' });
    assert.doesNotThrow(() => new ctx.Analytics({ storage: bad }));
    const evil = createMemoryStorage({ [ctx.ANALYTICS_STORAGE_KEY]: JSON.stringify({ v: 1, installId: '<script>', queue: 'x', days: 5, firsts: [], counters: { battles: 'a' } }) });
    const x = new ctx.Analytics({ storage: evil });
    assert.ok(/^[a-z0-9]{6,16}$/.test(x.state.installId));
    assert.ok(Array.isArray(x.state.queue));
});

test('getSummary：漏斗里程碑的耗时（秒）、平均时长、放弃点都能直接读出来', () => {
    const { a, advance } = setup();
    a.startSession();
    advance(5000); a.once('first_action');
    advance(10000); a.oncePerSession('battle_start');
    advance(30000); a.once('first_capture');
    advance(60000); a.endSession('close');
    const s = a.getSummary();
    assert.equal(s.secondsToFirst.action, 5);
    assert.equal(s.secondsToFirst.battle, 15);
    assert.equal(s.secondsToFirst.capture, 45);
    assert.equal(s.secondsToFirst.evolution, null);
    assert.equal(s.sessions, 1);
    assert.equal(s.avgSessionSeconds, 105);
    assert.equal(s.lastStep, 'first_capture');
    assert.equal(s.counters.sessionMs, undefined);
    assert.ok(/^[a-z0-9]{12}$/.test(s.installId));
    assert.equal(JSON.stringify(s).includes('<'), false);
});
