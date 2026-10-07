'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRoster, ivsOf } = require('./helpers/roster');
const { plain } = require('./helpers/game');

// 名册应满足全部不变量。PC 专项测试没有队伍，所以允许忽略“队伍为空”这一条
const healthy = (roster, { allowEmptyParty = false } = {}) => {
    let problems = plain(roster.checkIntegrity());
    if (allowEmptyParty && roster.state.party.length === 0) problems = problems.filter(p => !p.includes('队伍为空') && !p.includes('出战下标'));
    assert.deepEqual(problems, [], '名册应满足全部不变量');
};

// ---------------------------------------------------------------- 7. 队伍使用个体

test('队伍存的是个体 uid，旧的 team 是同下标的物种视图（引用不变，原地同步）', () => {
    const { roster, add, state } = makeRoster();
    const team = state.team;
    const a = add(25);
    const b = add(4);
    assert.equal(roster.party.add(a.uid).ok, true);
    assert.equal(roster.party.add(b.uid).ok, true);
    assert.deepEqual(plain(state.party), [a.uid, b.uid]);
    assert.deepEqual(plain(state.team), [25, 4]);
    assert.equal(state.team, team, 'team 数组引用必须保持不变');
    assert.deepEqual(plain(roster.party.speciesList()), [25, 4]);
    assert.equal(roster.party.instanceAt(1), b);
    assert.equal(roster.party.uidAt(5), null);
});

test('队伍：最多 6 只，不能重复，不能放不存在的个体', () => {
    const { roster, add } = makeRoster();
    const mons = [1, 4, 7, 10, 13, 16, 19].map(id => add(id));
    for (let i = 0; i < 6; i++) assert.equal(roster.party.add(mons[i].uid).ok, true);
    assert.equal(roster.party.isFull(), true);
    assert.equal(roster.party.add(mons[6].uid).code, 'party_full');
    assert.equal(roster.party.add(mons[0].uid).code, 'already_in_party');
    assert.equal(roster.party.add('nope').code, 'unknown_pokemon');
    assert.equal(roster.party.size(), 6);
});

test('队伍可以同时有两只同物种的个体（各有自己的 uid）', () => {
    const { roster, add, state } = makeRoster();
    const a = add(25, { level: 10 });
    const b = add(25, { level: 30 });
    roster.party.add(a.uid);
    roster.party.add(b.uid);
    assert.deepEqual(plain(state.party), [a.uid, b.uid]);
    assert.deepEqual(plain(state.team), [25, 25]);
    assert.equal(roster.party.instanceAt(0).level, 10);
    assert.equal(roster.party.instanceAt(1).level, 30);
});

test('队伍：移除规则（不能移除出战者、不能清空队伍）与出战下标调整', () => {
    const { roster, add, state } = makeRoster();
    const [a, b, c] = [1, 4, 7].map(id => add(id));
    [a, b, c].forEach(m => roster.party.add(m.uid));
    state.activePokemonIndex = 1;
    assert.equal(roster.party.removeAt(1).code, 'active_member');
    assert.equal(roster.party.removeAt(9).code, 'bad_index');
    assert.equal(roster.party.remove('nope').code, 'not_in_party');
    // 移除出战者前面的 → 出战下标前移，出战的仍是同一只
    assert.equal(roster.party.removeAt(0).uid, a.uid);
    assert.equal(state.activePokemonIndex, 0);
    assert.equal(roster.party.uidAt(state.activePokemonIndex), b.uid);
    // 移除后面的 → 下标不变
    assert.equal(roster.party.remove(c.uid).ok, true);
    assert.equal(state.activePokemonIndex, 0);
    // 只剩一只，不能再移除
    assert.equal(roster.party.removeAt(0, { allowActive: true }).code, 'last_member');
    assert.deepEqual(plain(state.team), [4]);
});

