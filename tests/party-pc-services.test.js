'use strict';
// 第 3 阶段：界面使用的队伍 / PC 服务（GameCore.party* / pc* / renamePokemon / releasePokemon / describeInstance）
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain } = require('./helpers/game');

const healthy = (game) => assert.deepEqual(plain(game.roster.checkIntegrity()), [], '名册应满足全部不变量');
function make(game, speciesId, o = {}) {
    const r = game.roster.create({ speciesId, nature: 'hardy', rng: () => 0.5, ivs: ivs(10), ...o });
    assert.ok(r.ok, r.code);
    return r.instance;
}
// 起始队伍：[初始皮卡丘]，再在 PC 里放 n 只不同/相同物种
function pcOf(game, ids) { return ids.map(id => make(game, id)); }

test('partyAdd：PC → 队伍队尾；同物种可以同时在队伍里；最多 6 只', () => {
    const { game } = newGame();
    const [p2, p3, p4, p5, p6, p7] = pcOf(game, [25, 25, 1, 4, 7, 10]);
    assert.deepEqual(plain(game.partyAdd(p2.uid)).ok, true);
    assert.equal(game.partyAdd(p3.uid).ok, true);
    assert.deepEqual(plain(game.gameState.team.slice(0, 3)), [25, 25, 25], '三只皮卡丘同时在队伍');
    game.partyAdd(p4.uid); game.partyAdd(p5.uid); game.partyAdd(p6.uid);
    assert.equal(game.gameState.party.length, 6);
    assert.equal(game.partyAdd(p7.uid).code, 'party_full');
    assert.equal(game.partyAdd(p2.uid).code, 'already_in_party');
    assert.equal(game.partyAdd('nope').code, 'unknown_pokemon');
    assert.equal(game.partyAdd('__proto__').code, 'unknown_pokemon');
    healthy(game);
});

test('partyRemove：放回 PC；出战者与最后一只不能放回；越界报错', () => {
    const { game } = newGame();
    const [p2] = pcOf(game, [1]);
    game.partyAdd(p2.uid);
    assert.equal(game.partyRemove(0).code, 'active_member', '0 号是出战者');
    assert.equal(game.partyRemove(9).code, 'bad_index');
    assert.equal(game.partyRemove(1).ok, true);
    assert.equal(game.roster.locate(p2.uid).where, 'pc');
    assert.equal(game.partyRemove(0).code, 'last_member');
    healthy(game);
});

test('partyRemove：放回的位置在出战者之前时，出战下标跟着调整，出战的仍是同一只', () => {
    const { game } = newGame();
    const [a, b] = pcOf(game, [1, 4]);
    game.partyAdd(a.uid); game.partyAdd(b.uid);
    game.setActivePokemon(2);
    const activeUid = game.gameState.party[2];
    assert.equal(game.partyRemove(0).ok, true);
    assert.equal(game.gameState.party[game.gameState.activePokemonIndex], activeUid);
    healthy(game);
});

test('partySwapWithPc：用 PC 里的换下队伍里的，被换下的放进同一个 PC 格子', () => {
    const { game } = newGame();
    const [a] = pcOf(game, [25]);
    const starter = game.gameState.party[0];
    const pos = game.roster.pc.find(a.uid);
    const r = game.partySwapWithPc(0, a.uid);
    assert.equal(r.ok, true);
    assert.equal(game.gameState.party[0], a.uid);
    assert.deepEqual(plain(game.roster.pc.find(starter)), plain(pos));
    assert.equal(game.partySwapWithPc(0, starter).ok, true, '换回来');
    assert.equal(game.partySwapWithPc(0, 'nope').code, 'not_in_pc');
    assert.equal(game.partySwapWithPc(5, a.uid).code, 'bad_index');
    healthy(game);
});

test('partyReorder：调整顺序，出战的仍是同一只，team 兼容视图同步', () => {
    const { game } = newGame();
    const [a, b] = pcOf(game, [1, 4]);
    game.partyAdd(a.uid); game.partyAdd(b.uid);       // [25, 1, 4]
    game.setActivePokemon(1);                          // 出战：1 号位（species 1）
    assert.equal(game.partyReorder(1, 0).ok, true);
    assert.deepEqual(plain(game.gameState.team), [1, 25, 4]);
    assert.equal(game.gameState.activePokemonIndex, 0);
    assert.equal(game.gameState.party[0], a.uid);
    assert.equal(game.partyReorder(0, 2).ok, true);
    assert.deepEqual(plain(game.gameState.team), [25, 4, 1]);
    assert.equal(game.gameState.party[game.gameState.activePokemonIndex], a.uid);
    assert.equal(game.partyReorder(0, 9).code, 'bad_index');
    assert.equal(game.partyReorder(1, 1).ok, true, '原地不动也算成功');
    healthy(game);
});

