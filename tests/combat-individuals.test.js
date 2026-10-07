'use strict';
// 第 3 阶段：战斗审计——同物种的两只个体（属性不同）在战斗里互不干扰，永远使用“出战位置上的那一只”
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain, runOffline } = require('./helpers/game');

const healthy = (game) => assert.deepEqual(plain(game.roster.checkIntegrity()), [], '名册应满足全部不变量');

// 队伍：[A(强), B(弱)]，同为皮卡丘；C 在 PC 里（第三只）
function twoPikachu(game) {
    const starter = game.roster.primaryOf(25);
    Object.assign(starter, { level: 50, ivs: ivs(31), nature: 'jolly', skillLevel: 0 });
    starter.exp = game.ctxExp ? starter.exp : starter.exp;
    const r = game.roster.create({ speciesId: 25, level: 8, ivs: ivs(0), nature: 'bold', rng: () => 0.5, place: 'party' });
    const c = game.roster.create({ speciesId: 25, level: 30, ivs: ivs(15), nature: 'calm', rng: () => 0.5, place: 'pc' });
    game.roster.reconcile();
    game._invalidateAllCaches();
    return { a: starter, b: r.instance, c: c.instance };
}

function prime(game, { rng = 0.99 } = {}) {
    game.rng = () => rng;
    game.startBattle();
    game.stopBattle();
    const b = game.currentBattle;
    b.wildCurrentHp = 1e9; b.wildMaxHp = 1e9;
    return b;
}

test('出战的是哪一只，战斗用的就是哪一只：等级、属性、统计都来自它', () => {
    const { game } = newGame();
    const { a, b } = twoPikachu(game);
    game.setActivePokemon(1);
    const battle = prime(game);
    assert.equal(battle.derived.activeInst, b);
    assert.equal(battle.derived.playerLevel, 8);
    battle.playerTimer = battle.playerNextAttack; battle.enemyTimer = 0;
    game.battleTick();
    assert.ok(b.stats.damageDealt > 0);
    assert.equal(a.stats.damageDealt, 0, '另一只皮卡丘不受影响');

    game.setActivePokemon(0);
    assert.equal(game.currentBattle.derived.activeInst, a);
    assert.equal(game.currentBattle.derived.playerLevel, 50);
    healthy(game);
});

test('同物种两只的伤害不同：强的那只打出更高的伤害', () => {
    const { game } = newGame();
    twoPikachu(game);
    const dmg = [];
    for (const idx of [0, 1]) {
        game.setActivePokemon(idx);
        const battle = prime(game);
        const events = [];
        game.onBattleEvent = (e, d) => events.push([e, d]);
        battle.playerTimer = battle.playerNextAttack; battle.enemyTimer = 0;
        game.battleTick();
        dmg.push(events.find(e => e[0] === 'playerAttack')[1].damage);
        game.onBattleEvent = null;
    }
    assert.ok(dmg[0] > dmg[1], `Lv50/31V 的伤害 ${dmg[0]} 应高于 Lv8/0V 的 ${dmg[1]}`);
});

test('技能等级是个体自己的：升过技能的那只用更强的技能，另一只不受影响', () => {
    const { game, ctx } = newGame();
    const { a, b } = twoPikachu(game);
    a.skillLevel = ctx.MAX_SKILL_LEVEL;
    b.skillLevel = 0;
    game._invalidateAllCaches();
    game.setActivePokemon(0);
    const powerA = prime(game).derived.playerPower;
    game.setActivePokemon(1);
    const powerB = prime(game).derived.playerPower;
    assert.ok(powerA > powerB, `${powerA} > ${powerB}`);
    assert.equal(b.skillLevel, 0);
});

test('胜利经验：出战个体拿全额，队伍里的同物种队友拿各自的 50%，PC 里的第三只一分不拿', () => {
    const { game } = newGame();
    const { a, b, c } = twoPikachu(game);
    const exp0 = { a: a.exp, b: b.exp, c: c.exp };
    const lv0 = c.level;
    const wild = game.createWildPokemon(19, 40);
    game.gameState.activePokemonIndex = 0;
    const r = game._processVictoryRewards(wild, 25, 100, 100);
    assert.ok(a.exp - exp0.a >= r.expGained, '出战者拿全额（升级时 exp 只增不减）');
    assert.ok(b.exp > exp0.b, '队友拿到一份');
    assert.ok(b.exp - exp0.b < a.exp - exp0.a);
    assert.equal(c.exp, exp0.c, 'PC 里的第三只没有经验——队伍里已有同物种，储备经验也不发');
    assert.equal(c.level, lv0);
    assert.equal(a.stats.victories, 1);
    assert.equal(b.stats.victories, 0);
    assert.equal(a.battles, 1);
    assert.equal(b.battles, 0);
    healthy(game);
});

