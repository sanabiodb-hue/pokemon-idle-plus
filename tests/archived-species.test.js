'use strict';
// 第 3 阶段：图鉴存档（archivedSpecies）——最后一只个体进化走后，原物种仍在图鉴里的记录
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain } = require('./helpers/game');

const expFor = (ctx, id, lv) => ctx.getExpForLevel(ctx.POKEMON_DATA[id].expGroup, lv);

// 皮卡丘进化成雷丘，皮卡丘变成图鉴存档
function archivedGame() {
    const env = newGame();
    const { game, ctx } = env;
    const a = game.roster.primaryOf(25);
    a.level = 21; a.exp = expFor(ctx, 25, 21);
    game.addExpToInstance(a, expFor(ctx, 25, 22) - a.exp);
    assert.ok(game.gameState.archivedSpecies[25]);
    game.gameState.currentEnemy = null;
    return { ...env, a };
}
const rawOf = (game) => JSON.parse(JSON.stringify(game.gameState));

test('存档里的 archivedSpecies 经净化后原样保留，旧视图指向它', () => {
    const { game, ctx } = archivedGame();
    const out = ctx.sanitizeSave(rawOf(game));
    assert.equal(out.ok, true, out.errors.join());
    const st = out.state;
    assert.deepEqual(plain(st.archivedSpecies[25]), plain(game.gameState.archivedSpecies[25]));
    assert.equal(st.caughtPokemon[25], st.archivedSpecies[25]);
    assert.equal(st.pokedex[25], 'caught');
    assert.equal(st.speciesPrimary[25], undefined);
    assert.deepEqual(plain(ctx.validateRosterIntegrity(st)), []);
});

test('净化：非法/越界/危险的存档记录被丢弃或夹紧', () => {
    const { game, ctx } = archivedGame();
    const raw = rawOf(game);
    delete raw.caughtPokemon[25];       // 旧镜像和存档并存时镜像优先（见下一个用例），这里只测存档本身
    raw.archivedSpecies = {
        25: { speciesId: 25, level: 99999999, exp: -5, ivs: { hp: 99, atk: -1, def: 'x' }, skillLevel: 1e9, evil: '<script>' },
        99999: { level: 5 },            // 未知物种
        abc: { level: 5 },
        __proto__: { level: 1 },
        26: { level: 5 },               // 雷丘有活着的个体：不需要存档
        4: 'junk',
    };
    const out = ctx.sanitizeSave(raw);
    assert.equal(out.ok, true);
    const arch = out.state.archivedSpecies;
    assert.deepEqual(Object.keys(arch), ['25']);
    assert.equal(arch[25].level, ctx.MAX_POKEMON_LEVEL);
    assert.ok(arch[25].exp >= 0);
    assert.deepEqual(plain(arch[25].ivs), { hp: 31, atk: 0, def: 0, spAtk: 0, spDef: 0, speed: 0 });
    assert.equal(arch[25].skillLevel, ctx.MAX_SKILL_LEVEL);
    assert.equal('evil' in arch[25], false);
    assert.equal(Object.prototype.hasOwnProperty.call(arch, '__proto__'), false);
    assert.deepEqual(plain(ctx.validateRosterIntegrity(out.state)), []);
    assert.equal(Object.prototype.polluted, undefined);
});

test('旧镜像里的数值（caughtPokemon）覆盖存档，与第 2 阶段对主个体的处理一致', () => {
    const { game, ctx } = archivedGame();
    const raw = rawOf(game);
    raw.caughtPokemon[25] = { speciesId: 25, level: 40, exp: expFor(ctx, 25, 40), ivs: ivs(9), skillLevel: 2 };
    const out = ctx.sanitizeSave(raw);
    assert.equal(out.state.archivedSpecies[25].level, 40);
    assert.deepEqual(plain(out.state.archivedSpecies[25].ivs), ivs(9));
    assert.equal(out.state.caughtPokemon[25], out.state.archivedSpecies[25]);
});

