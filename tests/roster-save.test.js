'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, catchRange, ivs, plain, createMemoryStorage } = require('./helpers/game');

const healthy = (game) => assert.deepEqual(plain(game.roster.checkIntegrity()), []);

// 一局“什么都有”的游戏：同物种多只、昵称、闪光、多个箱子、放生记录、各种来历
function richRosterGame(seed = 8) {
    const env = newGame({ seed });
    const { game } = env;
    catchRange(game, 1, 30, ivs(6));
    const mk = (speciesId, o) => { const r = game.roster.create({ speciesId, nature: 'jolly', rng: () => 0.5, ...o }); assert.ok(r.ok, r.code); return r.instance; };
    const a2 = mk(25, { level: 44, ivs: ivs(31), shiny: true, nickname: '闪电', origin: 'gift', gender: 'male', ability: 'static' });
    const a3 = mk(25, { level: 9, ivs: ivs(2), nickname: '小电', origin: 'egg', gender: 'female', place: 'party' });
    const d = mk(1, { level: 77, nickname: '种子' });
    game.roster.moveToParty(a2.uid);
    game.roster.pc.addBox('水系专用');
    game.roster.pc.move(d.uid, 1, 7);
    const r = mk(19, { level: 3 });
    assert.ok(game.roster.release(r.uid, { reason: 'transfer' }).ok);
    a2.battles = 120; a2.stats.victories = 100; a2.stats.damageDealt = 987654; a2.stats.criticalHits = 17;
    game.gameState.activePokemonIndex = 1;
    game.gameState.currentEnemy = null;     // 读档后总是有这个键
    healthy(game);
    return { ...env, a2, a3, d };
}

// ---------------------------------------------------------------- 11. save/load

test('保存再读取：个体、队伍、PC（含格子位置与箱子名）、放生记录、主个体、uid 计数器全部一致', () => {
    const { game, storage, a2, a3, d } = richRosterGame();
    assert.equal(game.saveNow().ok, true);
    const before = plain(game.gameState);

    const { game: g2 } = newGame({ storage, load: true });
    assert.equal(g2.loadReport.ok, true);
    assert.deepEqual(plain(g2.gameState), before);
    for (const k of ['ownedPokemon', 'party', 'pc', 'released', 'speciesPrimary', 'nextPokemonSeq', 'activePokemonIndex']) {
        assert.deepEqual(plain(g2.gameState[k]), before[k], k);
    }
    const b2 = g2.roster.get(a2.uid);
    assert.equal(b2.nickname, '闪电');
    assert.equal(b2.shiny, true);
    assert.equal(b2.gender, 'male');
    assert.equal(b2.ability, 'static');
    assert.equal(b2.origin, 'gift');
    assert.equal(b2.nature, 'jolly');
    assert.equal(b2.stats.damageDealt, 987654);
    assert.equal(b2.battles, 120);
    assert.equal(g2.roster.get(a3.uid).origin, 'egg');
    assert.equal(g2.gameState.pc.boxes[2].name, '水系专用', '第 3 个箱子是手动新建并命名的');
    assert.deepEqual(plain(g2.roster.pc.find(d.uid)), { box: 1, slot: 7 });
    assert.equal(g2.gameState.released[0].reason, 'transfer');
    healthy(g2);
});

test('读档后：旧视图重新指向主个体（同一引用），旧代码的修改依然作用在个体上', () => {
    const { game, storage } = richRosterGame();
    game.saveNow();
    const { game: g2 } = newGame({ storage, load: true });
    const gs = g2.gameState;
    for (const id of Object.keys(gs.caughtPokemon)) {
        // 旧视图指向主个体；物种没有活着的个体时指向图鉴存档
        const live = gs.ownedPokemon[gs.speciesPrimary[id]];
        assert.equal(gs.caughtPokemon[id], live || gs.archivedSpecies[id], `#${id}`);
    }
    g2.addExpToPokemon(20, 123456);          // 拉达（没有进化形态）：旧接口给物种加经验 = 给主个体加经验
    assert.ok(g2.roster.primaryOf(20).exp >= 123456);
    assert.equal(g2.roster.get(game.roster.primaryOf(25).uid).speciesId, 25);
});

test('读档后新建个体不会重复使用已有 uid（计数器随存档保存）', () => {
    const { game, storage } = richRosterGame();
    const seq = game.gameState.nextPokemonSeq;
    game.saveNow();
    const { game: g2 } = newGame({ storage, load: true });
    assert.equal(g2.gameState.nextPokemonSeq, seq);
    const created = g2.roster.create({ speciesId: 133, nature: 'hardy', rng: () => 0.5 });
    assert.equal(created.instance.uid, 'p' + seq);
    assert.equal(Object.keys(g2.gameState.ownedPokemon).length, game.roster.count() + 1);
    healthy(g2);
});