test('队伍改动会刷新进行中的战斗：出战个体、队友加成都按新队伍重新计算', () => {
    const { game } = newGame();
    const [a] = pcOf(game, [25]);
    a.level = 60;
    game.startBattle();
    const hpBefore = game.currentBattle.playerMaxHp;
    game.partyAdd(a.uid);                              // 新队友的 20% 加成
    assert.ok(game.currentBattle.playerMaxHp > hpBefore);
    assert.equal(game.currentBattle.derived.activeInst, game.getPartyInstance(game.gameState.activePokemonIndex));
    game.partySwapWithPc(0, game.roster.pc.uids()[0] || a.uid);
    assert.equal(game.currentBattle.derived.activeInst, game.getPartyInstance(game.gameState.activePokemonIndex));
    game.stopBattle();
});

test('挑战塔进行中不允许改动队伍；离线结算期间也不允许', () => {
    const { game } = newGame();
    const [a] = pcOf(game, [1]);
    game._towerMode = true;
    assert.equal(game.partyAdd(a.uid).code, 'tower_locked');
    assert.equal(game.partyRemove(0).code, 'tower_locked');
    assert.equal(game.partySwapWithPc(0, a.uid).code, 'tower_locked');
    assert.equal(game.partyReorder(0, 0).code, 'tower_locked');
    game._towerMode = false;
    game._isOfflineSimulating = true;
    assert.equal(game.partyAdd(a.uid).code, 'busy');
    game._isOfflineSimulating = false;
    assert.equal(game.partyAdd(a.uid).ok, true);
    healthy(game);
});

test('旧接口 addToTeamFromPokedex / removeFromTeam 与新服务可以混用', () => {
    const { game } = newGame();
    const [a] = pcOf(game, [1]);
    assert.equal(game.addToTeamFromPokedex(1), true);
    assert.equal(game.gameState.party[1], a.uid);
    assert.equal(game.removeFromTeam(1), true);
    assert.equal(game.partyAdd(a.uid).ok, true);
    assert.equal(game.partyRemove(1).ok, true);
    healthy(game);
});

test('renamePokemon：昵称被净化，只改这一只；releasePokemon：只能放生 PC 里的、每物种至少留一只，并写入放生记录', () => {
    const { game } = newGame();
    const [a, b] = pcOf(game, [25, 25]);
    const r = game.renamePokemon(a.uid, '  <b>闪电</b>  ');
    assert.equal(r.ok, true);
    assert.ok(!/[<>]/.test(a.nickname));
    assert.equal(b.nickname, '');
    assert.equal(game.releasePokemon(game.gameState.party[0]).code, 'in_party');
    assert.equal(game.releasePokemon(a.uid).ok, true);
    assert.equal(game.roster.has(a.uid), false);
    assert.equal(game.gameState.released.at(-1).uid, a.uid);
    assert.equal(game.releasePokemon(b.uid).ok, true);       // 队伍里还有初始皮卡丘
    const [c] = pcOf(game, [1]);
    assert.equal(game.releasePokemon(c.uid).code, 'last_of_species');
    healthy(game);
});

test('pcMoveToBox：移到别的箱子的第一个空格；满箱报错', () => {
    const { game } = newGame();
    const [a] = pcOf(game, [1]);
    game.roster.pc.addBox('第二箱');
    assert.equal(game.pcMoveToBox(a.uid, 1).ok, true);
    assert.equal(game.roster.pc.find(a.uid).box, 1);
    assert.equal(game.roster.pc.find(a.uid).slot, 0);
    game.gameState.pc.boxes[0].slots.fill('x');
    assert.equal(game.pcMoveToBox(a.uid, 0).code, 'box_full');
    assert.equal(game.pcMoveToBox(a.uid, 99).code, 'bad_box');
});

test('describeInstance：给界面用的快照，能区分同物种的两只', () => {
    const { game } = newGame();
    const [a, b] = pcOf(game, [25, 25]);
    a.nature = 'timid'; a.gender = 'male'; a.ivs = ivs(31);
    b.nature = 'bold'; b.gender = 'female'; b.ivs = ivs(0); b.nickname = '小黄';
    const da = game.describeInstance(a.uid), db = game.describeInstance(b.uid);
    assert.notEqual(da.uid, db.uid);
    assert.equal(da.ivPercent, 100);
    assert.equal(db.ivPercent, 0);
    assert.equal(da.natureName, 'Tímida');
    assert.equal(db.displayName, '小黄');
    assert.equal(da.where, 'pc');
    assert.equal(game.describeInstance(game.gameState.party[0]).where, 'party');
    assert.equal(game.describeInstance(game.gameState.party[0]).partyIndex, 0);
    assert.equal(game.describeInstance('nope'), null);
    assert.equal(game.describeInstance('__proto__'), null);
});

test('服务调用会请求存档（防抖合并），并且改动能经存档/读档保留', () => {
    const { game, storage } = newGame();
    const [a, b] = pcOf(game, [1, 25]);
    game.partyAdd(a.uid);
    game.partyAdd(b.uid);
    game.partyReorder(2, 1);
    game.renamePokemon(b.uid, '二号');
    assert.ok(game.saver.hasPending());
    game.gameState.currentEnemy = null;
    game.saveNow();
    const { game: g2 } = newGame({ storage, load: true });
    assert.deepEqual(plain(g2.gameState.party), plain(game.gameState.party));
    assert.equal(g2.roster.get(b.uid).nickname, '二号');
    assert.equal(g2.gameState.activePokemonIndex, game.gameState.activePokemonIndex);
    healthy(g2);
});
