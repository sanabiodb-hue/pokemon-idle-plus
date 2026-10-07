'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, dispose, sequenceRng } = require('./helpers/game');

// rng=0.99：不暴击，随机系数取 100%
test('基础伤害公式：Lv50、威力50、攻防相同 → 24', () => {
    const { game } = newGame();
    game.rng = () => 0.99;
    const r = game._computeDamage(50, 100, 100, [], [], 50, 0.05, 1.5);
    assert.equal(r.damage, 24); // floor(22*50*100/100/50)+2
    assert.equal(r.criticalHit, false);
    dispose(game);
});

test('属性克制：拔群 ×2、抵抗 ×0.5、免疫改为 ×0.25', () => {
    const { game } = newGame();
    game.rng = () => 0.99;
    const dmg = (a, d) => game._computeDamage(50, 100, 100, a, d, 50, 0, 1.5);
    assert.equal(dmg(['fire'], ['grass']).damage, 48);
    assert.equal(dmg(['fire'], ['grass']).effectivenessText, 'É super efetivo!');
    assert.equal(dmg(['fire'], ['water']).damage, 12);
    assert.equal(dmg(['fire'], ['water']).effectivenessText, 'Não foi muito efetivo...');
    assert.equal(dmg(['normal'], ['ghost']).damage, 6);
    assert.equal(dmg(['normal'], ['ghost']).effectivenessText, 'Quase nenhum dano...');
    dispose(game);
});

test('双属性攻击方：拔群时倍率 ×0.75，取最优属性', () => {
    const { game } = newGame();
    game.rng = () => 0.99;
    // 火/飞 打 草：火 ×2、飞 ×2 → 取 2 再 ×0.75 = 1.5 → floor(24*1.5)=36
    assert.equal(game._computeDamage(50, 100, 100, ['fire', 'flying'], ['grass'], 50, 0, 1.5).damage, 36);
    // 火/水 打 水：水系对水 0.5，火系对水 0.5 → 0.5
    assert.equal(game._computeDamage(50, 100, 100, ['fire', 'water'], ['water'], 50, 0, 1.5).damage, 12);
    dispose(game);
});

test('会心一击：先掷暴击，再掷随机系数；倍率生效', () => {
    const { game } = newGame();
    game.rng = sequenceRng([0.0, 0.99]);          // 暴击，随机系数 100%
    const r = game._computeDamage(50, 100, 100, [], [], 50, 0.05, 1.5);
    assert.equal(r.criticalHit, true);
    assert.equal(r.damage, 36);                   // floor(24*1.5)
    game.rng = sequenceRng([0.0, 0.0]);           // 随机系数 85%
    assert.equal(game._computeDamage(50, 100, 100, [], [], 50, 0.05, 1.5).damage, Math.floor(36 * 0.85));
    dispose(game);
});

test('伤害至少为 1', () => {
    const { game } = newGame();
    game.rng = () => 0.99;
    assert.equal(game._computeDamage(1, 1, 1e12, ['normal'], ['ghost'], 50, 0, 1.5).damage, 1);
    dispose(game);
});

test('会心参数：玩家享受宝石/天赋加成，野怪只有基础值（在线/离线共用）', () => {
    const { game, ctx } = newGame();
    assert.equal(game._getCritParams(false).rate, ctx.BASE_CRIT_RATE);
    assert.equal(game._getCritParams(true).rate, ctx.BASE_CRIT_RATE);
    game.gameState.badges.kanto = { unlocked: true, gem: {
        uid: 'x', quality: 'rare', qualityName: '稀有', qualityColor: '#3498db',
        attrs: [{ id: 'crit_rate', value: 5 }], locked: false } };
    game._gemBonusCache = null;
    game.gameState.talents.crit_damage_bonus = 20;
    const p = game._getCritParams(true);
    assert.ok(Math.abs(p.rate - 0.10) < 1e-12);
    assert.ok(Math.abs(p.multiplier - 1.7) < 1e-12);
    const w = game._getCritParams(false);
    assert.equal(w.rate, ctx.BASE_CRIT_RATE);
    assert.equal(w.multiplier, ctx.BASE_CRIT_MULTIPLIER);
    dispose(game);
});

test('calculateDamage 公开接口：skillPower<=0 时用固定威力 50', () => {
    const { game } = newGame();
    game.rng = () => 0.99;
    const a = game.calculateDamage(50, 100, 100, [], [], false, 0);
    const b = game.calculateDamage(50, 100, 100, [], [], false, 50);
    assert.equal(a.damage, b.damage);
    assert.ok(game.calculateDamage(50, 100, 100, [], [], false, 100).damage > a.damage);
    dispose(game);
});

test('battleTick：不再每次攻击构造宝可梦；伤害与事件载荷保持不变', () => {
    const { game } = newGame();
    game.rng = () => 0.99;
    game.startBattle();
    game.stopBattle();
    const events = [];
    game.onBattleEvent = (e, d) => events.push([e, d]);
    let created = 0;
    const orig = game.createPokemon.bind(game);
    game.createPokemon = (...a) => { created++; return orig(...a); };
    const b = game.currentBattle;
    b.playerTimer = b.playerNextAttack;           // 立即触发玩家攻击
    b.enemyTimer = 0;
    const before = b.wildCurrentHp;
    b.wildStats.defense = 1e9;                    // 保证不会一击击杀，只测一次攻击
    game.battleTick();
    assert.equal(created, 0, 'battleTick 不应调用 createPokemon');
    const atk = events.find(e => e[0] === 'playerAttack');
    assert.ok(atk, '应触发 playerAttack 事件');
    assert.equal(before - b.wildCurrentHp, atk[1].damage);
    for (const k of ['damage', 'critical', 'typeEffectiveness', 'effectivenessText', 'hp', 'maxHp', 'skillName', 'skillType']) {
        assert.ok(k in atk[1], `缺少字段 ${k}`);
    }
    assert.ok(events.some(e => e[0] === 'tick'));
    dispose(game);
});