test('该物种已有活着的个体时，存档被丢弃（不会同时存在）', () => {
    const { game, ctx } = archivedGame();
    game.roster.create({ speciesId: 25, rng: () => 0.5 });          // 捡回一只皮卡丘
    const raw = rawOf(game);
    raw.archivedSpecies = { 25: { speciesId: 25, level: 30, exp: 0, ivs: ivs(1), skillLevel: 0 } };
    const out = ctx.sanitizeSave(raw);
    assert.equal(out.state.archivedSpecies[25], undefined);
    assert.equal(out.state.caughtPokemon[25], out.state.ownedPokemon[out.state.speciesPrimary[25]]);
    assert.deepEqual(plain(ctx.validateRosterIntegrity(out.state)), []);
});

test('完整性检查能发现矛盾：存档与活个体并存、旧视图没指向存档', () => {
    const { game, ctx } = archivedGame();
    const st = game.gameState;
    assert.deepEqual(plain(game.roster.checkIntegrity()), []);
    st.caughtPokemon[25] = { ...st.archivedSpecies[25] };           // 不是同一个对象
    assert.ok(game.roster.checkIntegrity().some(p => p.includes('图鉴存档')));
    st.caughtPokemon[25] = st.archivedSpecies[25];
    delete st.pokedex[25];
    assert.ok(game.roster.checkIntegrity().length > 0);
    st.pokedex[25] = 'caught';
    const extra = game.roster.create({ speciesId: 25, rng: () => 0.5 }).instance;
    st.archivedSpecies[25] = { speciesId: 25, level: 1, exp: 0, ivs: ivs(0), skillLevel: 0 };
    assert.ok(game.roster.checkIntegrity().some(p => p.includes('已有个体')));
    delete st.archivedSpecies[25];
    void extra; void ctx;
});

test('导出文本 → 导入：图鉴存档完整往返', () => {
    const { game } = archivedGame();
    const text = game.exportSave();
    const { game: g2 } = newGame();
    const res = g2.importSave(text);
    assert.equal(res.success, true, res.message);
    assert.deepEqual(plain(g2.gameState.archivedSpecies), plain(game.gameState.archivedSpecies));
    assert.equal(g2.gameState.caughtPokemon[25], g2.gameState.archivedSpecies[25]);
    assert.deepEqual(plain(g2.roster.checkIntegrity()), []);
});

test('第 2 阶段的存档（没有 archivedSpecies 字段）：读取后得到空表，行为与之前一致', () => {
    const { game, ctx, storage } = newGame();
    const raw = rawOf(game);
    delete raw.archivedSpecies;
    const out = ctx.sanitizeSave(raw);
    assert.deepEqual(plain(out.state.archivedSpecies), {});
    void storage;
});

test('迁移 v2 → v3 在需要时补上 archivedSpecies，并且幂等', () => {
    const { ctx } = newGame();
    const data = {
        caughtPokemon: { 25: { level: 5, exp: 0, ivs: ivs(3) } }, team: [25], shinyDex: {}, pokedex: { 25: 'caught' },
    };
    ctx.migrateLegacyToInstances(data);
    assert.deepEqual(plain(data.archivedSpecies), {});
    const once = JSON.parse(JSON.stringify(data));
    ctx.migrateLegacyToInstances(data);
    assert.deepEqual(plain(data.archivedSpecies), plain(once.archivedSpecies));
    assert.equal(Object.keys(data.ownedPokemon).length, 1);
});

test('图鉴存档的属性：1% 图鉴加成缓存会随存档等级变化而失效', () => {
    const { game } = archivedGame();
    const t = game.gameState.team.slice();
    const before = game._getPokedexBonus(t).hp;
    game.gameState.archivedSpecies[25].level = 90;
    game._touchSpecies(25);
    const after = game._getPokedexBonus(t).hp;
    assert.ok(after > before);
});
