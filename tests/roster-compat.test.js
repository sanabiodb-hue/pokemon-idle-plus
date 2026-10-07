'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, catchRange, ivs, plain, mulberry32, runOffline } = require('./helpers/game');

const healthy = (game) => assert.deepEqual(plain(game.roster.checkIntegrity()), [], '名册应满足全部不变量');

// 用“个体”接口创建同物种的第二只并放进队伍
function addIndividual(game, speciesId, o = {}) {
    const r = game.roster.create({ speciesId, nature: 'hardy', rng: () => 0.5, ...o });
    assert.ok(r.ok, r.code);
    return r.instance;
}

// ---------------------------------------------------------------- 12. 与现有系统兼容

test('新游戏：初始皮卡丘是一只“starter”个体，直接在队伍里；旧视图指向它', () => {
    const { game, ctx } = newGame();
    const gs = game.gameState;
    assert.equal(gs.schemaVersion, ctx.SAVE_SCHEMA_VERSION);
    assert.equal(game.roster.count(), 1);
    const p = game.roster.primaryOf(25);
    assert.equal(p.origin, 'starter');
    assert.equal(p.originRoute, null);
    assert.equal(p.level, 5);
    assert.equal(p.nature, 'hardy');
    assert.deepEqual(plain(gs.party), [p.uid]);
    assert.deepEqual(plain(gs.team), [25]);
    assert.equal(gs.caughtPokemon[25], p, 'caughtPokemon[25] 与个体是同一个对象');
    assert.equal(gs.pokedex[25], 'caught');
    assert.equal(game.getStoredData(25), p);
    healthy(game);
});

test('旧的捕获流程：首次击败创建一只“野外捕获”个体（进 PC），再次击败只提升个体值', () => {
    const { game } = newGame();
    const wild = game.createWildPokemon(19, 4);
    wild.ivs = { hp: 3, atk: 4, def: 5, spAtk: 6, spDef: 7, speed: 8 };
    game.processDefeat(wild);
    assert.equal(game.roster.countOfSpecies(19), 1);
    const p = game.roster.primaryOf(19);
    assert.equal(p.origin, 'wild');
    assert.equal(p.originRoute, 'kanto_route1');
    assert.equal(p.level, 1);
    assert.equal(p.battles, 0);
    assert.equal(game.roster.locate(p.uid).where, 'pc');
    assert.equal(game.gameState.caughtPokemon[19], p);
    assert.deepEqual(plain(p.ivs), { hp: 3, atk: 4, def: 5, spAtk: 6, spDef: 7, speed: 8 });

    const better = game.createWildPokemon(19, 4);
    better.ivs = ivs(31);
    game.processDefeat(better);
    assert.equal(game.roster.countOfSpecies(19), 1, '不会为同物种再造一只（旧规则）');
    assert.deepEqual(plain(p.ivs), ivs(31), '个体值直接更新在个体上');
    healthy(game);
});

test('旧接口修改旧视图 = 修改个体：addExpToPokemon / 个体值同步 / 技能升级', () => {
    const { game, ctx } = newGame();
    const p = game.roster.primaryOf(25);
    game.addExpToPokemon(25, ctx.getExpForLevel('medium', 12));
    assert.equal(p.level, 12);
    assert.equal(game.gameState.caughtPokemon[25].level, 12);
    assert.ok(p.stats.expGained > 0, '个体记录自己获得的经验');
    game.catchPokemonWithIvs(26, 1, ivs(9));              // 雷丘与皮卡丘同一进化链
    game.syncBestIvsInFamily(25, ivs(31));
    assert.deepEqual(plain(p.ivs), ivs(31));
    p.level = 1500;
    p.exp = ctx.getExpForLevel('medium', 1500);
    game.gameState.badges.unova = { unlocked: true, gem: null };
    for (let id = 494; id <= 649; id++) game.catchPokemonWithIvs(id, 1, ivs(0));
    assert.equal(game.upgradeSkill(25).success, true);
    assert.equal(p.skillLevel, 1);
    assert.equal(p.level < 1500, true, '技能升级会重置等级，直接作用在个体上');
    healthy(game);
});

