'use strict';
// Fase 5A · B0: relógio injetável + EventBus
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain, runOffline } = require('./helpers/game');

const expFor = (ctx, id, lv) => ctx.getExpForLevel(ctx.POKEMON_DATA[id].expGroup, lv);

// ---------------------------------------------------------------- ManualClock
test('ManualClock：advance 按到期顺序触发计时器，回调里新建的计时器在窗口内也会触发', () => {
    const { ctx } = newGame();
    const c = new ctx.ManualClock(1000);
    const log = [];
    c.setTimer(() => log.push('b@' + c.now()), 200);
    c.setTimer(() => { log.push('a@' + c.now()); c.setTimer(() => log.push('nested@' + c.now()), 50); }, 100);
    c.setTimer(() => log.push('late@' + c.now()), 5000);
    assert.equal(c.advance(300), 1300);
    assert.deepEqual(plain(log), ['a@1100', 'nested@1150', 'b@1200']);
    assert.equal(c.pendingTimers(), 1);
    c.advance(10000);
    assert.equal(log.at(-1), 'late@6000');
});

test('ManualClock：clearTimer 取消；同一时刻按创建顺序；advance(0) 触发已到期的', () => {
    const { ctx } = newGame();
    const c = new ctx.ManualClock();
    const out = [];
    const id = c.setTimer(() => out.push('x'), 10);
    c.setTimer(() => out.push('1'), 20);
    c.setTimer(() => out.push('2'), 20);
    c.setTimer(() => out.push('now'), 0);
    c.clearTimer(id);
    c.advance(0);
    assert.deepEqual(plain(out), ['now']);
    c.advance(20);
    assert.deepEqual(plain(out), ['now', '1', '2']);
});

test('SystemClock 与 Date.now 一致', () => {
    const { ctx } = newGame();
    const c = new ctx.SystemClock();
    const a = Date.now(); const t = c.now(); const b = Date.now();
    assert.ok(t >= a - 5 && t <= b + 5);
});

// ---------------------------------------------------------------- EventBus
test('EventBus：订阅/取消/once/通配符，事件带 seq、type、t 与载荷', () => {
    const { ctx } = newGame();
    let now = 5;
    const bus = new ctx.EventBus({ now: () => now });
    const got = [], all = [];
    const off = bus.on('battle_started', (e) => got.push(e));
    bus.on('*', (e) => all.push(e.type));
    bus.once('heal', (e) => got.push('once:' + e.amount));
    const e1 = bus.emit('battle_started', { route: 'r1' });
    now = 9;
    bus.emit('heal', { amount: 3 });
    bus.emit('heal', { amount: 4 });
    assert.deepEqual(plain(e1), { seq: 1, type: 'battle_started', t: 5, route: 'r1' });
    assert.deepEqual(plain(got.map(g => typeof g === 'string' ? g : g.route)), ['r1', 'once:3']);
    assert.deepEqual(plain(all), ['battle_started', 'heal', 'heal']);
    off();
    bus.emit('battle_started', {});
    assert.equal(got.length, 2, '取消订阅后不再收到');
});

test('EventBus：只接受登记过的事件名（拼错被拒绝并计数）；on 拼错直接报错', () => {
    const { ctx } = newGame();
    const bus = new ctx.EventBus();
    assert.equal(bus.emit('battle_startd', {}), null);
    assert.equal(bus.stats.rejected, 1);
    assert.throws(() => bus.on('nope', () => {}), /未知事件/);
    assert.throws(() => bus.on('heal', 'x'), /需要函数/);
    assert.ok(ctx.AUTOMATION_EVENT_TYPES.includes('automation_decision'));
    for (const n of ['hunt_started', 'hunt_stopped', 'battle_started', 'battle_completed', 'pokemon_defeated', 'capture_attempted',
        'pokemon_captured', 'xp_gained', 'level_up', 'evolution', 'heal', 'route_changed', 'automation_decision', 'automation_error']) {
        assert.ok(ctx.AUTOMATION_EVENT_TYPES.includes(n), n);
    }
});