test('队伍里的同物种个体不会重复吃图鉴储备经验；队伍外的主个体照常拿 1%', () => {
    const { game } = newGame();
    const { a, b, c } = twoPikachu(game);
    game.partyRemove(1);                       // B 回 PC，队伍里只剩 A
    game.gameState.activePokemonIndex = 0;
    const eb = b.exp, ec = c.exp;
    game._processVictoryRewards(game.createWildPokemon(19, 40), 25, 100, 100);
    assert.equal(b.exp, eb);
    assert.equal(c.exp, ec, '皮卡丘在队伍里（有 A），所以这个物种不发储备经验');
    assert.ok(a.exp > 0);
});

test('自动更换最优出战：在同物种的两只之间也按它们各自的属性选择', () => {
    const { game } = newGame();
    const { a, b } = twoPikachu(game);
    game.gameState.settings = { autoSwitchBest: true, oneShotStrategy: 'fastest' };
    game.gameState.activePokemonIndex = 1;                 // 当前出战的是弱的那只
    const wild = game.createWildPokemon(19, 40);
    const best = game.getBestTeamMemberForEnemy(wild);
    assert.equal(best, 0, '应当换成 Lv50/31V 的那只');
    void a; void b;
});

test('属性来源（getStatSources）与战斗属性按出战位置的个体计算', () => {
    const { game } = newGame();
    const { a, b } = twoPikachu(game);
    game.setActivePokemon(1);
    const sB = game.calculateBattleStats(1);
    game.setActivePokemon(0);
    const sA = game.calculateBattleStats(0);
    assert.ok(sA.attack > sB.attack);
    const own = game.calculateStats({ id: 25, level: 50, ivs: a.ivs, isShiny: false });
    assert.ok(sA.attack >= own.attack && sA.hp >= own.hp, '含队友/图鉴加成，不会低于自身属性');
    void b;
});

test('升级只影响自己：队友升级不改变另一只的等级与属性缓存', () => {
    const { game, ctx } = newGame();
    const { a, b } = twoPikachu(game);
    const statsA = plain(game._getInstanceStats(a));
    game.addExpToInstance(b, ctx.getExpForLevel('medium', 15) - b.exp);
    assert.equal(b.level, 15);
    assert.deepEqual(plain(game._getInstanceStats(a)), statsA, 'A 的缓存属性不变');
    assert.equal(a.level, 50);
});

test('离线结算：只有出战的那一只记战斗统计，同物种队友和 PC 里的不受影响', async () => {
    const { game } = newGame({ seed: 3 });
    const { a, b, c } = twoPikachu(game);
    const data = await runOffline(game, 20 * 60 * 1000);
    assert.ok(data.battles > 0 || data.summary.battles > 0);
    assert.ok(a.stats.victories > 0);
    assert.equal(b.stats.victories, 0);
    assert.equal(c.stats.victories, 0);
    assert.ok(b.exp > 0 && c.battles === 0);
    healthy(game);
});

test('挑战塔使用出战位置上的个体；塔里不改变队伍', () => {
    const { game } = newGame();
    const { b } = twoPikachu(game);
    game.setActivePokemon(1);
    const partyBefore = plain(game.gameState.party);
    game.gameState.badges = game.gameState.badges || {};
    game._towerMode = true;
    game.gameState.tower = Object.assign(game.gameState.tower || {}, { currentFloor: 1, currentEnemyIndex: 0, enemies: [19] });
    game.startTowerBattle();
    assert.equal(game.currentBattle.derived.activeInst, b);
    assert.equal(game.partyReorder(0, 1).code, 'tower_locked');
    assert.deepEqual(plain(game.gameState.party), partyBefore);
    game.stopBattle();
    game._towerMode = false;
});