test('旧的队伍接口：加入/移除队伍 = 把主个体在 PC 与队伍间移动（个体不会丢）', () => {
    const { game } = newGame();
    catchRange(game, 1, 8, ivs(5));
    const before = game.roster.count();
    assert.equal(game.addToTeamFromPokedex(4), true);
    assert.equal(game.gameState.team.includes(4), true);
    assert.equal(game.roster.locate(game.roster.primaryOf(4).uid).where, 'party');
    assert.equal(game.addToTeamFromPokedex(4), false, '已在队伍');
    assert.equal(game.addToTeamFromPokedex(150), false, '未捕获');
    for (const id of [1, 7, 2, 3]) game.addToTeamFromPokedex(id);
    assert.equal(game.addToTeamFromPokedex(5), false, '队伍已满');
    assert.equal(game.removeFromTeam(game.gameState.activePokemonIndex), false, '不能移除出战者');
    assert.equal(game.removeFromTeam(1), true);
    assert.equal(game.removeFromTeamByPokemonId(7), true);
    assert.equal(game.gameState.team.includes(7), false);
    assert.equal(game.roster.locate(game.roster.primaryOf(7).uid).where, 'pc');
    assert.equal(game.roster.count(), before, '个体总数不变');
    healthy(game);
});

test('旧代码直接改 gameState.team：下一次计算前自动对齐，原队伍成员回到 PC', () => {
    const { game } = newGame();
    catchRange(game, 1, 10, ivs(5));
    const starter = game.roster.primaryOf(25);
    game.gameState.team = [4, 7];
    game.gameState.activePokemonIndex = 0;
    const stats = game.calculateBattleStats(0);
    assert.ok(stats.hp > 0);
    assert.deepEqual(plain(game.gameState.party), [game.roster.primaryOf(4).uid, game.roster.primaryOf(7).uid]);
    assert.equal(game.roster.locate(starter.uid).where, 'pc');
    healthy(game);
});

test('旧的物种接口：getStoredData / createPokemon / getSkillForPokemon 对主个体生效', () => {
    const { game } = newGame();
    const p = game.roster.primaryOf(25);
    p.skillLevel = 2;
    assert.equal(game.getStoredData(25), p);
    assert.equal(game.createPokemon(25, true).level, p.level);
    assert.equal(game.getSkillForPokemon(25).skillLevel, 2);
    assert.deepEqual(plain(game.getSkillForPokemon(25)), plain(game.getSkillForInstance(p)));
    assert.equal(game.getExpProgress(25).percent >= 0, true);
    assert.equal(game.getSkillForPokemon(1), null, '没有个体的物种返回 null');
});

// ---------------------------------------------------------------- 3-6, 7. 个体在战斗系统里独立

test('同物种两只个体：战斗属性各按自己的等级/个体值/闪光计算', () => {
    const { game } = newGame();
    const a = game.roster.primaryOf(25);
    a.level = 20; a.ivs = ivs(0);
    const b = addIndividual(game, 25, { level: 60, ivs: ivs(31), shiny: true });
    game.roster.moveToParty(b.uid);
    game._invalidateAllCaches();
    assert.deepEqual(plain(game.gameState.team), [25, 25]);

    const sa = game.calculateStats({ id: 25, level: 20, ivs: ivs(0), isShiny: false });
    const sb = game.calculateStats({ id: 25, level: 60, ivs: ivs(31), isShiny: true });
    const at = game.calculateBattleStats(0);
    const bt = game.calculateBattleStats(1);
    // 公式：自己 + 队友 20%（图鉴里没有其它物种，所以 1% 加成为 0）
    assert.equal(at.hp, Math.floor(sa.hp + sb.hp * 0.2));
    assert.equal(bt.hp, Math.floor(sb.hp + sa.hp * 0.2));
    assert.equal(at.attack, Math.floor(sa.attack + sb.attack * 0.2));
    assert.equal(bt.attack, Math.floor(sb.attack + sa.attack * 0.2));
    assert.ok(bt.hp > at.hp && bt.speed > at.speed);
    healthy(game);
});

test('闪光独立：同物种、同等级、同个体值，闪光那只更强；改一只不影响另一只', () => {
    const { game } = newGame();
    const a = game.roster.primaryOf(25);
    a.level = 40; a.ivs = ivs(20);
    const b = addIndividual(game, 25, { level: 40, ivs: ivs(20), shiny: true });
    game._invalidateAllCaches();
    const sa = game._getInstanceStats(a);
    const sb = game._getInstanceStats(b);
    assert.ok(sb.hp > sa.hp && sb.attack > sa.attack && sb.defense > sa.defense);
    assert.equal(game.gameState.shinyDex[25], undefined, '非主个体闪光不会改旧的物种级标记');
    assert.equal(a.shiny, false);
    // 旧代码把物种标成闪光 → 只有主个体变闪光
    game.gameState.shinyDex[25] = true;
    game._touchSpecies(25);
    assert.equal(a.shiny, true);
    assert.equal(b.shiny, true);
    const c = addIndividual(game, 25, { level: 40, ivs: ivs(20), shiny: false });
    assert.equal(c.shiny, false, '新个体自己决定闪光，不受物种级标记影响');
});

