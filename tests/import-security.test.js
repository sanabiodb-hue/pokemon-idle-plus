'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, catchRange, ivs, plain, createMemoryStorage } = require('./helpers/game');

// 递归收集对象中所有字符串（含 key）
function allStrings(value, out = []) {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(v => allStrings(v, out));
    else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) { out.push(k); allStrings(v, out); }
    }
    return out;
}
const DANGEROUS = /[<>"'`&]/;

function validBase() {
    const { game } = newGame();
    catchRange(game, 1, 10, ivs(3));
    return plain(game._prepareStateForSave());
}

const XSS = '<img src=x onerror="alert(1)">';

test('恶意宝石：名称/颜色/图标/单位/uid 一律由配置重建，HTML 无法进入状态', () => {
    const { ctx } = newGame();
    const s = validBase();
    s.gems = [{
        uid: '"><script>alert(1)</script>',
        quality: 'rare', qualityName: XSS, qualityColor: 'red;background:url(javascript:alert(1))',
        attrs: [
            { id: 'crit_rate', name: XSS, value: 3, unit: XSS, icon: XSS },
            { id: '<b>fake</b>', name: 'x', value: 1 },
            { id: 'hp_bonus', value: 9999 },
        ],
        locked: 'yes',
    }];
    s.badges = { kanto: { unlocked: true, gem: { uid: "a'b", quality: 'epic', qualityName: XSS, attrs: [{ id: 'atk_bonus', value: -50 }] } } };
    const r = ctx.processSaveObject(s);
    assert.equal(r.ok, true);
    const gem = r.state.gems[0];
    const rare = ctx.GEM_QUALITIES.find(q => q.id === 'rare');
    assert.equal(gem.qualityName, rare.name);
    assert.equal(gem.qualityColor, rare.color);
    assert.match(gem.uid, /^[A-Za-z0-9_-]{1,64}$/);
    assert.equal(gem.locked, false, 'locked 必须是严格的布尔 true 才成立');
    assert.deepEqual(plain(gem.attrs.map(a => a.id)), ['crit_rate', 'hp_bonus']);
    const crit = gem.attrs[0];
    assert.equal(crit.name, ctx.GEM_ATTRIBUTES.find(a => a.id === 'crit_rate').name);
    assert.equal(crit.unit, '%');
    assert.equal(gem.attrs[1].value, 5, '数值被夹到配置范围 [min,max]');
    const eq = r.state.badges.kanto.gem;
    assert.equal(eq.attrs[0].value, 1, '负数夹到 min');
    assert.match(eq.uid, /^[A-Za-z0-9_-]{1,64}$/);
    for (const str of allStrings(r.state)) assert.doesNotMatch(str, DANGEROUS, `不应含危险字符: ${str}`);
});

test('原型污染：__proto__ / constructor 键不会污染 Object.prototype', () => {
    const { ctx } = newGame();
    const raw = '{"team":[25],"caughtPokemon":{"25":{"level":5,"exp":0,"ivs":{"hp":1}},"__proto__":{"polluted":true}},' +
        '"pokedex":{"__proto__":{"polluted":true},"25":"caught"},"settings":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}},' +
        '"talents":{"__proto__":{"polluted":true}},"badges":{"__proto__":{"unlocked":true}},"berryBag":{"__proto__":1},"berryFed":{"__proto__":{"a":1}},' +
        '"__proto__":{"polluted":true}}';
    const r = ctx.processSaveObject(JSON.parse(raw));
    assert.equal(r.ok, true);
    assert.equal(({}).polluted, undefined);
    assert.equal(Object.prototype.polluted, undefined);
    assert.equal(r.state.polluted, undefined);
    assert.deepEqual(Object.keys(r.state.settings), []);
    assert.deepEqual(Object.keys(r.state.badges), []);
});

test('数值与类型被强制：负数/NaN/超界/字符串', () => {
    const { ctx } = newGame();
    const s = validBase();
    s.gold = -5;
    s.stats = { totalBattles: 'abc', totalExp: -1, totalGold: Infinity };
    s.caughtPokemon[25] = { level: 99999999, exp: -10, ivs: { hp: 99, atk: -5, def: 'x', spAtk: 12.7 }, skillLevel: 77 };
    s.caughtPokemon[26] = { level: 'high', exp: NaN, ivs: null };
    s.activePokemonIndex = 99;
    s.tower = { currentFloor: 9999, highestFloor: -3, enemies: [1, 2], currentEnemyIndex: 7 };
    s.berryPlots = [{ berryId: 'nope', plantedAt: 1 }, { berryId: 'hp_berry', plantedAt: 'x' }];
    s.berryBag = { hp_berry: -4, atk_berry: 2.9, evil: 5 };
    s.talents = { exp_bonus: 99999, nonsense: 5, gemAttrChoice: '<b>' };
    s.currentRoute = 'no_such_route';
    s.currentRegion = 'atlantis';
    const r = ctx.processSaveObject(s);
    assert.equal(r.ok, true);
    const st = r.state;
    assert.equal(st.gold, 0);
    assert.equal(st.stats.totalBattles, 0);
    assert.equal(st.stats.totalExp, 0);
    assert.equal(st.stats.totalGold, 0);
    assert.equal(st.caughtPokemon[25].level, ctx.MAX_POKEMON_LEVEL);
    assert.equal(st.caughtPokemon[25].exp, 0);
    assert.deepEqual(plain(st.caughtPokemon[25].ivs), { hp: 31, atk: 0, def: 0, spAtk: 12, spDef: 0, speed: 0 });
    assert.equal(st.caughtPokemon[25].skillLevel, ctx.MAX_SKILL_LEVEL);
    assert.equal(st.caughtPokemon[26].level, 1);
    assert.equal(st.activePokemonIndex, 0);
    assert.equal(st.tower.currentFloor, ctx.TOWER_MAX_FLOOR);
    assert.equal(st.tower.highestFloor, 0);
    assert.equal(st.tower.enemies, null, '不完整的塔敌人列表被丢弃，由游戏重新生成');
    assert.equal(st.tower.currentEnemyIndex, 0);
    assert.equal(st.berryPlots.length, 1);
    assert.deepEqual(plain(st.berryBag), { atk_berry: 2 });
    assert.deepEqual(plain(st.talents), { exp_bonus: 100 });
    assert.equal(st.currentRoute, 'kanto_route1');
    assert.equal(st.currentRegion, 'kanto');
});

test('图鉴一致性：声称已捕获但没有数据的宝可梦降级为“已见过”', () => {
    const { ctx } = newGame();
    const s = validBase();
    s.pokedex[150] = 'caught';          // 没有 caughtPokemon[150]
    s.pokedex[151] = 'garbage';
    s.pokedex[99999] = 'caught';
    const r = ctx.processSaveObject(s);
    assert.equal(r.state.pokedex[150], 'seen');
    assert.equal(r.state.pokedex[151], undefined);
    assert.equal(r.state.pokedex[99999], undefined);
});

test('设置项：只接受白名单取值', () => {
    const { ctx } = newGame();
    const s = validBase();
    s.settings = { autoSwitchBest: 'yes', oneShotStrategy: '<x>', autoRouteSwitch: true, routeSwitchCondition: 'whatever', theme: 'url(javascript:1)', evil: 1 };
    const r = ctx.processSaveObject(s);
    assert.deepEqual(plain(r.state.settings), { autoRouteSwitch: true });
});

test('当前敌人：名称由数据表重建，等级被限制；无效 id 则丢弃', () => {
    const { ctx } = newGame();
    const s = validBase();
    s.currentEnemy = { id: 19, name: XSS, level: 99999999999, ivs: { hp: 5 }, isShiny: 'true', uid: '<x>', currentHp: 10 };
    let r = ctx.processSaveObject(s);
    assert.equal(r.state.currentEnemy.name, ctx.POKEMON_DATA[19].name);
    assert.equal(r.state.currentEnemy.isShiny, false);
    assert.match(r.state.currentEnemy.uid, /^[A-Za-z0-9_-]+$/);
    assert.ok(r.state.currentEnemy.level <= 1000000);
    s.currentEnemy = { id: 424242, name: 'x', level: 5 };
    r = ctx.processSaveObject(s);
    assert.equal(r.state.currentEnemy, null);
});

test('宝石 uid 重复会被修复（对应旧版批量购买的重复 uid 缺陷）', () => {
    const { game, ctx } = newGame();
    const s = validBase();
    const g = game.generateGemByQuality('common');
    s.gems = [g, { ...g }, { ...g }];
    const r = ctx.processSaveObject(s);
    assert.equal(r.state.gems.length, 3);
    assert.equal(new Set(r.state.gems.map(x => x.uid)).size, 3);
});

test('导入：非法输入返回明确原因，且不改动当前游戏', () => {
    const { game } = newGame();
    catchRange(game, 1, 5, ivs(1));
    game.saveNow();
    const snapshot = JSON.stringify(game.gameState);
    const cases = [
        ['', /为空/],
        ['   ', /为空/],
        ['not base64 !!!', /Base64/],
        ['{"a":', /JSON/],
        ['[]', /对象|队伍/],
        ['null', /./],
        ['{}', /队伍/],
        ['{"team":[]}', /队伍/],
        ['{"team":[999999]}', /队伍/],
        [Buffer.from('LZ:乱码').toString('base64'), /解压|JSON/],
        ['x'.repeat(31 * 1000 * 1000), /过大/],
    ];
    for (const [input, re] of cases) {
        const r = game.importSave(input);
        assert.equal(r.success, false, `应拒绝: ${input.slice(0, 30)}`);
        assert.match(r.message, re, `输入 ${input.slice(0, 30)} 的原因`);
        assert.equal(JSON.stringify(game.gameState), snapshot, '失败的导入不得修改当前状态');
    }
});

test('导入：成功后先备份当前存档，并重置战斗与缓存', () => {
    const { game, storage, ctx } = newGame();
    catchRange(game, 1, 30, ivs(2));
    game.saveNow();
    const exported = game.exportSave();
    const mainBefore = storage.getItem('pokemon_idle_save');

    const { game: other } = newGame({ seed: 9 });
    other.catchPokemonWithIvs(150, 1, ivs(4));
    other.gameState.gold = 777;
    other.saveNow();
    const exported2 = other.exportSave();

    game.startBattle();                     // 产生旧战斗状态
    game.stopBattle();
    assert.ok(game.currentBattle);
    const res = game.importSave(exported2);
    assert.equal(res.success, true);
    assert.equal(game.gameState.gold, 777);
    assert.equal(game.currentBattle, null);
    assert.equal(storage.getItem(ctx.SAVE_BACKUP_KEYS[0]), mainBefore, '导入前的存档应被备份');
    assert.ok(game._importedLastSave);
    // 缓存已重置：队伍战斗属性来自导入的存档
    assert.ok(game.calculateBattleStats(0));
    // 往返：能导回原来的存档
    assert.equal(game.importSave(exported).success, true);
    assert.equal(Object.keys(game.gameState.caughtPokemon).length >= 30, true);
});

test('导入：兼容多种文本形式（Base64 / 原始 LZ: / 纯 JSON）', () => {
    const { game, ctx } = newGame();
    catchRange(game, 1, 12, ivs(2));
    const state = plain(game._prepareStateForSave());
    const json = JSON.stringify(state);
    const payload = ctx.SaveCodec.encodePayload(json);
    // 旧版导出算法：btoa(unescape(encodeURIComponent(payload)))
    const oldStyle = btoa(unescape(encodeURIComponent(payload)));
    for (const [label, text] of [['旧版 Base64', oldStyle], ['原始 LZ:', payload], ['纯 JSON', json], ['带空白换行的 Base64', oldStyle.replace(/(.{60})/g, '$1\n') + '\n']]) {
        const { game: g } = newGame();
        const res = g.importSave(text);
        assert.equal(res.success, true, `${label}: ${res.message}`);
        assert.equal(Object.keys(g.gameState.caughtPokemon).length >= 12, true, label);
    }
});

test('读档修正会以警告形式返回给界面', () => {
    const { game } = newGame();
    const s = plain(game._prepareStateForSave());
    s.currentRoute = 'bogus';
    s.gems = [{ quality: 'nope', attrs: [] }];
    const res = game.importSave(JSON.stringify(s));
    assert.equal(res.success, true);
    assert.ok(res.warnings.length >= 2);
});

test('escapeHtml / safeCssColor', () => {
    const { ctx } = newGame();
    assert.equal(ctx.escapeHtml('<a href="x">&\'`</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&#96;&lt;/a&gt;');
    assert.equal(ctx.escapeHtml(null), '');
    assert.equal(ctx.escapeHtml(5), '5');
    assert.equal(ctx.safeCssColor('#a0a0a0'), '#a0a0a0');
    assert.equal(ctx.safeCssColor('#abc'), '#abc');
    assert.equal(ctx.safeCssColor('red;background:url(x)'), '#a0a0a0');
    assert.equal(ctx.safeCssColor('#12345'), '#a0a0a0');
    assert.equal(ctx.safeCssColor(undefined, '#000000'), '#000000');
});