test('队伍：交换位置时出战下标跟着走；替换返回被换下的个体', () => {
    const { roster, add, state } = makeRoster();
    const [a, b, c, d] = [1, 4, 7, 10].map(id => add(id));
    [a, b, c].forEach(m => roster.party.add(m.uid));
    state.activePokemonIndex = 0;
    assert.equal(roster.party.swap(0, 2).ok, true);
    assert.equal(state.activePokemonIndex, 2);
    assert.equal(roster.party.activeUid(), a.uid);
    assert.deepEqual(plain(state.team), [7, 4, 1]);
    assert.equal(roster.party.swap(0, 9).code, 'bad_index');
    assert.equal(roster.party.swap(1, 1).ok, true);
    const r = roster.party.replaceAt(1, d.uid);
    assert.equal(r.replaced, b.uid);
    assert.deepEqual(plain(state.team), [7, 10, 1]);
    assert.equal(roster.party.replaceAt(1, a.uid).code, 'already_in_party');
    assert.equal(roster.party.setActive(0).ok, true);
    assert.equal(roster.party.setActive(5).code, 'bad_index');
});

// ---------------------------------------------------------------- 8. PC 存放个体

test('PC：存入时按顺序占第一个空格，满了自动新建箱子', () => {
    const { roster, add, ctx, state } = makeRoster();
    const uids = [];
    for (let i = 0; i < ctx.PC_BOX_CAPACITY + 1; i++) uids.push(add(19).uid);   // 默认放进 PC
    assert.equal(state.pc.boxes.length, 2);
    assert.equal(roster.pc.count(), ctx.PC_BOX_CAPACITY + 1);
    assert.deepEqual(plain(roster.pc.find(uids[0])), { box: 0, slot: 0 });
    assert.deepEqual(plain(roster.pc.find(uids[29])), { box: 0, slot: 29 });
    assert.deepEqual(plain(roster.pc.find(uids[30])), { box: 1, slot: 0 });
    assert.equal(roster.pc.totalCapacity(), 2 * ctx.PC_BOX_CAPACITY);
    assert.equal(roster.pc.contains(uids[5]), true);
    assert.equal(roster.pc.contains('nope'), false);
    healthy(roster, { allowEmptyParty: true });
});

test('PC：存入的是个体本身，取出后状态不变', () => {
    const { roster, add, state } = makeRoster();
    const a = add(25, { level: 33, ivs: ivsOf(17), nickname: '电电' });
    assert.equal(roster.locate(a.uid).where, 'pc');
    const snapshot = JSON.stringify(a);
    roster.pc.withdraw(a.uid);
    assert.equal(roster.pc.contains(a.uid), false);
    assert.equal(roster.locate(a.uid), null);
    roster.pc.deposit(a.uid);
    assert.equal(JSON.stringify(state.ownedPokemon[a.uid]), snapshot, '进出 PC 不会改动个体');
    assert.equal(roster.pc.withdraw('nope').code, 'not_in_pc');
});

test('PC：指定格子存放、占用检查、移动与互换', () => {
    const { roster, add } = makeRoster();
    const a = add(1, { place: 'none' });
    const b = add(4, { place: 'none' });
    assert.equal(roster.pc.deposit(a.uid, { box: 0, slot: 5 }).ok, true);
    assert.equal(roster.pc.deposit(b.uid, { box: 0, slot: 5 }).code, 'slot_occupied');
    assert.equal(roster.pc.deposit(b.uid, { box: 3, slot: 0 }).code, 'bad_slot');
    assert.equal(roster.pc.deposit(b.uid, { box: 0, slot: 99 }).code, 'bad_slot');
    assert.equal(roster.pc.deposit(b.uid, { box: 0, slot: 6 }).ok, true);
    assert.equal(roster.pc.deposit(b.uid).code, 'already_in_pc');
    // 移动到空格
    assert.equal(roster.pc.move(a.uid, 0, 20).swapped, null);
    assert.deepEqual(plain(roster.pc.find(a.uid)), { box: 0, slot: 20 });
    // 移动到有人的格子 = 互换
    assert.equal(roster.pc.move(a.uid, 0, 6).swapped, b.uid);
    assert.deepEqual(plain(roster.pc.find(a.uid)), { box: 0, slot: 6 });
    assert.deepEqual(plain(roster.pc.find(b.uid)), { box: 0, slot: 20 });
    assert.equal(roster.pc.move('nope', 0, 0).code, 'not_in_pc');
    assert.equal(roster.pc.move(a.uid, 0, -1).code, 'bad_slot');
    healthy(roster, { allowEmptyParty: true });
});