test('经验独立：胜利后出战者拿 100%、队友各拿 50%，其余同物种个体不受影响', () => {
    const { game } = newGame();
    const a = game.roster.primaryOf(25);
    const b = addIndividual(game, 25, { level: 5 });
    const c = addIndividual(game, 25, { level: 5 });          // 留在 PC
    game.roster.moveToParty(b.uid);
    game.gameState.activePokemonIndex = 0;
    const exp0 = { a: a.exp, b: b.exp, c: c.exp };
    const wild = game.createWildPokemon(19, 40);
    const expected = Math.floor(game.getBaseExpYield(19, 40) * 40 / 7);
    const r = game._processVictoryRewards(wild, 25, 100, 100);
    assert.equal(r.expGained, expected);
    assert.equal(a.exp - exp0.a, expected);
    assert.equal(b.exp - exp0.b, Math.floor(expected * 0.5));
    assert.equal(c.exp, exp0.c, '物种已在队伍里，PC 里的同物种个体没有储备经验');
    // 战斗统计只记在出战者身上
    assert.equal(a.battles, 1);
    assert.equal(a.stats.victories, 1);
    assert.equal(b.battles, 0);
    assert.equal(a.stats.expGained, expected);
    assert.equal(b.stats.expGained, Math.floor(expected * 0.5));
    healthy(game);
});

test('等级独立：队友升级不会带动同物种的另一只；升级后各自重新计算属性', () => {
    const { game, ctx } = newGame();
    const a = game.roster.primaryOf(25);
    const b = addIndividual(game, 25, { level: 5, exp: ctx.getExpForLevel('medium', 5) });
    game.roster.moveToParty(b.uid);
    const sBefore = game._getInstanceStats(b);
    game.addExpToInstance(b, ctx.getExpForLevel('medium', 21));       // b 升到 21（Lv22 才进化）
    assert.equal(b.level, 21);
    assert.equal(a.level, 5);
    assert.notEqual(game._getInstanceStats(b), sBefore, '升级后缓存已失效');
    assert.ok(game._getInstanceStats(b).hp > sBefore.hp);
    assert.equal(game._getInstanceStats(a).hp, game.calculateStats({ id: 25, level: 5, ivs: a.ivs, isShiny: false }).hp);
});

test('技能独立：只有升过技能的那只个体使用技能威力', () => {
    const { game } = newGame();
    const a = game.roster.primaryOf(25);
    const b = addIndividual(game, 25, { level: 50 });
    game.roster.moveToParty(b.uid);
    a.skillLevel = 3;
    b.skillLevel = 0;
    const types = ['water'];
    assert.equal(game._getBestSkillForInstance(a, types).power > 0, true);
    assert.equal(game._getBestSkillForInstance(b, types).power, 0);
    game.gameState.activePokemonIndex = 1;
    game.startBattle();
    game.stopBattle();
    assert.equal(game.currentBattle.derived.activeInst, b);
    assert.equal(game.currentBattle.derived.playerLevel, 50);
    assert.equal(game.currentBattle.derived.playerPower, 50, '没有技能时用固定威力 50');
    game.setActivePokemon(0);
    assert.equal(game.currentBattle.derived.activeInst, a, '换人后战斗常量按新出战个体刷新');
    assert.ok(game.currentBattle.derived.playerPower > 50);
});

test('个体统计：伤害、暴击、承伤、倒下次数记在出战个体上', () => {
    const { game } = newGame();
    const a = game.roster.primaryOf(25);
    game.rng = () => 0.0;                       // 必暴击、随机系数 85%
    game.startBattle();
    game.stopBattle();
    const b = game.currentBattle;
    b.wildCurrentHp = 1e9; b.wildMaxHp = 1e9;
    b.playerTimer = b.playerNextAttack; b.enemyTimer = b.enemyNextAttack;
    game.rng = () => 0.99;                      // 闪避判定不触发
    game.battleTick();
    assert.ok(a.stats.damageDealt > 0);
    assert.ok(a.stats.damageTaken > 0);
    const dealt = a.stats.damageDealt;
    b.playerTimer = b.playerNextAttack;
    game.rng = () => 0.0;                       // 暴击
    game.battleTick();
    assert.ok(a.stats.damageDealt > dealt);
    assert.ok(a.stats.criticalHits >= 1);
    // 倒下
    b.playerCurrentHp = 1; b.enemyTimer = b.enemyNextAttack;
    game.rng = () => 0.99;
    game.battleTick();
    assert.equal(a.stats.faints, 1);
    game.stopBattle();
});

