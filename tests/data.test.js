'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadData } = require('../tools/load-context');
const { validateGameData } = require('../tools/data-validator');

const data = loadData();
const clone = (o) => JSON.parse(JSON.stringify(o));
const withData = (mut) => {
    const d = { ...data, POKEMON_DATA: clone(data.POKEMON_DATA), REGIONS: clone(data.REGIONS), SKILL_DATA: clone(data.SKILL_DATA) };
    mut(d);
    return validateGameData(d);
};
const codes = (r) => new Set(r.errors.map(e => e.code));

test('真实游戏数据通过全部硬性校验（0 个错误）', () => {
    const r = validateGameData(data);
    assert.deepEqual(r.errors, [], r.errors.map(e => `[${e.code}] ${e.message}`).join('\n'));
    assert.equal(r.stats.pokemon, 1073);
    assert.equal(r.stats.regions, 10);
    assert.equal(r.stats.routes, 192);
});

test('历史遗留警告设基线：只允许减少，不允许新增', () => {
    const baseline = { 'route-pokemon-outside-range': 7, 'route-level-gap': 1, 'route-dup-pokemon': 1 };
    const r = validateGameData(data);
    const counts = {};
    r.warnings.forEach(w => { counts[w.code] = (counts[w.code] || 0) + 1; });
    for (const [code, n] of Object.entries(counts)) {
        assert.ok(code in baseline, `出现新类型的警告 ${code}：${r.warnings.find(w => w.code === code).message}`);
        assert.ok(n <= baseline[code], `警告 ${code} 从基线 ${baseline[code]} 增加到 ${n}`);
    }
});

// ---- 校验器自检：故意破坏数据，确认能抓到 ----
test('校验器能发现：编号缺口 / 未知属性 / 种族值越界 / 经验组错误', () => {
    const r = withData(d => {
        delete d.POKEMON_DATA[100];
        d.POKEMON_DATA[1].types = ['grass', 'cosmic'];
        d.POKEMON_DATA[2].baseStats.hp = 999;
        d.POKEMON_DATA[3].expGroup = 'instant';
        d.POKEMON_DATA[4].name = '';
        d.POKEMON_DATA[5].types = ['fire', 'fire'];
    });
    for (const c of ['pokemon-gap', 'pokemon-types', 'pokemon-stats', 'pokemon-expgroup', 'pokemon-name']) {
        assert.ok(codes(r).has(c), `应报告 ${c}`);
    }
});

test('校验器能发现：进化目标不存在 / 自我进化 / 进化环 / 非法等级', () => {
    const r = withData(d => {
        d.POKEMON_DATA[1].evolvesTo = { id: 99999, level: 16 };
        d.POKEMON_DATA[4].evolvesTo = { id: 4, level: 16 };
        d.POKEMON_DATA[7].evolvesTo = { id: 8, level: 0 };
        d.POKEMON_DATA[8].evolvesTo = { id: 7, level: 20 };
    });
    for (const c of ['evo-target', 'evo-self', 'evo-level', 'evo-cycle']) assert.ok(codes(r).has(c), `应报告 ${c}`);
});

test('校验器能发现：路线引用不存在的宝可梦 / 权重为 0 / 等级倒置 / id 重复 / 空路线', () => {
    const r = withData(d => {
        const routes = d.REGIONS.kanto.routes;
        routes[0].pokemon[0].id = 424242;
        routes[0].pokemon[1].weight = 0;
        routes[1].pokemon[0].levelRange = [9, 3];
        routes[2].id = routes[3].id;
        routes[4].pokemon = [];
        routes[5].levelRange = [50, 10];
    });
    for (const c of ['route-pokemon', 'route-weight', 'route-pokemon-level', 'route-dup', 'route-empty', 'route-level']) {
        assert.ok(codes(r).has(c), `应报告 ${c}`);
    }
});

test('校验器能发现：解锁条件与图鉴区间不一致 / 地区无法解锁 / 宝可梦无法获得', () => {
    const r = withData(d => {
        d.REGIONS.johto.unlockCondition = { type: 'pokedex_complete', range: [1, 150] };
        // 把某个只能在路线出现的宝可梦从所有路线移除 → 无法获得
        for (const k of Object.keys(d.REGIONS)) for (const rt of d.REGIONS[k].routes) {
            rt.pokemon = rt.pokemon.filter(p => p.id !== 151 || rt.pokemon.length === 1);
        }
    });
    assert.ok(codes(r).has('unlock-condition'));
    assert.ok(codes(r).has('unobtainable') || codes(r).has('progression-blocked'));
});

test('校验器能发现：技能表缺失 / 威力非法', () => {
    const r = withData(d => {
        d.SKILL_DATA.fire[2].power = 0;
        d.SKILL_DATA.water.pop();
        delete d.SKILL_DATA.fairy;
    });
    assert.ok(codes(r).has('skill-power'));
    assert.ok(codes(r).has('skill-levels'));
    assert.ok(codes(r).has('skill-type'));
});

test('每个地区都有对应徽章；徽章键与地区一致', () => {
    assert.deepEqual(Object.keys(data.BADGE_DATA), Object.keys(data.REGIONS));
});