test('PC：多个箱子——新建、改名（名字被净化）、上限', () => {
    const { roster, ctx, state } = makeRoster();
    assert.equal(state.pc.boxes.length, 1);
    assert.equal(roster.pc.addBox('水系').box, 1);
    assert.equal(state.pc.boxes[1].name, '水系');
    assert.equal(roster.pc.renameBox(1, '<b>"火"</b> 系 \u0000 很长很长很长很长很长很长很长很长').ok, true);
    assert.equal(state.pc.boxes[1].name, Array.from('b火/b 系 很长很长很长很长很长很长').slice(0, ctx.PC_BOX_NAME_MAX).join(''));
    assert.equal(Array.from(state.pc.boxes[1].name).length, 16);
    assert.equal(roster.pc.renameBox(1, '').ok, true);
    assert.equal(state.pc.boxes[1].name, '箱子 2', '空名字回退为默认名');
    assert.equal(roster.pc.renameBox(9, 'x').code, 'bad_box');
    const ids = new Set(state.pc.boxes.map(b => b.id));
    assert.equal(ids.size, 2, '箱子 id 唯一');
    while (state.pc.boxes.length < ctx.PC_MAX_BOXES) assert.equal(roster.pc.addBox().ok, true);
    assert.equal(roster.pc.addBox().code, 'max_boxes');
    assert.equal(roster.pc.boxContents(0).length, ctx.PC_BOX_CAPACITY);
    assert.equal(roster.pc.boxContents(999), null);
});

test('PC 容量耗尽时创建个体失败，且不留下半成品', () => {
    const { roster, ctx, state } = makeRoster();
    // 把所有格子塞满占位 uid（不创建真实个体，只测边界）
    for (let i = 0; i < ctx.PC_MAX_BOXES - 1; i++) roster.pc.addBox();
    for (const box of state.pc.boxes) box.slots.fill('x');
    const before = Object.keys(state.ownedPokemon).length;
    const r = roster.create({ speciesId: 25 });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'pc_full');
    assert.equal(Object.keys(state.ownedPokemon).length, before);
    assert.equal(roster.countOfSpecies(25), 0);
});

// ---------------------------------------------------------------- 队伍 ↔ PC 的原子移动

test('moveToParty / moveToPc / swapPartyWithPc：个体在队伍与 PC 间移动，永远只在一处', () => {
    const { roster, add, state } = makeRoster();
    const a = add(25, { place: 'party' });
    const b = add(4);
    const c = add(7);
    assert.equal(roster.locate(a.uid).where, 'party');
    assert.equal(roster.moveToParty(b.uid).index, 1);
    assert.equal(roster.locate(b.uid).where, 'party');
    assert.equal(roster.pc.contains(b.uid), false);
    assert.equal(roster.moveToParty(b.uid).code, 'already_in_party');
    assert.equal(roster.moveToParty('nope').code, 'unknown_pokemon');

    // 队伍位置 1 的 b 与 PC 里的 c 互换：b 进入 c 原来的格子
    const cPos = roster.pc.find(c.uid);
    const r = roster.swapPartyWithPc(1, c.uid);
    assert.equal(r.replaced, b.uid);
    assert.deepEqual(plain(roster.pc.find(b.uid)), plain(cPos), '被换下的个体放进同一个格子');
    assert.deepEqual(plain(state.team), [25, 7]);
    assert.equal(roster.swapPartyWithPc(9, c.uid).code, 'bad_index');
    assert.equal(roster.swapPartyWithPc(0, 'nope').code, 'not_in_pc');

    // 移回 PC（出战者不能移走）
    assert.equal(roster.moveToPc(a.uid).code, 'active_member');
    assert.equal(roster.moveToPc(c.uid).ok, true);
    assert.equal(roster.locate(c.uid).where, 'pc');
    assert.equal(roster.moveToPc(c.uid).code, 'not_in_party');
    healthy(roster);
});