// ---------------------------------------------------------------- 进化

test('进化：为进化形态创建新的个体（继承个体值与性格，来历 evolution），换下原个体到 PC', () => {
    const { game, ctx } = newGame();
    game.catchPokemonWithIvs(1, 5, { hp: 31, atk: 20, def: 10, spAtk: 5, spDef: 1, speed: 0 });
    const base = game.roster.primaryOf(1);
    base.nature = 'modest';
    game.addToTeamFromPokedex(1);
    const events = [];
    game.onBattleEvent = (e, d) => events.push([e, d]);
    game.addExpToInstance(base, ctx.getExpForLevel('mediumSlow', 16));
    const evo = game.roster.primaryOf(2);
    assert.ok(evo);
    assert.equal(evo.origin, 'evolution');
    assert.equal(evo.level, 1);
    assert.equal(evo.nature, 'modest');
    assert.deepEqual(plain(evo.ivs), { hp: 31, atk: 20, def: 10, spAtk: 5, spDef: 1, speed: 0 });
    assert.notEqual(evo.ivs, base.ivs);
    assert.equal(game.roster.locate(evo.uid).where, 'party');
    assert.equal(game.roster.locate(base.uid).where, 'pc', '原个体仍然拥有，放进 PC');
    assert.equal(game.gameState.team.includes(1), false);
    assert.equal(game.gameState.team.includes(2), true);
    assert.equal(game.gameState.caughtPokemon[2], evo);
    const ev = events.find(e => e[0] === 'evolved');
    assert.equal(ev[1].uid, evo.uid);
    healthy(game);
});

test('进化：目标物种已拥有时不再进化（沿用旧规则），个体保持原样', () => {
    const { game, ctx } = newGame();
    game.catchPokemonWithIvs(1, 5, ivs(5));
    game.catchPokemonWithIvs(2, 1, ivs(5));        // 妙蛙草已拥有
    const base = game.roster.primaryOf(1);
    game.addExpToInstance(base, ctx.getExpForLevel('mediumSlow', 20));
    assert.equal(game.roster.countOfSpecies(2), 1);
    assert.equal(base.level, 20);
    healthy(game);
});

test('同物种非主个体升级进化：只替换它自己在队伍里的位置，主个体不受影响', () => {
    const { game, ctx } = newGame();
    const a = game.roster.primaryOf(25);              // 主个体，Lv5，在队伍里
    game.catchPokemonWithIvs(1, 5, ivs(5));
    const b = addIndividual(game, 1, { level: 5, ivs: ivs(9) });       // 妙蛙种子的第二只
    game.roster.moveToParty(b.uid);
    game.addExpToInstance(b, ctx.getExpForLevel('mediumSlow', 16));
    const evo = game.roster.primaryOf(2);
    assert.ok(evo, '妙蛙草应被创建');
    assert.deepEqual(plain(evo.ivs), ivs(9), '继承的是升级的那只（b）的个体值');
    assert.equal(game.roster.locate(evo.uid).where, 'party', 'b 在队伍里，所以进化形态接替它的位置');
    assert.equal(game.roster.locate(b.uid).where, 'pc');
    assert.equal(game.roster.primaryOf(1).level, 5, '主个体没有升级');
    assert.equal(game.roster.locate(a.uid).where, 'party');
    healthy(game);
});

// ---------------------------------------------------------------- 图鉴 1% 与储备经验的语义

test('储备经验与图鉴加成按“物种的主个体”计算；多出来的同物种个体不重复计入', () => {
    const { game } = newGame();
    catchRange(game, 1, 12, ivs(10));
    const dup = addIndividual(game, 1, { level: 77 });                 // 妙蛙种子的第二只，在 PC
    const prim = game.roster.primaryOf(1);
    const dupExp = dup.exp, primExp = prim.exp;
    const bonusBefore = game.calculateBattleStats(0).hp;
    const wild = game.createWildPokemon(19, 60);
    const r = game._processVictoryRewards(wild, 25, 100, 100);
    assert.ok(prim.exp > primExp, '主个体收到 1% 储备经验');
    assert.equal(dup.exp, dupExp, '非主个体不收储备经验（保持旧平衡，避免重复个体放大收益）');
    // 图鉴加成只算主个体：dup 的高等级不会抬高战斗属性
    game._invalidateAllCaches();
    const after = game.calculateBattleStats(0).hp;
    assert.ok(after >= bonusBefore);
    void r;
    healthy(game);
});

