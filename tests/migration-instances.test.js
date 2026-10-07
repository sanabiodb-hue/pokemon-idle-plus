'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newGame, plain, createMemoryStorage } = require('./helpers/game');

const FIX = path.join(__dirname, 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');
const STATS = JSON.parse(read('legacy-battle-stats.json'));     // 由“旧代码”算出的数值

const CASES = [
    { name: 'v1（重构前，无 schemaVersion）', fixture: 'legacy-localstorage.txt', exportFile: 'legacy-export.txt', summary: 'legacy-summary.json', stats: STATS.v1, from: 1 },
    { name: 'v2（第 1 阶段，每物种一条 caughtPokemon）', fixture: 'legacy-v2-localstorage.txt', exportFile: 'legacy-v2-export.txt', summary: 'legacy-v2-summary.json', stats: STATS.v2, from: 2 },
];

// 直接读出旧存档里的原始数据（不经过新代码的任何迁移）
function rawLegacy(ctx, fixture) {
    return ctx.SaveCodec.decodePayload(read(fixture));
}

for (const c of CASES) {
    // ------------------------------------------------------------ 9. 迁移旧存档（真实存档）
    test(`迁移 ${c.name}：每个已捕获物种得到一只个体，并保留 个体值/等级/经验/闪光/技能等级`, () => {
        const storage = createMemoryStorage({ pokemon_idle_save: read(c.fixture) });
        const { game, ctx } = newGame({ storage, load: true });
        const raw = rawLegacy(ctx, c.fixture);
        assert.equal(game.loadReport.ok, true, game.loadReport.error);
        assert.equal(game.loadReport.fromVersion, c.from);
        assert.equal(raw.schemaVersion === undefined ? 1 : raw.schemaVersion, c.from, '夹具确实是该版本写出的');
        assert.equal(raw.ownedPokemon, undefined, '夹具里没有新结构');

        const gs = game.gameState;
        const speciesIds = Object.keys(raw.caughtPokemon).map(Number);
        assert.equal(speciesIds.length, 190);
        assert.equal(game.roster.count(), 190, '每个物种恰好一只个体');
        for (const id of speciesIds) {
            const legacy = raw.caughtPokemon[id];
            const inst = game.roster.primaryOf(id);
            assert.ok(inst, `物种 #${id} 应有个体`);
            assert.equal(inst.speciesId, id);
            assert.equal(inst.level, legacy.level, `#${id} 等级`);
            assert.equal(inst.exp, legacy.exp, `#${id} 经验`);
            assert.deepEqual(plain(inst.ivs), legacy.ivs, `#${id} 个体值`);
            assert.equal(inst.skillLevel, legacy.skillLevel || 0, `#${id} 技能等级`);
            assert.equal(inst.shiny, !!raw.shinyDex[id], `#${id} 闪光`);
            assert.equal(inst.origin, 'legacy_migration');
            assert.equal(inst.nature, ctx.DEFAULT_NATURE, '迁移后性格为中性，数值不变');
            assert.equal(inst.ability, null);
            assert.equal(inst.gender, null);
            assert.equal(inst.nickname, '');
            assert.equal(inst.caughtAt, null);
            assert.equal(inst.battles, 0);
            assert.equal(gs.caughtPokemon[id], inst, `#${id} 旧视图就是该个体`);
            assert.equal(gs.pokedex[id], 'caught');
        }
        assert.equal(new Set(game.roster.all().map(i => i.uid)).size, 190, 'uid 唯一');
        assert.deepEqual(plain(game.roster.checkIntegrity()), []);
    });

    test(`迁移 ${c.name}：队伍顺序、出战下标、PC 布局`, () => {
        const storage = createMemoryStorage({ pokemon_idle_save: read(c.fixture) });
        const { game, ctx } = newGame({ storage, load: true });
        const raw = rawLegacy(ctx, c.fixture);
        const gs = game.gameState;
        assert.deepEqual(plain(gs.team), raw.team, '旧 team 顺序不变');
        assert.equal(gs.party.length, raw.team.length);
        gs.party.forEach((uid, i) => assert.equal(gs.ownedPokemon[uid].speciesId, raw.team[i]));
        assert.equal(gs.activePokemonIndex, raw.activePokemonIndex);
        // 其余 185 只都在 PC：按图鉴编号顺序，每箱 30 只
        const inPc = game.roster.pc.uids().map(u => gs.ownedPokemon[u].speciesId);
        assert.equal(inPc.length, 190 - raw.team.length);
        assert.deepEqual(plain(inPc), [...inPc].sort((a, b) => a - b), 'PC 里按物种编号排序');
        assert.equal(gs.pc.boxes.length, Math.ceil(inPc.length / ctx.PC_BOX_CAPACITY));
        assert.equal(gs.pc.boxes[0].slots.filter(Boolean).length, ctx.PC_BOX_CAPACITY);
        assert.deepEqual(plain(gs.released), []);
        for (const uid of gs.party) assert.equal(game.roster.pc.contains(uid), false, '队伍成员不在 PC 里');
    });

    test(`迁移 ${c.name}：游戏数值与“旧代码”算出的完全一致（战斗属性/战力/潜力/经验条/总等级）`, () => {
        const storage = createMemoryStorage({ pokemon_idle_save: read(c.fixture) });
        const { game } = newGame({ storage, load: true });
        const gs = game.gameState;
        game._invalidateAllCaches();
        c.stats.team.forEach((id, i) => {
            const s = game.calculateBattleStats(i);
            assert.deepEqual({ hp: s.hp, attack: s.attack, defense: s.defense, speed: s.speed }, c.stats.battleStats[i], `战斗属性 #${id}`);
            assert.equal(game.calculatePower(id, true), c.stats.power[i], `战力 #${id}`);
            assert.equal(game.calculatePotential(id), c.stats.potential[i], `潜力 #${id}`);
            assert.deepEqual(plain(game.getExpProgress(id)), c.stats.expProgress[i], `经验条 #${id}`);
        });
        assert.equal(game.getTotalPokemonLevel(), c.stats.totalPokemonLevel);
        assert.equal(game.getSkillLevelSum(), c.stats.skillLevelSum);
        assert.equal(game.getTotalTalentPoints(), c.stats.talentPoints);
        assert.deepEqual(plain(game.getPokedexStats()), c.stats.pokedex);
        assert.equal(game.getShinyStats(), c.stats.shinyCount);
        void gs;
    });

    test(`迁移 ${c.name}：迁移后可以正常游戏（战斗/升级/捕获/进化），再存档再读取保持一致`, () => {
        const storage = createMemoryStorage({ pokemon_idle_save: read(c.fixture) });
        const { game, ctx } = newGame({ storage, load: true, seed: 5 });
        const route = game.getRoute(game.gameState.currentRoute);
        for (let i = 0; i < 80; i++) {
            const wild = game.generateWildPokemon(route);
            game._processVictoryRewards(wild, game.gameState.team[game.gameState.activePokemonIndex], 100, 100);
        }
        const active = game.getPartyInstance(game.gameState.activePokemonIndex);
        assert.ok(active.stats.victories > 0 || game.gameState.stats.totalBattles >= 600);
        assert.deepEqual(plain(game.roster.checkIntegrity()), []);

        const r = game.saveNow();
        assert.equal(r.ok, true);
        const before = plain(game.gameState);
        const { game: g2 } = newGame({ storage, load: true });
        assert.equal(g2.loadReport.fromVersion, ctx.SAVE_SCHEMA_VERSION);
        assert.deepEqual(plain(g2.gameState), before, '读取后的状态与保存前逐项一致');
        assert.deepEqual(plain(g2.roster.checkIntegrity()), []);
        // 旧视图指向主个体（同一引用）；游戏过程中最后一只个体进化走了的物种指向图鉴存档
        for (const sp of Object.keys(g2.gameState.caughtPokemon)) {
            const live = g2.roster.primaryOf(Number(sp));
            assert.equal(g2.gameState.caughtPokemon[sp], live || g2.gameState.archivedSpecies[sp], `读档后 #${sp} 的旧视图`);
        }
    });

    test(`迁移 ${c.name}：保留迁移前的原始存档副本，便于回退`, () => {
        const raw = read(c.fixture);
        const storage = createMemoryStorage({ pokemon_idle_save: raw });
        const { ctx } = newGame({ storage, load: true });
        assert.equal(storage.getItem(ctx.SAVE_PREMIGRATION_PREFIX + c.from), raw);
    });

    // ------------------------------------------------------------ 10. 导出/导入
    test(`导入 ${c.name} 的“导出存档”文本：同样迁移成个体`, () => {
        const { game } = newGame();
        const res = game.importSave(read(c.exportFile));
        assert.equal(res.success, true, res.message);
        assert.equal(res.fromVersion, c.from);
        assert.equal(game.roster.count(), 190);
        assert.deepEqual(plain(game.gameState.team), JSON.parse(read(c.summary)).team);
        assert.deepEqual(plain(game.roster.checkIntegrity()), []);
        const s = game.calculateBattleStats(0);
        assert.equal(s.hp, c.stats.battleStats[0].hp);
    });
}

test('迁移是幂等的：对已迁移的数据再次迁移，结果完全相同', () => {
    const { ctx } = newGame();
    const raw = ctx.SaveCodec.decodePayload(read('legacy-localstorage.txt'));
    const once = JSON.parse(JSON.stringify(raw));
    ctx.migrateLegacyToInstances(once);
    const twice = JSON.parse(JSON.stringify(once));
    ctx.migrateLegacyToInstances(twice);
    assert.deepEqual(plain(twice.ownedPokemon), plain(once.ownedPokemon));
    assert.deepEqual(plain(twice.party), plain(once.party));
    assert.deepEqual(plain(twice.pc), plain(once.pc));
    assert.deepEqual(plain(twice.speciesPrimary), plain(once.speciesPrimary));
    assert.equal(twice.nextPokemonSeq, once.nextPokemonSeq);
});

test('迁移是确定性的：同一份旧存档每次得到相同的 uid 与布局', () => {
    const { ctx } = newGame();
    const mk = () => { const r = ctx.SaveCodec.decodePayload(read('legacy-v2-localstorage.txt')); ctx.migrateLegacyToInstances(r); return plain(r); };
    const a = mk(), b = mk();
    assert.deepEqual(a.ownedPokemon, b.ownedPokemon);
    assert.deepEqual(a.pc, b.pc);
    assert.equal(a.ownedPokemon.p1.speciesId, 1, 'uid 按物种编号升序分配');
    assert.equal(a.nextPokemonSeq, 191);
});

test('迁移对垃圾数据宽容：无效物种/重复队伍/缺字段不会崩溃', () => {
    const { ctx } = newGame();
    const data = {
        caughtPokemon: { 25: { level: 5, exp: 0, ivs: { hp: 1 } }, 99999: { level: 3 }, abc: {}, 4: null, 7: { level: 'x' } },
        team: [25, 25, 99999, 'q', 7, 4, 4],
        shinyDex: { 25: true }, activePokemonIndex: 1,
    };
    const { created } = ctx.migrateLegacyToInstances(data);
    assert.equal(created, 2, '只有 25 和 7 是有效的');
    assert.deepEqual(plain(data.party.map(u => data.ownedPokemon[u].speciesId)), [25, 7]);
    assert.equal(data.ownedPokemon[data.party[0]].shiny, true);
    // 没有 caughtPokemon / team 的空对象也不崩溃
    const empty = ctx.migrateLegacyToInstances({});
    assert.equal(empty.created, 0);
    assert.deepEqual(plain(empty.data.party), []);
    assert.equal(empty.data.pc.boxes.length, 1);
});

test('迁移后的“全部已捕获”大图鉴（1073 种）：PC 箱子数量、总个体数与性能', () => {
    const { ctx } = newGame();
    const caughtPokemon = {};
    for (let id = 1; id <= 1073; id++) caughtPokemon[id] = { level: id, exp: 0, ivs: { hp: 1, atk: 2, def: 3, spAtk: 4, spDef: 5, speed: 6 }, skillLevel: 0 };
    const t0 = Date.now();
    const r = ctx.processSaveObject({ team: [25, 1], caughtPokemon, pokedex: {}, schemaVersion: 2, activePokemonIndex: 0 });
    const ms = Date.now() - t0;
    assert.equal(r.ok, true, r.error);
    assert.equal(Object.keys(r.state.ownedPokemon).length, 1073);
    assert.equal(r.state.pc.boxes.length, Math.ceil(1071 / 30));
    assert.ok(ms < 1500, `迁移+清洗 1073 只应当很快，实际 ${ms}ms`);
});