test('EventBus：订阅者抛异常不影响其他订阅者和发出者；环形缓冲有上限；recent 可过滤', () => {
    const { ctx } = newGame();
    const errors = [];
    const bus = new ctx.EventBus({ capacity: 5, onError: (e) => errors.push(e.message) });
    const ok = [];
    bus.on('heal', () => { throw new Error('boom'); });
    bus.on('heal', (e) => ok.push(e.n));
    for (let i = 0; i < 8; i++) bus.emit('heal', { n: i });
    bus.emit('hunt_started', {});
    assert.deepEqual(plain(ok), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(bus.stats.subscriberErrors, 8);
    assert.equal(errors.length, 8);
    assert.equal(bus.recent(100).length, 5, '缓冲只留最近 5 条');
    assert.deepEqual(plain(bus.recent(10, 'hunt_started').map(e => e.type)), ['hunt_started']);
    assert.deepEqual(plain(bus.recent(10, (e) => e.n === 7).map(e => e.n)), [7]);
    bus.clear();
    assert.equal(bus.recent().length, 0);
});

test('EventBus：回调里取消订阅是安全的', () => {
    const { ctx } = newGame();
    const bus = new ctx.EventBus();
    let n = 0;
    const off = bus.on('heal', () => { n++; off(); });
    bus.on('heal', () => { n += 10; });
    bus.emit('heal', {}); bus.emit('heal', {});
    assert.equal(n, 21);
});

// ---------------------------------------------------------------- 核心使用注入的时钟
test('GameCore 使用注入的时钟：战斗计时、UID、速率跟踪都来自 clock.now()', () => {
    const { game, ctx } = newGame();
    const clock = new ctx.ManualClock(1_700_000_000_000);
    game.clock = clock;
    assert.equal(game.now(), 1_700_000_000_000);
    game.startBattle(); game.stopBattle();
    assert.equal(game.currentBattle.lastTick, 1_700_000_000_000);
    clock.advance(5000);
    assert.equal(game.now(), 1_700_000_005_000);
    assert.ok(game.generateUID().includes((1_700_000_005_000).toString(36)), 'UID 里的时间戳来自注入的时钟');
    game.resetRateTracker();
    game._updateRateTracker(10, 5);
    assert.equal(game.rateTracker.startTime, 1_700_000_005_000);
    // battleTick 的 delta 用的是注入的时钟：推进 100ms 再 tick，玩家计时器恰好增加 100
    const b = game.currentBattle;
    b.playerTimer = 0; b.enemyTimer = 0;
    clock.advance(100);
    game.rng = () => 0.99;
    game.battleTick();
    assert.equal(b.lastTick, 1_700_000_005_100);
    assert.equal(game.roster._now(), 1_700_000_005_100, '名册的时间戳也来自同一个时钟');
});

// ---------------------------------------------------------------- 核心发出事件
const win = (game, id = 19, level = 3) => game._processVictoryRewards(game.createWildPokemon(id, level, 0), 25, 100, 100);

test('核心发出内部事件：battle_started → pokemon_defeated → xp_gained → battle_completed（与旧回调并行）', () => {
    const { game } = newGame({ seed: 2 });
    const seen = [];
    game.bus.on('*', (e) => seen.push(e));
    const legacy = [];
    game.onBattleEvent = (e) => legacy.push(e);
    game.startBattle(); game.stopBattle();
    win(game, 19);
    const types = seen.map(e => e.type);
    const core = types.filter(t => ['battle_started', 'xp_gained', 'pokemon_defeated', 'battle_completed'].includes(t));
    assert.deepEqual(plain(core), ['battle_started', 'xp_gained', 'pokemon_defeated', 'battle_completed']);
    assert.ok(types.indexOf('capture_attempted') > types.indexOf('pokemon_defeated'), '捕获决定发生在击败之后');
    const started = seen[0];
    assert.equal(started.route, 'kanto_route1');
    assert.ok(started.enemyId && started.enemyLevel);
    const xp = seen.find(e => e.type === 'xp_gained');
    assert.ok(xp.amount > 0);
    assert.equal(xp.uid, game.roster.party.activeUid());
    const done = seen.find(e => e.type === 'battle_completed');
    assert.equal(done.result, 'victory');
    assert.equal(done.xp, xp.amount);
    assert.ok(legacy.includes('start'), '旧回调仍然工作');
    assert.equal(seen.every(e => !e.offline), true);
});

test('level_up / evolution / route_changed 事件', () => {
    const { game, ctx } = newGame();
    const seen = [];
    game.bus.on('*', (e) => seen.push(e));
    const pika = game.roster.primaryOf(25);
    pika.level = 21; pika.exp = expFor(ctx, 25, 22) - 1;
    game.addExpToInstance(pika, 5);
    assert.ok(seen.some(e => e.type === 'level_up' && e.uid === pika.uid && e.from === 21));
    const evo = seen.find(e => e.type === 'evolution');
    assert.deepEqual(plain({ from: evo.from, to: evo.to, keptLevel: evo.keptLevel }), { from: 25, to: 26, keptLevel: false });
    game.changeRoute('kanto_route2');
    const rc = seen.find(e => e.type === 'route_changed');
    assert.deepEqual(plain({ route: rc.route, from: rc.from, reason: rc.reason }), { route: 'kanto_route2', from: 'kanto_route1', reason: 'manual' });
    game.changeRoute('kanto_route2');
    assert.equal(seen.filter(e => e.type === 'route_changed').length, 1, '没变就不发');
});

test('离线结算：没有订阅者时不构造事件；有订阅者时事件带 offline 标记', async () => {
    const a = newGame({ seed: 4 });
    await runOffline(a.game, 10 * 60 * 1000);
    // 离线结束时重启在线战斗会发 1 条 battle_started；结算本身不应产生任何事件
    assert.ok(a.game.bus.stats.emitted <= 1, '无订阅者：离线期间零事件开销');
    assert.ok(a.game.bus.recent().every(e => e.type === 'battle_started' && !e.offline));
    const b = newGame({ seed: 4 });
    const seen = [];
    b.game.bus.on('battle_completed', (e) => seen.push(e));
    await runOffline(b.game, 10 * 60 * 1000);
    assert.ok(seen.length > 50);
    assert.ok(seen.every(e => e.offline === true));
});

test('总线不改变游戏结果：同种子下有无订阅者，战斗结果逐项一致', () => {
    const run = (subscribe) => {
        const { game } = newGame({ seed: 77 });
        if (subscribe) game.bus.on('*', () => {});
        for (let i = 0; i < 40; i++) win(game, [16, 19, 10][i % 3], 4);
        return plain({ stats: game.gameState.stats, owned: Object.keys(game.gameState.ownedPokemon).length, exp: game.roster.primaryOf(25).exp });
    };
    assert.deepEqual(run(false), run(true));
});
