'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRoster, ivsOf } = require('./helpers/roster');
const { plain, mulberry32 } = require('./helpers/game');

const FIELDS = ['uid', 'speciesId', 'level', 'exp', 'ivs', 'nature', 'ability', 'gender', 'shiny', 'nickname',
    'origin', 'originRoute', 'caughtAt', 'battles', 'stats', 'skillLevel'];

// ---------------------------------------------------------------- 1. 创建单只个体

test('创建个体：包含需求中的全部字段，形状固定', () => {
    const { ctx, add, state } = makeRoster();
    const p = add(25, { level: 12, ivs: ivsOf(20), shiny: true, nickname: '小黄', origin: 'wild', originRoute: 'kanto_route2' });
    assert.deepEqual(Object.keys(p).sort(), [...FIELDS].sort());
    assert.match(p.uid, /^p\d+$/);
    assert.equal(p.speciesId, 25);
    assert.equal(p.level, 12);
    assert.equal(p.exp, ctx.getExpForLevel('medium', 12), '未指定 exp 时从该等级起点开始');
    assert.deepEqual(plain(p.ivs), ivsOf(20));
    assert.ok(ctx.POKEMON_NATURES.some(n => n.id === p.nature), '性格必须是 25 种之一');
    assert.equal(p.ability, null);
    assert.equal(p.gender, null);
    assert.equal(p.shiny, true);
    assert.equal(p.nickname, '小黄');
    assert.equal(p.origin, 'wild');
    assert.equal(p.originRoute, 'kanto_route2');
    assert.equal(p.battles, 0);
    assert.deepEqual(plain(p.stats), { victories: 0, faints: 0, expGained: 0, damageDealt: 0, damageTaken: 0, criticalHits: 0 });
    assert.equal(p.skillLevel, 0);
    assert.equal(state.ownedPokemon[p.uid], p, '个体登记在 ownedPokemon 里');
});

test('创建个体：捕获日期是“日期”（当天 UTC 零点），由注入的时钟决定', () => {
    const { add, setClock, ctx } = makeRoster();
    const t = Date.UTC(2026, 2, 15, 18, 45, 12);
    setClock(t);
    const p = add(1);
    assert.equal(p.caughtAt, Date.UTC(2026, 2, 15));
    assert.equal(ctx.toCaptureDate(t + 3600 * 1000), Date.UTC(2026, 2, 15));
    assert.equal(ctx.toCaptureDate(-5), null);
    assert.equal(ctx.toCaptureDate('x'), null);
    // 显式 null = 未知日期（迁移用）
    assert.equal(add(2, { caughtAt: null }).caughtAt, null);
});

test('创建个体：参数缺省时的默认值与随机性', () => {
    const { ctx, add } = makeRoster();
    const a = add(133);
    assert.ok(Object.values(a.ivs).every(v => Number.isInteger(v) && v >= 0 && v <= 31));
    assert.equal(a.level, 1);
    assert.equal(a.origin, 'unknown', '未声明来历时为 unknown');
    // 性格和个体值来自 rng：同一个种子 → 同样的结果
    const x = ctx.createPokemonInstance({ uid: 'x1', speciesId: 133, rng: mulberry32(5), caughtAt: null });
    const y = ctx.createPokemonInstance({ uid: 'x2', speciesId: 133, rng: mulberry32(5), caughtAt: null });
    assert.deepEqual(plain(x.ivs), plain(y.ivs));
    assert.equal(x.nature, y.nature);
    // 显式给出的性格不消耗随机数
    const z = ctx.createPokemonInstance({ uid: 'x3', speciesId: 133, nature: 'timid', ivs: ivsOf(1), rng: () => { throw new Error('不应调用 rng'); }, caughtAt: null });
    assert.equal(z.nature, 'timid');
});

test('创建个体：非法物种/uid 被拒绝，不会污染名册', () => {
    const { roster, ctx, state } = makeRoster();
    assert.equal(roster.create({ speciesId: 99999 }).code, 'unknown_species');
    assert.equal(roster.create({ speciesId: 'abc' }).code, 'unknown_species');
    assert.throws(() => ctx.createPokemonInstance({ uid: '<x>', speciesId: 1 }), /uid/);
    assert.throws(() => ctx.createPokemonInstance({ uid: 'ok', speciesId: 0 }), /物种/);
    assert.equal(Object.keys(state.ownedPokemon).length, 0);
});