// ---------------------------------------------------------------- 离线

test('离线结算：只有队伍个体获得经验/统计，名册保持一致', async () => {
    const { game } = newGame({ seed: 3 });
    const a = game.roster.primaryOf(25);
    const b = addIndividual(game, 25, { level: 5, exp: 0 });
    game.roster.moveToParty(b.uid);
    const c = addIndividual(game, 25, { level: 5 });                  // 留在 PC
    const cExp = c.exp;
    const data = await runOffline(game, 20 * 60 * 1000);
    assert.ok(data.battles > 20);
    const totalVictories = game.roster.all().reduce((sum, i) => sum + i.stats.victories, 0);
    assert.equal(totalVictories, data.battles, '每场胜利都记在当时的出战个体上（含进化后接替的个体）');
    assert.ok(a.stats.damageDealt > 0 || b.stats.damageDealt > 0);
    assert.ok(b.stats.expGained > 0);
    assert.equal(c.exp, cExp);
    healthy(game);
});

// ---------------------------------------------------------------- 模糊测试：混用旧接口与新接口

test('模糊测试：随机混用旧接口与个体接口，名册不变量始终成立，战斗属性与参考算法一致', () => {
    const { game, ctx } = newGame({ seed: 21 });
    const rnd = mulberry32(99);
    const pick = (n) => 1 + Math.floor(rnd() * n);
    catchRange(game, 1, 40, ivs(6));

    // 参考算法：直接按定义用个体数据计算（20% 队友 + 1% 图鉴主个体，物种在队伍里则不计入图鉴）
    const reference = (i) => {
        const gs = game.gameState;
        const stat = (inst) => game.calculateStats({ id: inst.speciesId, level: inst.level, ivs: inst.ivs, isShiny: inst.shiny });
        const me = gs.ownedPokemon[gs.party[i]];
        const base = stat(me);
        let hp = 0;
        gs.party.forEach((uid, j) => { if (j !== i) hp += stat(gs.ownedPokemon[uid]).hp * 0.2; });
        const teamSet = new Set(gs.party.map(u => String(gs.ownedPokemon[u].speciesId)));
        let dex = 0;
        for (const id in gs.pokedex) {
            if (gs.pokedex[id] === 'caught' && !teamSet.has(id)) dex += stat(game.roster.primaryOf(Number(id))).hp * 0.01;
        }
        return Math.floor(base.hp + hp + dex);
    };
    for (let step = 0; step < 150; step++) {
        const op = Math.floor(rnd() * 10);
        const id = pick(60);
        const gs = game.gameState;
        switch (op) {
            case 0: game.catchPokemonWithIvs(id, 1, ivs(Math.floor(rnd() * 32))); break;
            case 1: { const p = game.roster.primaryOf(id); if (p) game.addExpToInstance(p, Math.floor(rnd() * 3e6)); break; }
            case 2: if (game.roster.primaryOf(id)) game.addToTeamFromPokedex(id); break;
            case 3: game.removeFromTeam(1 + Math.floor(rnd() * 5)); break;
            case 4: { const r = game.roster.create({ speciesId: id, level: pick(60), ivs: ivs(Math.floor(rnd() * 32)), shiny: rnd() < 0.3, rng: rnd, place: rnd() < 0.5 ? 'pc' : 'party' }); assert.ok(r.ok); break; }
            case 5: { const insts = game.roster.ofSpecies(id); if (insts.length) game.roster.moveToParty(insts[Math.floor(rnd() * insts.length)].uid); break; }
            case 6: { const insts = game.roster.ofSpecies(id); if (insts.length > 1) game.roster.release(insts[insts.length - 1].uid); break; }
            case 7: gs.activePokemonIndex = Math.floor(rnd() * gs.party.length); break;
            case 8: game._processVictoryRewards(game.createWildPokemon(pick(40), 20), gs.team[gs.activePokemonIndex], 100, 100); break;
            case 9: { const swapIdx = Math.floor(rnd() * gs.party.length); const u = game.roster.pc.uids()[0]; if (u) game.roster.swapPartyWithPc(swapIdx, u); break; }
        }
        game.roster.reconcile();
        assert.deepEqual(plain(game.roster.checkIntegrity()), [], `步骤 ${step} (op=${op}) 之后`);
        for (let i = 0; i < gs.party.length; i++) {
            assert.equal(game.calculateBattleStats(i).hp, reference(i), `步骤 ${step} 队伍位置 ${i}`);
        }
    }
    assert.ok(game.roster.count() > 40);
    void ctx;
});
