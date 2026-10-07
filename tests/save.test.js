'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newGame, catchRange, ivs, plain, mulberry32, createMemoryStorage } = require('./helpers/game');
const { fakeClock } = require('./helpers/clock');

const FIX = path.join(__dirname, 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

// 构造一个“什么都有”的存档状态，用来验证清洗/迁移不丢合法数据
function richGame(seed = 5) {
    const env = newGame({ seed });
    const { game, ctx } = env;
    const gs = game.gameState;
    catchRange(game, 1, 40, ivs(7));
    game.addToTeamFromPokedex(4);
    game.addToTeamFromPokedex(7);
    gs.shinyDex[25] = true;
    gs.pokedexDisplay[25] = 'shiny';
    gs.gold = 123456;
    gs.stats.totalBattles = 77;
    gs.stats.totalExp = 99999;
    gs.settings = { autoSwitchBest: true, oneShotStrategy: 'no_change', autoRouteSwitch: true, routeSwitchCondition: '6v_only', theme: 'ocean' };
    gs.badges.kanto = { unlocked: true, gem: game.generateGemByQuality('legendary') };
    gs.gems = ctx.GEM_QUALITIES.map(q => game.generateGemByQuality(q.id));
    gs.gems[1].locked = true;
    gs.gems[2].isNew = true;
    gs.berryPlots = [{ berryId: 'hp_berry', plantedAt: Date.now() - 1000 }];
    gs.berryBag = { atk_berry: 3, def_berry: 1 };
    gs.berryFed = { 25: { atk_berry: 2 } };
    gs.talents = { exp_bonus: 12, shiny_bonus: 3, gemAttrChoice: 'dodge_rate' };
    gs.tower = { currentFloor: 4, highestFloor: 3, enemies: [150, 151, 249, 250, 384, 385], currentEnemyIndex: 2, inBattle: false };
    gs.currentEnemy = game.generateWildPokemon(game.getRoute('kanto_route3'));
    gs.battleHp = { playerHp: 50, playerMaxHp: 100, enemyHp: 20, playerTimer: 100, enemyTimer: 200 };
    gs.caughtPokemon[25].skillLevel = 3;
    return env;
}

// ---------------------------------------------------------------- 往返

test('存档往返：写入再读取，所有合法数据逐项一致', () => {
    const { game, storage, ctx } = richGame();
    const r = game.saveNow();
    assert.equal(r.ok, true);
    const before = plain(game.gameState);

    const { game: g2 } = newGame({ storage, load: true });
    assert.equal(g2.loadReport.ok, true);
    assert.equal(g2.loadReport.source, 'main');
    assert.equal(g2.loadReport.recovered, false);
    assert.deepEqual(plain(g2.gameState), before);
    assert.equal(g2.gameState.schemaVersion, ctx.SAVE_SCHEMA_VERSION);
    assert.deepEqual(plain(g2.loadReport.warnings), []);
});

test('新存档带 schemaVersion，并保持旧的 LZ: 存储格式', () => {
    const { game, storage, ctx } = newGame();
    game.saveNow();
    const raw = storage.getItem('pokemon_idle_save');
    assert.ok(raw.startsWith('LZ:'));
    const obj = JSON.parse(ctx.LZString.decompressFromUTF16(raw.slice(3)));
    assert.equal(obj.schemaVersion, ctx.SAVE_SCHEMA_VERSION);
    assert.ok(Array.isArray(obj.team));
});

// ---------------------------------------------------------------- 旧版兼容（真实旧版代码生成的夹具）

test('兼容：旧版（重构前）写入 localStorage 的真实存档可无损读取并迁移', () => {
    const summary = JSON.parse(read('legacy-summary.json'));
    const storage = createMemoryStorage({ pokemon_idle_save: read('legacy-localstorage.txt') });
    const { game, ctx } = newGame({ storage, load: true });
    const rep = game.loadReport;
    assert.equal(rep.ok, true, rep.error);
    assert.equal(rep.fromVersion, 1, '旧存档无 schemaVersion，应视为 v1');
    const gs = plain(game.gameState);
    assert.equal(gs.schemaVersion, ctx.SAVE_SCHEMA_VERSION);
    assert.deepEqual(gs.team, summary.team);
    assert.equal(gs.activePokemonIndex, summary.activePokemonIndex);
    assert.equal(Object.keys(gs.caughtPokemon).length, summary.caughtCount);
    assert.equal(Object.values(gs.pokedex).filter(v => v === 'caught').length, summary.pokedexCaught);
    assert.equal(gs.gold, summary.gold);
    assert.deepEqual(gs.stats, summary.stats);
    assert.deepEqual(Object.keys(gs.shinyDex).map(Number), summary.shinyDex);
    assert.equal(gs.gems.length, summary.gemCount);
    assert.deepEqual(Object.keys(gs.badges), summary.badges);
    assert.equal(gs.badges.kanto.gem && gs.badges.kanto.gem.quality, summary.equippedGemQuality);
    assert.equal(gs.berryPlots.length, summary.berryPlots);
    assert.deepEqual(gs.berryBag, summary.berryBag);
    assert.deepEqual(gs.berryFed, summary.berryFed);
    assert.deepEqual(gs.talents, summary.talents);
    assert.deepEqual(gs.tower, summary.tower);
    assert.deepEqual(gs.settings, summary.settings);
    assert.equal(gs.currentRoute, summary.currentRoute);
    assert.equal(gs.currentEnemy.id, summary.currentEnemyId);
    assert.equal(Object.values(gs.caughtPokemon).reduce((a, c) => a + c.level, 0), summary.totalLevels);
    assert.deepEqual(plain(rep.warnings), [], '合法的旧存档不应产生任何修正警告');
    // 读取旧存档时保留一份迁移前副本，便于回退
    assert.ok(storage.getItem(ctx.SAVE_PREMIGRATION_PREFIX + '1'), '应保留迁移前副本');
    // 迁移后再次保存，应写成新版本
    game.saveNow();
    const { game: g2 } = newGame({ storage, load: true });
    assert.equal(g2.loadReport.fromVersion, ctx.SAVE_SCHEMA_VERSION);   // 迁移后重新保存即为当前版本
});

test('兼容：旧版“导出存档”文本可以导入', () => {
    const summary = JSON.parse(read('legacy-summary.json'));
    const { game } = newGame();
    const res = game.importSave(read('legacy-export.txt'));
    assert.equal(res.success, true, res.message);
    assert.equal(res.fromVersion, 1);
    assert.equal(Object.keys(game.gameState.caughtPokemon).length, summary.caughtCount);
    assert.deepEqual(plain(game.gameState.team), summary.team);
});

test('兼容：更老的未压缩纯 JSON 存档、缺少新字段也能读取', () => {
    const { game } = richGame();
    const legacy = plain(game.gameState);
    for (const k of ['schemaVersion', 'tower', 'berryPlots', 'berryBag', 'berryFed', 'talents', 'badges', 'gems', 'shinyDex', 'pokedexDisplay', 'stats', 'settings']) delete legacy[k];
    for (const id in legacy.caughtPokemon) delete legacy.caughtPokemon[id].skillLevel;
    const storage = createMemoryStorage({ pokemon_idle_save: JSON.stringify(legacy) });
    const { game: g2 } = newGame({ storage, load: true });
    assert.equal(g2.loadReport.ok, true, g2.loadReport.error);
    const gs = g2.gameState;
    assert.deepEqual(plain(gs.tower), { currentFloor: 1, highestFloor: 0, enemies: null, currentEnemyIndex: 0, inBattle: false });
    assert.equal(gs.caughtPokemon[25].skillLevel, 0);
    assert.deepEqual(plain(gs.gems), []);
    assert.deepEqual(plain(gs.berryPlots), []);
});

// ---------------------------------------------------------------- 校验与恢复

test('损坏的主存档：自动从最新备份恢复，并保留损坏副本', () => {
    const clock = fakeClock();
    const { ctx, storage } = newGame();
    const states = [1, 2, 3].map(n => { const { game } = richGame(n); game.gameState.gold = n * 1000; return plain(game._prepareStateForSave()); });
    const sm = new ctx.SaveManager({ storage, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, getState: () => null });
    sm.write(states[0]);
    clock.advance(ctx.SAVE_BACKUP_INTERVAL_MS + 1);
    sm.write(states[1]);                    // 此时 bak1 = 第 1 份
    clock.advance(ctx.SAVE_BACKUP_INTERVAL_MS + 1);
    sm.write(states[2]);                    // bak1 = 第 2 份，bak2 = 第 1 份
    storage.setItem('pokemon_idle_save', 'LZ:这不是有效数据');
    const r = sm.load();
    assert.equal(r.ok, true);
    assert.equal(r.recovered, true);
    assert.equal(r.source, 'backup1');
    assert.equal(r.state.gold, 2000);
    assert.equal(r.failures.length, 1);
    assert.equal(r.failures[0].source, 'main');
    assert.equal(storage.getItem(ctx.SAVE_CORRUPT_KEY), 'LZ:这不是有效数据', '损坏的原文必须保留，不能被覆盖');
});

test('主存档与全部备份都损坏：读档失败并给出原因，原文保留', () => {
    const { ctx, storage, game } = newGame();
    game.saveNow();
    game.saver.backupNow(true);
    storage.setItem('pokemon_idle_save', '{"oops":');
    for (const key of ctx.SAVE_BACKUP_KEYS) storage.setItem(key, 'garbage');
    const { game: g2 } = newGame({ storage, load: true });
    assert.equal(g2.loadReport.ok, false);
    assert.equal(g2.loadReport.empty, false);
    assert.ok(g2.loadReport.failures.length >= 2);
    assert.ok(g2.loadReport.error);
    assert.equal(storage.getItem(ctx.SAVE_CORRUPT_KEY), '{"oops":');
});

test('空存储：视为全新游戏（不是错误）', () => {
    const { game } = newGame({ load: true });
    assert.equal(game.loadReport.empty, true);
    assert.ok(game.gameState.team.length >= 1);
});

test('版本比当前新：拒绝加载（不会被静默降级），原文保留', () => {
    const { game, ctx, storage } = newGame();
    const future = plain(game._prepareStateForSave());
    future.schemaVersion = ctx.SAVE_SCHEMA_VERSION + 5;
    const raw = ctx.SaveCodec.encodePayload(JSON.stringify(future));
    storage.setItem('pokemon_idle_save', raw);
    const sm = new ctx.SaveManager({ storage });
    const r = sm.load();
    assert.equal(r.ok, false);
    assert.equal(r.failures[0].code, 'newer_version');
    assert.equal(storage.getItem(ctx.SAVE_CORRUPT_KEY), raw);
});

test('迁移框架：缺少迁移步骤时明确报错；多步迁移按顺序执行', () => {
    const { ctx } = newGame();
    // 注：SAVE_MIGRATIONS 是 const，但对象本身可变，测试里临时插入一个假的 v0
    const fn = ctx.SAVE_MIGRATIONS;
    assert.equal(typeof fn[1], 'function');
    assert.throws(() => ctx.migrateSave({ schemaVersion: 99 }), /更新版本/);
    const m = ctx.migrateSave({ team: [25], tower: { enemies: [{ id: 1 }, { id: 2 }], inBattle: true } });
    assert.equal(m.fromVersion, 1);
    assert.equal(m.toVersion, ctx.SAVE_SCHEMA_VERSION);
    assert.deepEqual(plain(m.data.tower.enemies), [1, 2]);
    assert.equal(m.data.tower.inBattle, false);
});

test('读档校验：队伍成员必须是已捕获的有效宝可梦', () => {
    const { game, ctx } = richGame();
    const bad = plain(game._prepareStateForSave());
    bad.team = [999999, 'abc', null, 25, 25, 4];
    const r = ctx.processSaveObject(bad);
    assert.equal(r.ok, true);
    assert.deepEqual(plain(r.state.team), [25, 4]);
    bad.team = [999999];
    assert.equal(ctx.processSaveObject(bad).ok, false);
    assert.equal(ctx.processSaveObject({ team: [] }).ok, false);
    assert.equal(ctx.processSaveObject(null).ok, false);
    assert.equal(ctx.processSaveObject([1, 2]).ok, false);
});

test('读档校验：lastSave 在未来会被修正（防止改系统时间刷离线收益）', () => {
    const { game, ctx } = newGame();
    const s = plain(game._prepareStateForSave());
    s.lastSave = Date.now() + 10 * 24 * 3600 * 1000;
    const r = ctx.processSaveObject(s);
    assert.ok(r.state.lastSave <= Date.now());
    assert.ok(r.warnings.some(w => w.includes('晚于当前时间')));
});

// ---------------------------------------------------------------- 备份轮转

test('备份轮转：间隔内不重复备份，超过间隔后依次轮转，最多保留 3 份', () => {
    const clock = fakeClock();
    const { ctx } = newGame();
    const storage = createMemoryStorage();
    const sm = new ctx.SaveManager({ storage, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    const mk = (n) => { const { game } = newGame({ seed: n }); game.gameState.gold = n; return plain(game._prepareStateForSave()); };
    const goldOf = (key) => ctx.SaveCodec.decodePayload(storage.getItem(key)).gold;

    sm.write(mk(1));
    assert.equal(storage.getItem(ctx.SAVE_BACKUP_KEYS[0]), null, '第一次写入没有可备份的旧存档');
    sm.write(mk(2));
    assert.equal(goldOf(ctx.SAVE_BACKUP_KEYS[0]), 1, '首次有旧存档时立刻备份');
    clock.advance(60 * 1000);
    sm.write(mk(3));
    assert.equal(goldOf(ctx.SAVE_BACKUP_KEYS[0]), 1, '间隔不足 10 分钟，备份不应更新');
    for (const n of [4, 5, 6, 7]) {
        clock.advance(ctx.SAVE_BACKUP_INTERVAL_MS + 1);
        sm.write(mk(n));
    }
    assert.equal(goldOf('pokemon_idle_save'), 7);
    assert.equal(goldOf(ctx.SAVE_BACKUP_KEYS[0]), 6);
    assert.equal(goldOf(ctx.SAVE_BACKUP_KEYS[1]), 5);
    assert.equal(goldOf(ctx.SAVE_BACKUP_KEYS[2]), 4);
    assert.equal(storage.getItem(ctx.SAVE_BACKUP_KEYS[2] + '1'), null, '不会超过 3 份');
});

test('损坏的主存档不会被轮转进备份，挤掉好备份', () => {
    const clock = fakeClock();
    const { ctx, storage, game } = newGame();
    const sm = new ctx.SaveManager({ storage, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    sm.write(plain(game._prepareStateForSave()));
    sm.write(plain(game._prepareStateForSave()));            // 产生 bak1（好）
    const good = storage.getItem(ctx.SAVE_BACKUP_KEYS[0]);
    storage.setItem('pokemon_idle_save', 'LZ:坏掉了');
    clock.advance(ctx.SAVE_BACKUP_INTERVAL_MS + 1);
    sm.write(plain(game._prepareStateForSave()));
    assert.equal(storage.getItem(ctx.SAVE_BACKUP_KEYS[0]), good);
});

// ---------------------------------------------------------------- 防抖

test('防抖：多次 save() 合并为一次写入；最迟 10 秒必写；无变更不写', () => {
    const clock = fakeClock();
    const { game, ctx, storage } = newGame();
    storage.writes.length = 0;
    game.saver = new ctx.SaveManager({ storage, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, getState: () => game._prepareStateForSave() });
    const mainWrites = () => storage.writes.filter(k => k === 'pokemon_idle_save').length;

    for (let i = 0; i < 20; i++) { game.save(); clock.advance(100); }
    assert.equal(mainWrites(), 0, '2 秒内连续请求不应写入');
    clock.advance(ctx.SAVE_DEBOUNCE_MS);
    assert.equal(mainWrites(), 1, '安静 2 秒后合并写入一次');

    clock.advance(60000);
    game.saver.flush(false);
    assert.equal(mainWrites(), 1, '没有新变更时自动保存兜底应跳过');

    // 持续请求（每 1.5 秒一次）也不会无限推迟：最迟 10 秒写入
    for (let i = 0; i < 40; i++) { game.save(); clock.advance(1500); }   // 共 60 秒
    const w = mainWrites() - 1;
    assert.ok(w >= 5 && w <= 7, `60 秒内应写入约 6 次，实际 ${w}`);
});

test('防抖：saveNow() 立即写入并取消挂起的定时器', () => {
    const clock = fakeClock();
    const { game, ctx, storage } = newGame();
    storage.writes.length = 0;
    game.saver = new ctx.SaveManager({ storage, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, getState: () => game._prepareStateForSave() });
    game.save();
    assert.equal(clock.pendingTimers(), 1);
    const r = game.saveNow();
    assert.equal(r.ok, true);
    assert.equal(clock.pendingTimers(), 0);
    assert.equal(storage.writes.filter(k => k === 'pokemon_idle_save').length, 1);
});

test('性能回归：模拟 1 分钟内 200 场胜利，写入次数从 200 降到个位数', () => {
    const clock = fakeClock();
    const { game, ctx, storage } = newGame();
    storage.writes.length = 0;
    game.saver = new ctx.SaveManager({ storage, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, getState: () => game._prepareStateForSave() });
    const route = game.getRoute('kanto_route1');
    for (let i = 0; i < 200; i++) {
        game.gameState.currentEnemy = game.generateWildPokemon(route);
        game.save();                                          // startBattle 的新敌人
        game._processVictoryRewards(game.gameState.currentEnemy, 25, 100, 100);
        game.save();                                          // onEnemyDefeated
        clock.advance(300);
    }
    clock.advance(ctx.SAVE_DEBOUNCE_MS);
    const writes = storage.writes.filter(k => k === 'pokemon_idle_save').length;
    assert.ok(writes <= 8, `1 分钟最多约 7 次写入，实际 ${writes}`);
    assert.ok(writes >= 1);
});

// ---------------------------------------------------------------- 错误处理

test('空间不足：先释放备份重试；仍不足则返回明确错误并保持待保存状态', () => {
    const clock = fakeClock();
    const { ctx, game } = richGame();
    const state = plain(game._prepareStateForSave());
    const size = ctx.SaveCodec.encodePayload(JSON.stringify(state)).length;

    // 够放主存档 + 一点点余量，但放不下备份
    const storage = createMemoryStorage({}, { quotaChars: Math.floor(size * 1.5) });
    const errors = [];
    const sm = new ctx.SaveManager({
        storage, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
        getState: () => state, onError: (e) => errors.push(e),
    });
    assert.equal(sm.write(state).ok, true);
    clock.advance(ctx.SAVE_BACKUP_INTERVAL_MS + 1);
    const r2 = sm.write(state);                       // 备份写不下，不能因此丢主存档
    assert.equal(r2.ok, true, '备份失败不能影响主存档写入');
    assert.deepEqual(errors, []);

    // 彻底放不下
    const tiny = createMemoryStorage({}, { quotaChars: Math.floor(size * 0.5) });
    const errors2 = [];
    let recovered = 0;
    const sm2 = new ctx.SaveManager({
        storage: tiny, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
        getState: () => state, onError: (e) => errors2.push(e), onRecover: () => recovered++,
    });
    sm2.request();
    const r = sm2.flush();
    assert.equal(r.ok, false);
    assert.equal(r.code, 'quota');
    assert.equal(errors2.length, 1);
    assert.match(errors2[0].message, /空间已满/);
    assert.equal(sm2.hasPending(), true, '失败后保持脏标记，等待重试');

    // 腾出空间后，下一次重试成功并通知恢复
    tiny.quotaChars = Infinity;
    const r3 = sm2.flush();
    assert.equal(r3.ok, true);
    assert.equal(recovered, 1);
    assert.equal(sm2.hasPending(), false);
});

test('写入空间不足时会优先牺牲备份而不是主存档', () => {
    const clock = fakeClock();
    const { ctx, game } = richGame();
    const state = plain(game._prepareStateForSave());
    const size = ctx.SaveCodec.encodePayload(JSON.stringify(state)).length;
    const storage = createMemoryStorage({}, { quotaChars: Math.floor(size * 3.6) });
    const sm = new ctx.SaveManager({ storage, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer });
    for (let i = 0; i < 4; i++) { clock.advance(ctx.SAVE_BACKUP_INTERVAL_MS + 1); sm.write(state); }
    storage.quotaChars = Math.floor(size * 1.2);   // 空间收紧
    const r = sm.write(state);
    assert.equal(r.ok, true);
    assert.ok(storage.getItem('pokemon_idle_save'));
});

test('浏览器存储不可用（隐私模式等）：写入返回错误并触发提示', () => {
    const { game, ctx } = newGame();
    const storage = createMemoryStorage();
    storage.failWrites = true;
    const errors = [];
    const sm = new ctx.SaveManager({ storage, getState: () => game._prepareStateForSave(), onError: (e) => errors.push(e) });
    const r = sm.write(plain(game._prepareStateForSave()));
    assert.equal(r.ok, false);
    assert.equal(errors.length, 1);
    assert.ok(errors[0].message.length > 0);
    // 读取不可用时当作没有存档，不抛异常
    storage.failReads = true;
    assert.doesNotThrow(() => sm.load());
    const sm0 = new ctx.SaveManager({ storage: null });
    assert.equal(sm0.write({}).ok, false);
    assert.equal(sm0.load().ok, false);
});

test('GameCore：保存失败会通过 onSaveError 回调通知 UI', () => {
    const { game, storage } = newGame();
    const errors = [];
    game.onSaveError = (e) => errors.push(e);
    storage.failWrites = true;
    const r = game.saveNow();
    assert.equal(r.ok, false);
    assert.equal(errors.length, 1);
    storage.failWrites = false;
    let recovered = false;
    game.onSaveRecover = () => { recovered = true; };
    assert.equal(game.saveNow().ok, true);
    assert.equal(recovered, true);
});

// ---------------------------------------------------------------- 多标签页

test('多标签页：另一个标签页写入存档后，本页暂停保存并提示；接管后恢复', () => {
    const clock = fakeClock();
    const { ctx, game, storage } = newGame();
    let listener = null;
    const win = { addEventListener: (t, fn) => { if (t === 'storage') listener = fn; } };
    let conflicts = 0;
    const sm = new ctx.SaveManager({
        storage, win, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
        getState: () => game._prepareStateForSave(), onConflict: () => conflicts++,
    });
    sm.request();
    listener({ key: 'pokemon_idle_save' });
    assert.equal(conflicts, 1);
    assert.equal(sm.paused, true);
    storage.writes.length = 0;
    sm.request();
    clock.advance(30000);
    assert.equal(storage.writes.length, 0, '暂停期间不得写入，避免互相覆盖');
    assert.equal(sm.flush(true).code, 'paused');
    listener({ key: 'pokemon_idle_save' });
    assert.equal(conflicts, 1, '只提示一次');
    listener({ key: 'something_else' });
    assert.equal(sm.takeOver().ok, true);
    assert.equal(sm.paused, false);
    assert.equal(storage.writes.includes('pokemon_idle_save'), true);
});

// ---------------------------------------------------------------- 删除

test('deleteSave 清除主存档、备份和副本', () => {
    const { game, storage, ctx } = newGame();
    game.saveNow(); game.saver.backupNow(true);
    storage.setItem(ctx.SAVE_CORRUPT_KEY, 'x');
    storage.setItem(ctx.SAVE_PREMIGRATION_PREFIX + '1', 'x');
    game.deleteSave();
    assert.deepEqual(storage.keys().filter(k => k.startsWith('pokemon_idle_save')), []);
    assert.equal(game.gameState, null);
});

test('新游戏会立即落盘，避免刚开局关闭页面丢档', () => {
    const { storage } = newGame();
    assert.ok(storage.getItem('pokemon_idle_save'));
});
