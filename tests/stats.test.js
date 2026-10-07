'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, dispose, ivs, perfectIvs, catchRange, mulberry32 } = require('./helpers/game');

// 旧实现（重构前）的参考算法：每次都为整个图鉴构造宝可梦。用来校验缓存版结果完全一致。
function referenceBattleStats(game, index) {
    const team = game.gameState.team;
    const active = game.createPokemon(team[index], true);
    if (!active) return null;
    const base = game.calculateStats(active);
    const teamBonus = { hp: 0, attack: 0, defense: 0, speed: 0 };
    for (let i = 0; i < team.length; i++) {
        if (i === index) continue;
        const o = game.createPokemon(team[i], true);
        if (o) {
            const s = game.calculateStats(o);
            teamBonus.hp += s.hp * 0.2; teamBonus.attack += s.attack * 0.2;
            teamBonus.defense += s.defense * 0.2; teamBonus.speed += s.speed * 0.2;
        }
    }
    const dex = { hp: 0, attack: 0, defense: 0, speed: 0 };
    const teamSet = new Set(team.map(String));
    for (const dexId in game.gameState.pokedex) {
        if (game.gameState.pokedex[dexId] === 'caught' && !teamSet.has(dexId)) {
            const p = game.createPokemon(parseInt(dexId), true);
            if (p) {
                const s = game.calculateStats(p);
                dex.hp += s.hp * 0.01; dex.attack += s.attack * 0.01;
                dex.defense += s.defense * 0.01; dex.speed += s.speed * 0.01;
            }
        }
    }
    let hp = Math.floor(base.hp + teamBonus.hp + dex.hp);
    let attack = Math.floor(base.attack + teamBonus.attack + dex.attack);
    let defense = Math.floor(base.defense + teamBonus.defense + dex.defense);
    let speed = Math.floor(base.speed + teamBonus.speed + dex.speed);
    const gem = game.getGemBonuses();
    if (gem.hp_bonus > 0) hp = Math.floor(hp * (1 + gem.hp_bonus / 100));
    if (gem.atk_bonus > 0) attack = Math.floor(attack * (1 + gem.atk_bonus / 100));
    if (gem.def_bonus > 0) defense = Math.floor(defense * (1 + gem.def_bonus / 100));
    if (gem.speed_bonus > 0) speed = Math.floor(speed * (1 + gem.speed_bonus / 100));
    const t = game.getTalentStatBonusPercent();
    if (t > 0) {
        hp = Math.floor(hp * (1 + t / 100)); attack = Math.floor(attack * (1 + t / 100));
        defense = Math.floor(defense * (1 + t / 100)); speed = Math.floor(speed * (1 + t / 100));
    }
    return { hp, attack, defense, speed };
}

test('公式：Lv50 皮卡丘、满个体值的各项能力', () => {
    const { game } = newGame();
    const pk = { id: 25, level: 50, ivs: perfectIvs(), isShiny: false, isWild: true };
    const r = game.calculateBaseStats(pk);
    // HP = floor((2*35+31)*50/100)+50+10 = 110；其余 = floor((2*base+31)*50/100)+5
    assert.deepEqual({ ...r }, { hp: 110, atk: 75, def: 60, spAtk: 70, spDef: 70, speed: 110 });
    const s = game.calculateStats(pk);
    assert.equal(s.attack, 145);   // 物攻 + 特攻
    assert.equal(s.defense, 130);  // 物防 + 特防
    assert.equal(s.speed, 110);
    dispose(game);
});

test('闪光：种族值 ×1.2（向下取整）', () => {
    const { game } = newGame();
    const normal = game.calculateBaseStats({ id: 25, level: 50, ivs: ivs(0), isShiny: false, isWild: true });
    const shiny = game.calculateBaseStats({ id: 25, level: 50, ivs: ivs(0), isShiny: true, isWild: true });
    assert.equal(shiny.hp, Math.floor((2 * Math.floor(35 * 1.2) + 0) * 50 / 100) + 60);
    assert.ok(shiny.hp > normal.hp && shiny.atk > normal.atk);
    dispose(game);
});

