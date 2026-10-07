'use strict';
// ============================================================
// 宝可梦 / 路线 / 配置数据的自动校验。
// 返回 { errors, warnings, stats }；errors 非空表示数据有硬伤（CI 失败）。
// warnings 带 code，已知的历史遗留问题在测试里设有基线，只允许减少不允许增加。
// ============================================================
const fs = require('fs');
const path = require('path');

const IV_STAT_KEYS = ['hp', 'atk', 'def', 'spAtk', 'spDef', 'speed'];

function validateGameData(data, opts = {}) {
    const root = opts.root || path.resolve(__dirname, '..');
    const errors = [];
    const warnings = [];
    const err = (code, msg) => errors.push({ code, message: msg });
    const warn = (code, msg) => warnings.push({ code, message: msg });

    const {
        POKEMON_DATA: P, REGIONS: R, EXP_GROUPS, TYPE_CHART, TYPE_NAMES,
        BADGE_DATA, GEM_QUALITIES, GEM_ATTRIBUTES, BERRY_DATA, SKILL_DATA, TALENT_DATA,
        MAX_SKILL_LEVEL, REGION_POKEDEX_RANGES: RANGES,
    } = data;

    // ---------------- 宝可梦 ----------------
    const ids = Object.keys(P).map(Number).sort((a, b) => a - b);
    const maxId = ids[ids.length - 1];
    for (let i = 1; i <= maxId; i++) {
        if (!P[i]) err('pokemon-gap', `编号不连续：缺少 #${i}`);
    }
    const validTypes = new Set(Object.keys(TYPE_CHART));
    const names = new Map();
    for (const id of ids) {
        const p = P[id];
        if (!Number.isInteger(id) || id < 1) { err('pokemon-id', `非法编号 key=${id}`); continue; }
        if (p.id !== id) err('pokemon-id', `#${id} 的 id 字段为 ${p.id}`);
        if (typeof p.name !== 'string' || !p.name.trim()) err('pokemon-name', `#${id} 缺少名称`);
        else {
            if (names.has(p.name)) warn('pokemon-dup-name', `名称重复：#${names.get(p.name)} 与 #${id} 都叫 ${p.name}`);
            names.set(p.name, id);
        }
        if (!Array.isArray(p.types) || p.types.length < 1 || p.types.length > 2) {
            err('pokemon-types', `#${id} ${p.name} 属性数量必须是 1~2`);
        } else {
            if (new Set(p.types).size !== p.types.length) err('pokemon-types', `#${id} ${p.name} 属性重复`);
            for (const t of p.types) {
                if (!validTypes.has(t)) err('pokemon-types', `#${id} ${p.name} 未知属性 ${t}`);
                if (!TYPE_NAMES[t]) err('pokemon-types', `#${id} ${p.name} 属性 ${t} 缺少中文名`);
            }
        }
        const bs = p.baseStats;
        if (!bs || typeof bs !== 'object') err('pokemon-stats', `#${id} ${p.name} 缺少种族值`);
        else {
            for (const k of IV_STAT_KEYS) {
                if (!Number.isInteger(bs[k]) || bs[k] < 1 || bs[k] > 255) {
                    err('pokemon-stats', `#${id} ${p.name} 种族值 ${k}=${bs[k]} 不在 1~255`);
                }
            }
            for (const k of Object.keys(bs)) {
                if (!IV_STAT_KEYS.includes(k)) err('pokemon-stats', `#${id} ${p.name} 出现未知种族值字段 ${k}`);
            }
        }
        if (!EXP_GROUPS[p.expGroup]) err('pokemon-expgroup', `#${id} ${p.name} 未知经验组 ${p.expGroup}`);
        for (const suffix of ['', 'shiny/']) {
            const file = path.join(root, 'sprites', 'pokemon', `${suffix}${id}.png`);
            if (!fs.existsSync(file)) err('sprite-missing', `缺少精灵图 sprites/pokemon/${suffix}${id}.png`);
        }
    }

    // 进化链
    const parents = new Map();
    for (const id of ids) {
        const e = P[id].evolvesTo;
        if (!e) continue;
        for (const x of (Array.isArray(e) ? e : [e])) {
            if (!x || !P[x.id]) { err('evo-target', `#${id} 的进化目标 ${x && x.id} 不存在`); continue; }
            if (x.id === id) err('evo-self', `#${id} 进化成自己`);
            if (!Number.isInteger(x.level) || x.level < 1 || x.level > 100) err('evo-level', `#${id}→#${x.id} 进化等级 ${x.level} 非法`);
            if (parents.has(x.id)) warn('evo-multi-parent', `#${x.id} 有多个进化来源：#${parents.get(x.id)} 与 #${id}`);
            parents.set(x.id, id);
        }
    }
    for (const start of ids) { // 环检测
        const seen = new Set();
        let cur = start;
        while (parents.has(cur)) {
            if (seen.has(cur)) { err('evo-cycle', `进化链出现环：#${start}`); break; }
            seen.add(cur);
            cur = parents.get(cur);
        }
    }

    // ---------------- 区间 / 地区 ----------------
    const regionKeys = Object.keys(R);
    const rangeKeys = Object.keys(RANGES);
    if (regionKeys.join() !== rangeKeys.join()) {
        err('range-order', `REGIONS 与 REGION_POKEDEX_RANGES 的地区/顺序不一致：${regionKeys} vs ${rangeKeys}`);
    }
    let expectedStart = 1;
    for (const k of rangeKeys) {
        const [a, b] = RANGES[k];
        if (a !== expectedStart) err('range-contiguous', `${k} 区间起点应为 ${expectedStart}，实际 ${a}`);
        if (b < a) err('range-contiguous', `${k} 区间终点小于起点`);
        expectedStart = b + 1;
    }
    if (expectedStart - 1 !== maxId) err('range-coverage', `图鉴区间覆盖到 #${expectedStart - 1}，但最大编号是 #${maxId}`);
    for (const k of Object.keys(BADGE_DATA)) {
        if (!R[k]) err('badge-region', `徽章 ${k} 没有对应地区`);
    }
    for (const k of regionKeys) {
        if (!BADGE_DATA[k]) err('badge-region', `地区 ${k} 没有对应徽章`);
    }

    // ---------------- 路线 ----------------
    const routeIds = new Set();
    const obtainableByRoute = new Set();
    let prevMax = 0;
    regionKeys.forEach((k, regionIndex) => {
        const region = R[k];
        if (region.id !== k) err('region-id', `地区 key=${k} 的 id 字段为 ${region.id}`);
        if (!region.name) err('region-name', `地区 ${k} 缺少名称`);
        if (!Array.isArray(region.routes) || region.routes.length === 0) { err('region-routes', `地区 ${k} 没有路线`); return; }

        // 解锁条件必须指向上一地区的完整图鉴
        if (regionIndex === 0) {
            if (region.unlockCondition) err('unlock-first', `${k} 是起始地区，不应有解锁条件`);
        } else {
            const cond = region.unlockCondition;
            const prevKey = regionKeys[regionIndex - 1];
            if (!cond || cond.type !== 'pokedex_complete') err('unlock-condition', `${k} 缺少 pokedex_complete 解锁条件`);
            else if (cond.range[0] !== RANGES[prevKey][0] || cond.range[1] !== RANGES[prevKey][1]) {
                err('unlock-condition', `${k} 的解锁区间 ${cond.range} 与上一地区 ${prevKey} 的区间 ${RANGES[prevKey]} 不一致`);
            }
        }

        for (const route of region.routes) {
            if (routeIds.has(route.id)) err('route-dup', `路线 id 重复：${route.id}`);
            routeIds.add(route.id);
            const [lo, hi] = route.levelRange || [];
            if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || lo > hi) {
                err('route-level', `${route.id} 等级范围非法 ${route.levelRange}`);
                continue;
            }
            if (lo !== prevMax + 1) {
                warn('route-level-gap', `${route.id} 起始等级 ${lo} 与上一条路线结束等级 ${prevMax} 不衔接`);
            }
            prevMax = hi;
            if (!Array.isArray(route.pokemon) || route.pokemon.length === 0) {
                err('route-empty', `${route.id} 没有野生宝可梦`);
                continue;
            }
            const seenInRoute = new Set();
            for (const e of route.pokemon) {
                if (!P[e.id]) { err('route-pokemon', `${route.id} 引用了不存在的宝可梦 #${e.id}`); continue; }
                if (seenInRoute.has(e.id)) warn('route-dup-pokemon', `${route.id} 中 #${e.id} 出现多次`);
                seenInRoute.add(e.id);
                obtainableByRoute.add(e.id);
                if (typeof e.weight !== 'number' || !(e.weight > 0)) err('route-weight', `${route.id} #${e.id} 权重 ${e.weight} 非法`);
                const [elo, ehi] = e.levelRange || [];
                if (!Number.isInteger(elo) || !Number.isInteger(ehi) || elo < 1 || elo > ehi) {
                    err('route-pokemon-level', `${route.id} #${e.id} 等级范围非法 ${e.levelRange}`);
                } else if (elo < lo || ehi > hi) {
                    warn('route-pokemon-outside-range', `${route.id} #${e.id} 等级 ${elo}-${ehi} 超出路线范围 ${lo}-${hi}`);
                }
            }
        }
    });

    // ---------------- 可达性：按真实解锁规则模拟推进 ----------------
    const regionOf = (id) => rangeKeys.find(k => id >= RANGES[k][0] && id <= RANGES[k][1]);
    const unlocked = new Set([rangeKeys[0]]);
    const caught = new Set();
    let progressed = true;
    while (progressed) {
        progressed = false;
        for (const k of unlocked) for (const rt of R[k].routes) for (const e of rt.pokemon) if (P[e.id]) caught.add(e.id);
        let evoChanged = true;
        while (evoChanged) {
            evoChanged = false;
            for (const id of [...caught]) {
                const evo = P[id].evolvesTo;
                if (!evo) continue;
                for (const x of (Array.isArray(evo) ? evo : [evo])) {
                    // 进化目标所在世代的地区必须已解锁（与 _isEvolutionRegionUnlocked 一致）
                    if (P[x.id] && !caught.has(x.id) && unlocked.has(regionOf(x.id))) { caught.add(x.id); evoChanged = true; }
                }
            }
        }
        for (let i = 1; i < rangeKeys.length; i++) {
            const k = rangeKeys[i];
            if (unlocked.has(k)) continue;
            const [a, b] = RANGES[rangeKeys[i - 1]];
            let complete = true;
            for (let id = a; id <= b; id++) if (!caught.has(id)) { complete = false; break; }
            if (complete) { unlocked.add(k); progressed = true; }
            break;
        }
    }
    for (const k of rangeKeys) {
        if (!unlocked.has(k)) err('progression-blocked', `地区 ${k} 在规则下无法解锁（上一地区图鉴无法集齐）`);
    }
    for (const id of ids) {
        if (!caught.has(id)) err('unobtainable', `#${id} ${P[id].name} 无法获得（既不在任何路线，也无法进化得到）`);
    }

    // ---------------- 其它配置 ----------------
    for (const type of Object.keys(SKILL_DATA)) {
        if (!validTypes.has(type)) err('skill-type', `技能表中出现未知属性 ${type}`);
        const list = SKILL_DATA[type];
        if (list.length !== MAX_SKILL_LEVEL) err('skill-levels', `${type} 技能数量 ${list.length} ≠ ${MAX_SKILL_LEVEL}`);
        list.forEach((s, i) => {
            if (s.level !== i + 1) err('skill-levels', `${type} 第 ${i + 1} 项等级为 ${s.level}`);
            if (!(s.power > 0)) err('skill-power', `${type} Lv.${s.level} 威力 ${s.power} 非法`);
            if (i > 0 && s.power < list[i - 1].power) warn('skill-power-order', `${type} Lv.${s.level} 威力低于上一级`);
        });
    }
    for (const type of validTypes) {
        if (!SKILL_DATA[type]) err('skill-type', `属性 ${type} 缺少技能表`);
    }
    GEM_ATTRIBUTES.forEach(a => {
        if (!(a.min <= a.max)) err('gem-attr', `宝石属性 ${a.id} 的 min>max`);
    });
    GEM_QUALITIES.forEach(q => {
        if (!(q.weight > 0) || !(q.attrCount > 0)) err('gem-quality', `宝石品质 ${q.id} 配置非法`);
        if (!/^#[0-9a-fA-F]{6}$/.test(q.color)) err('gem-quality', `宝石品质 ${q.id} 颜色 ${q.color} 不是 #rrggbb`);
    });
    for (const [id, b] of Object.entries(BERRY_DATA)) {
        if (!IV_STAT_KEYS.includes(b.stat)) err('berry-stat', `树果 ${id} 的属性 ${b.stat} 非法`);
    }
    for (const [id, t] of Object.entries(TALENT_DATA)) {
        if (t.id !== id) err('talent-id', `天赋 key=${id} 的 id 字段为 ${t.id}`);
        if (!(t.maxLevel > 0)) err('talent-max', `天赋 ${id} maxLevel 非法`);
    }

    return {
        errors,
        warnings,
        stats: {
            pokemon: ids.length,
            regions: regionKeys.length,
            routes: routeIds.size,
            routablePokemon: obtainableByRoute.size,
        },
    };
}

module.exports = { validateGameData };
