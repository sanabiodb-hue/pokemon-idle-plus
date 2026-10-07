'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, mulberry32, sequenceRng, plain } = require('./helpers/game');

test('rollTraits：固定消耗 4 个随机数，同一序列得到相同结果', () => {
    const { ctx } = newGame();
    let n = 0;
    const counting = (inner) => () => { n++; return inner(); };
    const a = ctx.rollTraits(25, counting(mulberry32(7)));
    assert.equal(n, 4);
    n = 0;
    const b = ctx.rollTraits(25, mulberry32(7));
    assert.deepEqual(plain(a), plain(b));
    for (const id of [81, 32, 113, 25]) {      // 无性别 / 只雄 / 只雌 / 普通：消耗数量一致
        n = 0; ctx.rollTraits(id, counting(() => 0.3)); assert.equal(n, 4, `#${id}`);
    }
});

test('rollTraits：性格来自 25 种性格，性别遵守物种规则，特性是槽位', () => {
    const { ctx } = newGame();
    const rng = mulberry32(3);
    const natures = new Set();
    for (let i = 0; i < 2000; i++) {
        const t = ctx.rollTraits(25, rng);
        assert.ok(ctx.POKEMON_NATURES.some(n => n.id === t.nature));
        assert.ok(['male', 'female'].includes(t.gender));
        assert.ok(ctx.ABILITY_SLOTS.includes(t.ability));
        natures.add(t.nature);
    }
    assert.equal(natures.size, 25, '2000 次足以覆盖全部 25 种性格');
    assert.equal(ctx.rollTraits(81, rng).gender, null, '磁怪无性别');
    assert.equal(ctx.rollTraits(32, rng).gender, 'male', '尼多朗只有雄性');
    assert.equal(ctx.rollTraits(113, rng).gender, 'female', '吉利蛋只有雌性');
});

test('rollTraits：隐藏特性很稀有（约 1/64），普通槽位各约一半', () => {
    const { ctx } = newGame();
    const rng = mulberry32(11);
    const count = { a1: 0, a2: 0, ha: 0 };
    const N = 20000;
    for (let i = 0; i < N; i++) count[ctx.rollAbilitySlot(rng)]++;
    assert.ok(count.ha > N / 64 * 0.5 && count.ha < N / 64 * 1.6, `ha=${count.ha}`);
    assert.ok(Math.abs(count.a1 - count.a2) < N * 0.05);
});

test('用 rollTraits 的结果创建个体：字段能通过规范化原样保留', () => {
    const { ctx, game } = newGame();
    const t = ctx.rollTraits(25, sequenceRng([0.5, 0.9, 0.001, 0.9]));
    assert.equal(t.ability, 'ha');
    const r = game.roster.create({ speciesId: 25, ...t, rng: () => 0.5 });
    assert.equal(r.instance.nature, t.nature);
    assert.equal(r.instance.gender, t.gender);
    assert.equal(r.instance.ability, 'ha');
});