test('树果：每个 +5 种族值，封顶 255，且只对己方生效', () => {
    const { game } = newGame();
    game.gameState.berryFed[25] = { atk_berry: 4 };
    game._touchSpecies(25);
    const own = game.calculateBaseStats({ id: 25, level: 50, ivs: ivs(0), isShiny: false });
    const wild = game.calculateBaseStats({ id: 25, level: 50, ivs: ivs(0), isShiny: false, isWild: true });
    assert.equal(own.atk, Math.floor((2 * (55 + 20)) * 50 / 100) + 5);
    assert.equal(wild.atk, Math.floor((2 * 55) * 50 / 100) + 5);
    game.gameState.berryFed[25] = { atk_berry: 1000 };
    const capped = game.calculateBaseStats({ id: 25, level: 50, ivs: ivs(0), isShiny: false });
    assert.equal(capped.atk, Math.floor((2 * 255) * 50 / 100) + 5);
    dispose(game);
});

test('攻击间隔：速度越高越快，趋近但不低于 100ms', () => {
    const { game } = newGame();
    assert.equal(game.getAttackInterval(0), 2000);
    assert.ok(game.getAttackInterval(10000) < game.getAttackInterval(1000));
    assert.ok(game.getAttackInterval(1e9) > 100);
    assert.ok(Math.abs(game.getAttackInterval(14000) - 1050) < 1e-9); // 100 + 1900/2
    dispose(game);
});

test('缓存版 calculateBattleStats 与旧算法逐项一致（随机操作模糊测试）', () => {
    const { game, ctx } = newGame({ seed: 42 });
    const rnd = mulberry32(7);
    const pick = (n) => 1 + Math.floor(rnd() * n);
    catchRange(game, 1, 60, ivs(5));
    const check = (label) => {
        for (let i = 0; i < game.gameState.team.length; i++) {
            const got = game.calculateBattleStats(i);
            const ref = referenceBattleStats(game, i);
            assert.deepEqual(
                { hp: got.hp, attack: got.attack, defense: got.defense, speed: got.speed }, ref,
                `${label}：队伍位置 ${i}`
            );
        }
    };
    check('初始');
    for (let step = 0; step < 120; step++) {
        const op = Math.floor(rnd() * 8);
        const id = pick(120);
        switch (op) {
            case 0: // 新捕获 / 更高个体值
                game.catchPokemonWithIvs(id, 1, ivs(Math.floor(rnd() * 32)));
                break;
            case 1: // 加经验（可能升级、进化）
                if (game.gameState.caughtPokemon[id]) game.addExpToPokemon(id, Math.floor(rnd() * 5e6));
                break;
            case 2: // 加入队伍
                if (game.gameState.caughtPokemon[id]) game.addToTeamFromPokedex(id);
                break;
            case 3: // 喂树果
                if (game.gameState.caughtPokemon[id]) {
                    game.gameState.berryBag.atk_berry = 5;
                    game.feedBerry(id, 'atk_berry');
                }
                break;
            case 4: // 获得闪光
                if (game.gameState.caughtPokemon[id]) {
                    game.gameState.shinyDex[id] = true;
                    game._syncShinyInFamily(id);
                    game._touchSpecies(id);
                }
                break;
            case 5: // 击败一只野怪（带 IV 更新）
                game.processDefeat(game.createWildPokemon(id, 10));
                break;
            case 6: // 换出战
                game.gameState.activePokemonIndex = Math.floor(rnd() * game.gameState.team.length);
                break;
            case 7: // 宝石加成
                game.gameState.badges.kanto = { unlocked: true, gem: {
                    uid: 'g' + step, quality: 'common', qualityName: '普通', qualityColor: '#a0a0a0',
                    attrs: [{ id: 'hp_bonus', value: 1 + (step % 5) }, { id: 'atk_bonus', value: 2 }], locked: false,
                } };
                game._gemBonusCache = null;
                break;
        }
        check(`步骤 ${step} (op=${op}, id=${id})`);
    }
    dispose(game);
});

test('缓存：命中时不重新构造宝可梦；单个物种变化只重算该物种', () => {
    const { game } = newGame();
    catchRange(game, 1, 300, ivs(10));
    game.calculateBattleStats(0);                       // 预热
    let calls = 0;
    const orig = game.calculateStats.bind(game);
    game.calculateStats = (p) => { calls++; return orig(p); };
    for (let i = 0; i < 50; i++) game.calculateBattleStats(0);
    assert.equal(calls, 0, '缓存命中时 calculateStats 不应被调用');
    game.addExpToPokemon(200, 5e6);                      // 一个非队伍成员升级
    game.calculateBattleStats(0);
    assert.ok(calls >= 1 && calls <= 3, `只应重算少量物种，实际 ${calls}`);
    dispose(game);
});