test('存档里同时有新旧两套数据：保持一致（旧视图是镜像，不重复存储不一致的数据）', () => {
    const { game, ctx } = richRosterGame();
    game.saveNow();
    const raw = ctx.SaveCodec.decodePayload(game.saver.storage.getItem('pokemon_idle_save'));
    assert.ok(raw.ownedPokemon && raw.party && raw.pc && raw.speciesPrimary && raw.caughtPokemon && raw.team, '过渡期两套都写');
    for (const [sp, uid] of Object.entries(raw.speciesPrimary)) {
        assert.deepEqual(raw.caughtPokemon[sp], raw.ownedPokemon[uid], `镜像 #${sp}`);
    }
    assert.deepEqual(raw.team, raw.party.map(u => raw.ownedPokemon[u].speciesId));
});

test('备份轮转与恢复同样适用于个体存档', () => {
    const { game, storage, ctx } = richRosterGame();
    game.saveNow();
    game.saver.backupNow(true);
    const nick = game.roster.get('p31') ? game.roster.get('p31').nickname : null;
    storage.setItem('pokemon_idle_save', 'LZ:坏');
    const { game: g2 } = newGame({ storage, load: true });
    assert.equal(g2.loadReport.recovered, true);
    assert.equal(g2.loadReport.source, 'backup1');
    assert.equal(g2.roster.count(), game.roster.count());
    healthy(g2);
    void nick; void ctx;
});

// ---------------------------------------------------------------- 10. 导出 / 导入

test('导出再导入：个体、昵称、PC 布局完全保留（换一个全新的游戏实例）', () => {
    const { game, a2 } = richRosterGame();
    const text = game.exportSave();
    const { game: other } = newGame({ seed: 123 });
    const res = other.importSave(text);
    assert.equal(res.success, true, res.message);
    assert.deepEqual(plain(res.warnings), []);
    for (const k of ['ownedPokemon', 'party', 'pc', 'released', 'speciesPrimary', 'nextPokemonSeq']) {
        assert.deepEqual(plain(other.gameState[k]), plain(game.gameState[k]), k);
    }
    assert.equal(other.roster.get(a2.uid).nickname, '闪电');
    healthy(other);
    // 导入后可以继续正常游戏
    assert.ok(other.calculateBattleStats(0).hp > 0);
    assert.ok(other.getPartyMemberView(1).displayName);
});

test('导出的文本仍是 Base64（LZ: 载荷），原始 LZ:/纯 JSON 形式也能导入新结构', () => {
    const { game, ctx } = richRosterGame();
    const state = plain(game._prepareStateForSave());
    const json = JSON.stringify(state);
    for (const text of [game.exportSave(), ctx.SaveCodec.encodePayload(json), json]) {
        const { game: g } = newGame();
        const res = g.importSave(text);
        assert.equal(res.success, true, res.message);
        assert.equal(g.roster.count(), game.roster.count());
    }
    assert.match(game.exportSave(), /^[A-Za-z0-9+/=]+$/);
});

test('导入会先备份当前存档，失败的导入不动当前个体', () => {
    const { game, storage, ctx } = richRosterGame();
    game.saveNow();
    const mainBefore = storage.getItem('pokemon_idle_save');
    const { game: other } = newGame({ seed: 3 });
    other.saveNow();
    const exported = other.exportSave();
    const snapshot = JSON.stringify(game.gameState.ownedPokemon);
    assert.equal(game.importSave('{"team":[99999],"party":["p1"],"ownedPokemon":{}}').success, false);
    assert.equal(JSON.stringify(game.gameState.ownedPokemon), snapshot);
    assert.equal(game.importSave(exported).success, true);
    assert.equal(storage.getItem(ctx.SAVE_BACKUP_KEYS[0]), mainBefore);
});

// ---------------------------------------------------------------- 1/12. 校验：恶意/损坏数据

function baseRaw(game) {
    return plain(game._prepareStateForSave());
}