test('moveToParty：队伍满时失败，个体仍留在原来的 PC 格子里', () => {
    const { roster, add } = makeRoster();
    const mons = [1, 4, 7, 10, 13, 16, 19].map(id => add(id));
    for (let i = 0; i < 6; i++) roster.moveToParty(mons[i].uid);
    const pos = roster.pc.find(mons[6].uid);
    assert.equal(roster.moveToParty(mons[6].uid).code, 'party_full');
    assert.deepEqual(plain(roster.pc.find(mons[6].uid)), plain(pos));
    healthy(roster);
});

// ---------------------------------------------------------------- 放生 / 转移

test('放生：留下记录；队伍里的不能放生；物种的最后一只不能放生（兼容旧的“已收集”语义）', () => {
    const { roster, add, state } = makeRoster();
    const a = add(25, { place: 'party', nickname: '电电', ivs: ivsOf(12) });
    const b = add(25, { level: 3, shiny: true, nickname: '闪闪' });
    assert.equal(roster.release(a.uid).code, 'in_party');
    assert.equal(roster.release('nope').code, 'unknown_pokemon');
    assert.equal(roster.release(b.uid, { reason: 'explode' }).code, 'bad_reason');

    const r = roster.release(b.uid);
    assert.equal(r.ok, true);
    assert.equal(roster.has(b.uid), false);
    assert.equal(roster.pc.contains(b.uid), false);
    assert.equal(state.released.length, 1);
    assert.equal(state.released[0].uid, b.uid);
    assert.equal(state.released[0].speciesId, 25);
    assert.equal(state.released[0].shiny, true);
    assert.equal(state.released[0].nickname, '闪闪');
    assert.equal(state.released[0].reason, 'release');
    assert.equal(typeof state.released[0].releasedAt, 'number');
    assert.equal(roster.countOfSpecies(25), 1);

    // 现在 25 只剩 a 一只（且在队伍里）；再来一只 c 进队伍，并让 c 出战，这样 a 才能回到 PC
    const c = add(25);
    roster.moveToParty(c.uid);
    state.activePokemonIndex = 1;
    assert.equal(roster.moveToPc(a.uid).ok, true);
    assert.equal(roster.release(a.uid).ok, true, 'c 还在，a 不是最后一只了');
    assert.equal(roster.release(c.uid).code, 'in_party');
    healthy(roster);
});

test('放生：只剩一只时拒绝，转移使用同样的规则并记录原因', () => {
    const { roster, add, state } = makeRoster();
    const a = add(133);
    assert.equal(roster.release(a.uid).code, 'last_of_species');
    assert.equal(roster.release(a.uid, { reason: 'transfer' }).code, 'last_of_species');
    const b = add(133);
    assert.equal(roster.release(b.uid, { reason: 'transfer' }).ok, true);
    assert.equal(state.released[0].reason, 'transfer');
    assert.equal(state.caughtPokemon[133], a, '旧视图仍然有效');
});

test('放生主个体：自动选出新的主个体，旧视图重新指向它', () => {
    const { roster, add, state } = makeRoster();
    const a = add(25, { level: 5 });
    const b = add(25, { level: 40 });
    const c = add(25, { level: 20 });
    assert.equal(roster.isPrimary(a), true);
    assert.equal(roster.release(a.uid).ok, true);
    assert.equal(roster.primaryOf(25), b, '剩下的里面等级最高的成为主个体');
    assert.equal(state.caughtPokemon[25], b);
    assert.equal(state.speciesPrimary[25], b.uid);
    assert.equal(roster.countOfSpecies(25), 2);
    void c;
    healthy(roster, { allowEmptyParty: true });
});

test('放生记录只保留最近 500 条', () => {
    const { roster, add, ctx, state } = makeRoster();
    add(19);   // 保底一只
    for (let i = 0; i < ctx.RELEASED_LOG_MAX + 10; i++) {
        const x = add(19);
        assert.equal(roster.release(x.uid).ok, true);
    }
    assert.equal(state.released.length, ctx.RELEASED_LOG_MAX);
    assert.equal(state.released[0].uid, 'p12', '最早的 10 条被丢弃');
    healthy(roster, { allowEmptyParty: true });
});