test('规范形状：任何垃圾输入都被强制成合法个体', () => {
    const { ctx } = makeRoster();
    const p = ctx.buildInstance({
        uid: 'p9', speciesId: 25, level: 'abc', exp: -5, ivs: { hp: 99, atk: -3, def: 'x', spAtk: 12.9 },
        nature: 'bogus', ability: '<script>', gender: 'robot', shiny: 'yes', nickname: 42, origin: 'hack',
        originRoute: '../../etc', caughtAt: 'tomorrow', battles: -2, stats: { victories: 'many', faints: 3 }, skillLevel: 99,
    });
    assert.equal(p.level, 1);
    assert.ok(p.exp >= 0);
    assert.deepEqual(plain(p.ivs), { hp: 31, atk: 0, def: 0, spAtk: 12, spDef: 0, speed: 0 });
    assert.equal(p.nature, ctx.DEFAULT_NATURE);
    assert.equal(p.ability, null);
    assert.equal(p.gender, null);
    assert.equal(p.shiny, false, 'shiny 必须是严格的 true');
    assert.equal(p.nickname, '');
    assert.equal(p.origin, 'unknown');
    assert.equal(p.originRoute, null);
    assert.equal(p.caughtAt, null);
    assert.equal(p.battles, 0);
    assert.equal(p.stats.victories, 0);
    assert.equal(p.stats.faints, 3);
    assert.equal(p.skillLevel, ctx.MAX_SKILL_LEVEL);
});

test('性格表：25 种、唯一，5 种中性，其余恰好一增一减；当前不影响数值', () => {
    const { ctx } = makeRoster();
    const natures = ctx.POKEMON_NATURES;
    assert.equal(natures.length, 25);
    assert.equal(new Set(natures.map(n => n.id)).size, 25);
    assert.equal(natures.filter(n => !n.plus && !n.minus).length, 5);
    for (const n of natures.filter(n => n.plus)) {
        assert.ok(n.minus && n.minus !== n.plus, n.id);
        assert.ok(ctx.IV_KEYS.includes(n.plus) && ctx.IV_KEYS.includes(n.minus) && n.plus !== 'hp', n.id);
    }
    assert.equal(natures.find(n => n.id === ctx.DEFAULT_NATURE).plus, null, '默认性格是中性的');
});

test('昵称：去掉 HTML/引号/控制字符，限制 12 个字符（按字符而非字节）', () => {
    const { ctx } = makeRoster();
    assert.equal(ctx.sanitizeNickname('<img src=x onerror="alert(1)">'), 'img src=x on');
    assert.equal(ctx.sanitizeNickname('a\u0000b​c‮d'), 'abcd');
    assert.equal(ctx.sanitizeNickname('  多   个   空格  '), '多 个 空格');
    assert.equal(ctx.sanitizeNickname('一二三四五六七八九十甲乙丙丁'), '一二三四五六七八九十甲乙');
    assert.equal(ctx.sanitizeNickname('😀😀😀😀😀😀😀😀😀😀😀😀😀😀').length, 24, '12 个 emoji（每个 2 个 UTF-16 单元）');
    assert.equal(ctx.sanitizeNickname(null), '');
    assert.equal(ctx.sanitizeNickname({}), '');
    assert.equal(ctx.sanitizeNickname("it's `a` \\ test&"), 'its a  test'.replace('  ', ' '));
    assert.equal(ctx.getInstanceDisplayName({ speciesId: 25, nickname: '闪电' }), '闪电');
    assert.equal(ctx.getInstanceDisplayName({ speciesId: 25, nickname: '' }), ctx.POKEMON_DATA[25].name);
});

// ---------------------------------------------------------------- 2-6. 同一物种的多只个体彼此独立

test('两只同物种个体：uid 不同，各自登记，按物种可查询', () => {
    const { roster, add } = makeRoster();
    const a = add(25, { level: 5, ivs: ivsOf(10) });
    const b = add(25, { level: 5, ivs: ivsOf(10) });
    assert.notEqual(a.uid, b.uid);
    assert.notEqual(a, b);
    assert.equal(roster.countOfSpecies(25), 2);
    assert.deepEqual(plain(roster.ofSpecies(25).map(i => i.uid)), [a.uid, b.uid]);
    assert.equal(roster.get(a.uid), a);
    assert.equal(roster.count(), 2);
});

test('个体值独立：互不共享对象，改一只不影响另一只', () => {
    const { add } = makeRoster();
    const a = add(25, { ivs: ivsOf(5) });
    const b = add(25, { ivs: { hp: 31, atk: 30, def: 29, spAtk: 28, spDef: 27, speed: 26 } });
    assert.notEqual(a.ivs, b.ivs);
    a.ivs.hp = 0;
    a.ivs.atk = 31;
    assert.equal(b.ivs.hp, 31);
    assert.equal(b.ivs.atk, 30);
    assert.equal(a.ivs.spDef, 5);
});