test('校验：昵称/箱子名里的 HTML 与引号被剔除，一律不会进入状态', () => {
    const { game, ctx, a2 } = richRosterGame();
    const raw = baseRaw(game);
    raw.ownedPokemon[a2.uid].nickname = '<img src=x onerror="alert(1)">';
    raw.pc.boxes[0].name = '"><script>alert(2)</script>';
    raw.pc.boxes[1].name = "x'y`z&w\\";
    raw.released[0].nickname = '<b>x</b>';
    const r = ctx.processSaveObject(raw);
    assert.equal(r.ok, true);
    const bad = /[<>"'`&\\]/;
    assert.doesNotMatch(r.state.ownedPokemon[a2.uid].nickname, bad);
    r.state.pc.boxes.forEach(b => assert.doesNotMatch(b.name, bad));
    r.state.released.forEach(x => assert.doesNotMatch(x.nickname, bad));
});

test('校验：非法 uid / 不存在的物种 / 垃圾字段的个体被丢弃或矫正', () => {
    const { game, ctx } = richRosterGame();
    const raw = baseRaw(game);
    const some = Object.values(raw.ownedPokemon)[0];
    raw.ownedPokemon['<b>x</b>'] = { ...some, uid: '<b>x</b>' };
    raw.ownedPokemon['p9999'] = { ...some, uid: 'p9999', speciesId: 424242 };
    raw.ownedPokemon['p9998'] = 'not an object';
    raw.ownedPokemon['p9997'] = { ...some, uid: 'p9997', level: 'x', ivs: { hp: 999 }, nature: '<x>', gender: 'robot', shiny: 'true', origin: 'hax', stats: { victories: -5 } };
    const r = ctx.processSaveObject(raw);
    assert.equal(r.ok, true);
    assert.equal(r.state.ownedPokemon['<b>x</b>'], undefined);
    assert.equal(r.state.ownedPokemon.p9999, undefined);
    assert.equal(r.state.ownedPokemon.p9998, undefined);
    const fixed = r.state.ownedPokemon.p9997;
    assert.equal(fixed.level, 1);
    assert.equal(fixed.ivs.hp, 31);
    assert.equal(fixed.nature, ctx.DEFAULT_NATURE);
    assert.equal(fixed.gender, null);
    assert.equal(fixed.shiny, false);
    assert.equal(fixed.origin, 'unknown');
    assert.equal(fixed.stats.victories, 0);
    assert.ok(r.warnings.some(w => w.includes('无效的个体')));
});

test('校验：队伍引用不存在/重复的 uid、超过 6 只、出战下标越界', () => {
    const { game, ctx } = richRosterGame();
    const raw = baseRaw(game);
    delete raw.team;                      // 只靠 party（未来可能不再保存旧镜像）
    const uids = Object.keys(raw.ownedPokemon).slice(0, 12);
    raw.party = ['nope', uids[0], uids[0], ...uids.slice(1, 9), 7, null];
    raw.activePokemonIndex = 99;
    const r = ctx.processSaveObject(raw);
    assert.equal(r.ok, true);
    assert.equal(r.state.party.length, 6);
    assert.equal(new Set(r.state.party).size, 6);
    assert.equal(r.state.party[0], uids[0]);
    assert.equal(r.state.activePokemonIndex, 5);
    assert.deepEqual(plain(r.state.team), plain(r.state.party.map(u => r.state.ownedPokemon[u].speciesId)));
    delete raw.party;
    assert.equal(ctx.processSaveObject(raw).ok, false, '既没有 team 也没有 party');
    raw.party = ['nope'];
    assert.equal(ctx.processSaveObject(raw).ok, false, 'party 里没有任何有效个体');
});

test('校验：同一只个体同时出现在队伍与多个 PC 格子 → 只保留一处；孤儿个体自动放进 PC', () => {
    const { game, ctx } = richRosterGame();
    const raw = baseRaw(game);
    const partyUid = raw.party[0];
    raw.pc.boxes[0].slots[29] = partyUid;                   // 队伍成员又出现在 PC
    const someUid = raw.pc.boxes[0].slots.find(u => u && u !== partyUid);
    raw.pc.boxes[0].slots[28] = someUid;                    // 重复放置
    const orphan = raw.pc.boxes[0].slots.indexOf(someUid);
    raw.pc.boxes[0].slots[orphan] = null;                   // 制造一个孤儿（someUid 仍在 28 号格）
    raw.pc.boxes[1].slots[0] = 'ghost';                     // 不存在的 uid
    const r = ctx.processSaveObject(raw);
    assert.equal(r.ok, true);
    const found = new Map();
    for (const b of r.state.pc.boxes) for (const u of b.slots) if (u) found.set(u, (found.get(u) || 0) + 1);
    assert.equal(found.get(partyUid), undefined, '队伍成员不会同时在 PC');
    assert.ok([...found.values()].every(n => n === 1), '每只最多出现一次');
    assert.equal(found.has('ghost'), false);
    // 全部个体都有位置
    const total = r.state.party.length + found.size;
    assert.equal(total, Object.keys(r.state.ownedPokemon).length);
    const { game: g } = newGame();
    assert.equal(g.importSave(JSON.stringify(raw)).success, true);
    healthy(g);
});

test('校验：箱子数量/容量/格子长度被限制；伪造巨大 ownedPokemon 被截断', () => {
    const { game, ctx } = richRosterGame();
    const raw = baseRaw(game);
    raw.pc.boxes = Array.from({ length: 500 }, (_, i) => ({ id: 1, name: 'x' + i, capacity: 99999, slots: new Array(10).fill(null) }));
    const r = ctx.processSaveObject(raw);
    assert.equal(r.ok, true);
    assert.ok(r.state.pc.boxes.length <= ctx.PC_MAX_BOXES);
    assert.ok(r.state.pc.boxes.every(b => b.capacity <= ctx.PC_BOX_CAPACITY && b.slots.length === b.capacity));
    assert.equal(new Set(r.state.pc.boxes.map(b => b.id)).size, r.state.pc.boxes.length, '箱子 id 被修成唯一');
    assert.deepEqual(plain(ctx.validateRosterIntegrity(r.state)), []);
});

test('校验：主个体记录错误/缺失时自动修复；旧镜像与个体冲突时以旧镜像的进度为准（过渡期规则）', () => {
    const { game, ctx, a2 } = richRosterGame();
    const raw = baseRaw(game);
    raw.speciesPrimary[25] = 'nope';
    raw.speciesPrimary[4] = a2.uid;                      // 物种不符
    delete raw.speciesPrimary[7];
    raw.caughtPokemon[10].level = 321;                   // 旧代码/旧工具改了旧镜像
    raw.caughtPokemon[10].ivs.hp = 0;
    const r = ctx.processSaveObject(raw);
    assert.equal(r.ok, true);
    assert.equal(r.state.ownedPokemon[r.state.speciesPrimary[25]].speciesId, 25);
    assert.equal(r.state.ownedPokemon[r.state.speciesPrimary[4]].speciesId, 4);
    assert.ok(r.state.speciesPrimary[7]);
    assert.equal(r.state.caughtPokemon[10].level, 321);
    assert.equal(r.state.ownedPokemon[r.state.speciesPrimary[10]].level, 321);
    assert.equal(r.state.caughtPokemon[25], r.state.ownedPokemon[r.state.speciesPrimary[25]]);
    assert.equal(r.state.caughtPokemon[10].ivs.hp, 0);
    assert.deepEqual(plain(ctx.validateRosterIntegrity(r.state)), []);
});

test('校验：只有新结构（没有旧镜像）的存档也能读取并重建旧视图', () => {
    const { game, ctx } = richRosterGame();
    const raw = baseRaw(game);
    raw.ownedPokemon[raw.speciesPrimary[4]].shiny = true;     // 4 号物种的主个体闪光
    delete raw.caughtPokemon; delete raw.team; delete raw.pokedex; delete raw.shinyDex;
    const r = ctx.processSaveObject(raw);
    assert.equal(r.ok, true, r.error);
    assert.equal(Object.keys(r.state.caughtPokemon).length, Object.keys(r.state.speciesPrimary).length);
    assert.equal(r.state.pokedex[25], 'caught');
    assert.equal(r.state.shinyDex[4], true, '主个体闪光 → 旧的物种级记录补齐');
    assert.equal(r.state.shinyDex[25], undefined, '非主个体闪光不会写进旧的物种级记录');
    assert.deepEqual(plain(ctx.validateRosterIntegrity(r.state)), []);
});

test('校验：闪光双向对齐（shinyDex ⇄ 主个体）', () => {
    const { game, ctx } = richRosterGame();
    const raw = baseRaw(game);
    raw.shinyDex[7] = true;                                  // 旧记录闪光，个体不闪
    const prim4 = raw.speciesPrimary[4];
    raw.ownedPokemon[prim4].shiny = true;                    // 个体闪光，旧记录没有
    delete raw.shinyDex[4];
    raw.caughtPokemon[4] = raw.ownedPokemon[prim4];
    const r = ctx.processSaveObject(raw);
    assert.equal(r.state.ownedPokemon[r.state.speciesPrimary[7]].shiny, true);
    assert.equal(r.state.shinyDex[4], true);
});

test('校验：放生记录——uid 仍被拥有的丢弃，其余字段被净化，数量有上限', () => {
    const { game, ctx } = richRosterGame();
    const raw = baseRaw(game);
    const owned = Object.keys(raw.ownedPokemon)[0];
    raw.released = [
        { uid: owned, speciesId: 25 },                                           // 仍被拥有
        { uid: 'r1', speciesId: 25, level: -4, nickname: '<x>', reason: 'boom', ivs: { hp: 99 } },
        { uid: 'r2', speciesId: 424242 },
        'junk',
        ...Array.from({ length: 700 }, (_, i) => ({ uid: 'q' + i, speciesId: 1, level: 1 })),
    ];
    const r = ctx.processSaveObject(raw);
    assert.equal(r.ok, true);
    assert.ok(r.state.released.length <= ctx.RELEASED_LOG_MAX);
    assert.ok(!r.state.released.some(x => x.uid === owned));
    assert.ok(!r.state.released.some(x => x.speciesId === 424242));
    const kept = r.state.released.filter(x => x.uid.startsWith('q'));
    assert.ok(kept.length > 0);
    assert.equal(kept[0].reason, 'release');
    assert.equal(kept[0].level, 1);
});

test('校验：原型污染——__proto__ / constructor 作为 uid、物种键', () => {
    const { game, ctx } = richRosterGame();
    const raw = baseRaw(game);
    const text = JSON.stringify(raw).replace('"ownedPokemon":{', '"ownedPokemon":{"__proto__":{"polluted":true},"constructor":{"speciesId":25},');
    const r = ctx.processSaveObject(JSON.parse(text));
    assert.equal(r.ok, true);
    assert.equal(({}).polluted, undefined);
    assert.equal(Object.keys(r.state.ownedPokemon).includes('__proto__'), false);
    assert.equal(Object.keys(r.state.ownedPokemon).includes('constructor'), false, '与 Object.prototype 重名的 uid 一律拒绝');
    assert.deepEqual(plain(ctx.validateRosterIntegrity(r.state)), []);
});

test('校验：状态里没有任何字符串含 HTML 危险字符（含个体全部字段）', () => {
    const { game, ctx } = richRosterGame();
    const raw = baseRaw(game);
    for (const inst of Object.values(raw.ownedPokemon)) {
        inst.nickname = '<s>' + inst.nickname;
        inst.ability = '<s>';
        inst.originRoute = '"><x>';
        inst.origin = '<o>';
    }
    const r = ctx.processSaveObject(raw);
    const strings = [];
    (function walk(v) {
        if (typeof v === 'string') strings.push(v);
        else if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { strings.push(k); walk(x); }
    })(r.state);
    for (const str of strings) assert.doesNotMatch(str, /[<>"'`&]/, str);
});

test('性能：1073 只个体清洗 + 完整性检查在宽松预算内', () => {
    const { ctx } = newGame();
    const caught = {};
    for (let id = 1; id <= 1073; id++) caught[id] = { level: 50, exp: 0, ivs: { hp: 5 }, skillLevel: 0 };
    const first = ctx.processSaveObject({ team: [25], caughtPokemon: caught, schemaVersion: 2 });
    assert.equal(first.ok, true);
    const t0 = Date.now();
    const again = ctx.processSaveObject(JSON.parse(JSON.stringify(first.state)));
    const t1 = Date.now();
    const problems = ctx.validateRosterIntegrity(again.state);
    const t2 = Date.now();
    assert.deepEqual(plain(problems), []);
    assert.ok(t1 - t0 < 1500, `清洗 ${t1 - t0}ms`);
    assert.ok(t2 - t1 < 500, `完整性检查 ${t2 - t1}ms`);
});

test('防御：以 "__proto__" / "constructor" 之类的字符串调用名册 API 不会命中 Object.prototype', () => {
    const { game, ctx } = richRosterGame();
    for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
        assert.equal(game.roster.get(bad), null, bad);
        assert.equal(game.roster.has(bad), false, bad);
        assert.equal(game.roster.party.add(bad).code, 'unknown_pokemon', bad);
        assert.equal(game.roster.pc.deposit(bad).code, 'unknown_pokemon', bad);
        assert.equal(game.roster.release(bad).code, 'unknown_pokemon', bad);
        assert.equal(game.addPartyMember(bad), false, bad);
        assert.throws(() => ctx.createPokemonInstance({ uid: bad, speciesId: 25 }), /uid/);
    }
    // 存档里的队伍引用 "__proto__" 也不会被当成个体
    const raw = plain(game._prepareStateForSave());
    delete raw.team;
    raw.party = ['__proto__', 'constructor', Object.keys(raw.ownedPokemon)[0]];
    const r = ctx.processSaveObject(raw);
    assert.equal(r.ok, true);
    assert.equal(r.state.party.length, 1);
    healthy(game);
});