// ---------------------------------------------------------------- 与旧代码对齐

test('reconcile：旧代码直接改 team 后，party 以 team 为准重建，被换下的个体进 PC，绝不丢个体', () => {
    const { roster, add, state } = makeRoster();
    const a = add(25, { place: 'party' });
    const b = add(4);
    const c = add(7);
    assert.equal(roster.reconcile(), false, '一致时什么也不做');
    state.team = [4, 7];             // 旧代码/旧测试的写法
    assert.equal(roster.reconcile(), true);
    assert.deepEqual(plain(state.party), [b.uid, c.uid]);
    assert.deepEqual(plain(state.team), [4, 7]);
    assert.equal(roster.locate(a.uid).where, 'pc', '原队伍成员放回 PC');
    assert.equal(roster.pc.contains(b.uid), false, '进了队伍的从 PC 取出');
    assert.equal(roster.count(), 3);
    healthy(roster);
});

test('reconcile：同物种个体按位置匹配（已有 party 提示优先），没有提示时依次取未使用的个体', () => {
    const { roster, add, state } = makeRoster();
    const a = add(25, { level: 10, place: 'party' });
    const b = add(25, { level: 20, place: 'party' });
    state.team = [25, 25];           // 与 party 一致：保持原个体
    assert.equal(roster.reconcile(), false);
    state.team = [25, 25, 25];       // 想要 3 只但只有 2 只：多出的忽略
    roster.reconcile();
    assert.deepEqual(plain(state.party), [a.uid, b.uid]);
    assert.deepEqual(plain(state.team), [25, 25]);
    state.team = [25];
    roster.reconcile();
    assert.deepEqual(plain(state.party), [a.uid]);
    assert.equal(roster.locate(b.uid).where, 'pc');
    healthy(roster);
});

test('reconcile：team 里没有任何有效成员时保持旧队伍不变', () => {
    const { roster, add, state } = makeRoster();
    const a = add(25, { place: 'party' });
    state.team = [99999, 'x', null];
    roster.reconcile();
    assert.deepEqual(plain(state.party), [a.uid]);
    assert.deepEqual(plain(state.team), [25]);
});

// ---------------------------------------------------------------- 完整性检查器本身

test('完整性检查器能发现各类损坏', () => {
    const { roster, add, state } = makeRoster();
    const a = add(25, { place: 'party' });
    const b = add(4);
    healthy(roster);

    state.pc.boxes[0].slots[5] = a.uid;               // 同时在队伍和 PC
    assert.ok(roster.checkIntegrity().some(p => p.includes('同时出现')));
    state.pc.boxes[0].slots[5] = null;

    const slot = roster.pc.find(b.uid);
    state.pc.boxes[slot.box].slots[slot.slot] = null; // 孤儿
    assert.ok(roster.checkIntegrity().some(p => p.includes('孤儿')));
    roster.pc.deposit(b.uid);

    state.speciesPrimary[4] = a.uid;                  // 主个体物种不符
    assert.ok(roster.checkIntegrity().some(p => p.includes('没有有效的主个体')));
    state.speciesPrimary[4] = b.uid;

    state.caughtPokemon[4] = { ...b };                // 旧视图不是同一个对象
    assert.ok(roster.checkIntegrity().some(p => p.includes('不是主个体对象本身')));
    state.caughtPokemon[4] = b;

    state.team[0] = 4;                                // team 与 party 不一致
    assert.ok(roster.checkIntegrity().some(p => p.includes('team 视图')));
    state.team[0] = 25;

    state.activePokemonIndex = 5;
    assert.ok(roster.checkIntegrity().some(p => p.includes('出战下标')));
    state.activePokemonIndex = 0;

    state.released.push({ uid: a.uid });
    assert.ok(roster.checkIntegrity().some(p => p.includes('放生记录')));
    state.released.pop();

    state.nextPokemonSeq = 1;
    assert.ok(roster.checkIntegrity().some(p => p.includes('nextPokemonSeq')));
    state.nextPokemonSeq = 3;
    healthy(roster);
});