test('闪光独立：一只闪光，另一只不是', () => {
    const { add, state } = makeRoster();
    const normal = add(25, { shiny: false });
    const shiny = add(25, { shiny: true });
    assert.equal(normal.shiny, false);
    assert.equal(shiny.shiny, true);
    normal.shiny = true;                 // 改一只
    shiny.shiny = false;
    assert.equal(normal.shiny, true);
    assert.equal(shiny.shiny, false);
    // 非主个体的闪光不会写进旧的物种级 shinyDex（旧代码只认主个体）
    const { add: add2, state: s2 } = makeRoster();
    add2(25, { shiny: false });
    add2(25, { shiny: true });
    assert.equal(s2.shinyDex[25], undefined);
    void state;
});

test('经验与等级独立：给一只加经验，另一只不变', () => {
    const { add, ctx } = makeRoster();
    const a = add(25, { level: 5 });
    const b = add(25, { level: 5 });
    a.exp = ctx.getExpForLevel('medium', 30);
    a.level = 30;
    assert.equal(b.level, 5);
    assert.equal(b.exp, ctx.getExpForLevel('medium', 5));
    b.stats.victories += 3;
    b.battles += 3;
    assert.equal(a.battles, 0);
    assert.equal(a.stats.victories, 0);
    assert.notEqual(a.stats, b.stats);
});

test('昵称、性格、特性、性别、来历也都是每只自己的', () => {
    const { add, roster } = makeRoster();
    const a = add(133, { nickname: '伊布甲', nature: 'timid', gender: 'male', ability: 'run_away', origin: 'gift' });
    const b = add(133, { nickname: '伊布乙', nature: 'adamant', gender: 'female', origin: 'egg' });
    assert.equal(a.nature, 'timid');
    assert.equal(b.nature, 'adamant');
    assert.equal(a.gender, 'male');
    assert.equal(b.gender, 'female');
    assert.equal(a.ability, 'run_away');
    assert.equal(b.ability, null);
    assert.equal(a.origin, 'gift');
    assert.equal(b.origin, 'egg');
    assert.equal(roster.setNickname(b.uid, '<b>新名字</b>').nickname, 'b新名字/b');
    assert.equal(a.nickname, '伊布甲');
    assert.equal(roster.setNickname('nope', 'x').code, 'unknown_pokemon');
});

test('主个体：该物种的第一只；旧的 caughtPokemon[物种] 就是它本身（同一个引用）', () => {
    const { add, roster, state } = makeRoster();
    const a = add(25, { level: 9, ivs: ivsOf(9) });
    const b = add(25, { level: 40, ivs: ivsOf(31) });
    assert.equal(roster.primaryOf(25), a);
    assert.equal(roster.isPrimary(a), true);
    assert.equal(roster.isPrimary(b), false);
    assert.equal(state.caughtPokemon[25], a);
    assert.equal(state.pokedex[25], 'caught');
    // 旧代码改旧视图 = 改主个体
    state.caughtPokemon[25].level = 77;
    assert.equal(a.level, 77);
    assert.equal(b.level, 40);
    // 换主个体后，旧视图跟着指向新的
    roster.setPrimary(b.uid);
    assert.equal(state.caughtPokemon[25], b);
    assert.equal(roster.setPrimary('nope').code, 'unknown_pokemon');
});

test('选主个体的规则：等级高者优先，同级取更早获得的', () => {
    const { ctx, add } = makeRoster();
    const a = add(1, { level: 10 });
    const b = add(1, { level: 30 });
    const c = add(1, { level: 30 });
    assert.equal(ctx.PokemonRoster.chooseBest([a, b, c]), b);
    assert.equal(ctx.PokemonRoster.chooseBest([]), null);
    assert.equal(ctx.uidSequence('p12'), 12);
    assert.equal(ctx.uidSequence('legacy'), null);
});

test('uid 分配：序号单调递增、不重复，即使中间删除/占用', () => {
    const { roster, add, state } = makeRoster();
    const uids = [];
    for (let i = 0; i < 5; i++) uids.push(add(10 + i).uid);
    assert.deepEqual(plain(uids), ['p1', 'p2', 'p3', 'p4', 'p5']);
    state.ownedPokemon.p6 = { ...state.ownedPokemon.p1, uid: 'p6' };   // 占位
    assert.equal(roster.nextUid(), 'p7', '已占用的序号被跳过');
    assert.equal(state.nextPokemonSeq, 8);
});
