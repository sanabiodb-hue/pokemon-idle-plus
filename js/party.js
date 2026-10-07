// ============================================================
// 队伍（Party）- 当前上场的最多 6 只个体
//
// 数据：state.party = [uid, ...]   （与旧的 state.team = [物种ID, ...] 一一对应、同下标）
//   - party 是权威数据；team 是为旧代码保留的“物种ID视图”，由本类就地同步（数组引用不变）。
//   - state.activePokemonIndex 仍是队伍内的下标。
// 只负责队伍这一件事：不知道 PC，也不创建/删除个体（那是 PokemonRoster 的工作）。
// ============================================================
const PARTY_MAX = 6;

class PartyManager {
    // getState: () => state；state 需要有 ownedPokemon / party / team / activePokemonIndex
    constructor(getState) {
        this._getState = getState;
    }

    get state() { return this._getState(); }

    uids() { return this.state.party; }
    size() { return this.state.party.length; }
    isFull() { return this.size() >= PARTY_MAX; }
    contains(uid) { return this.state.party.includes(uid); }
    indexOf(uid) { return this.state.party.indexOf(uid); }
    uidAt(index) { return this.state.party[index] ?? null; }

    instanceAt(index) {
        const uid = this.state.party[index];
        return uid === undefined ? null : ownedLookup(this.state.ownedPokemon, uid);
    }

    // 旧代码使用的“物种ID数组”
    speciesList() {
        const owned = this.state.ownedPokemon;
        return this.state.party.map(uid => { const i = ownedLookup(owned, uid); return i ? i.speciesId : null; });
    }

    // 把 state.team 就地改成与 party 一致（保持数组引用，旧代码里缓存的 team 引用依然有效）
    syncTeamMirror() {
        const st = this.state;
        const species = this.speciesList();
        if (!Array.isArray(st.team)) st.team = [];
        st.team.length = 0;
        for (const id of species) st.team.push(id);
    }

    // 旧代码/测试可能直接改了 state.team：检查两者是否仍一致
    isMirrorConsistent() {
        const st = this.state;
        if (!Array.isArray(st.team) || st.team.length !== st.party.length) return false;
        for (let i = 0; i < st.party.length; i++) {
            const inst = ownedLookup(st.ownedPokemon, st.party[i]);
            if (!inst || inst.speciesId !== st.team[i]) return false;
        }
        return true;
    }

    // 追加一只到队尾。返回 { ok, code?, index? }
    add(uid) {
        const st = this.state;
        if (!ownedLookup(st.ownedPokemon, uid)) return { ok: false, code: 'unknown_pokemon' };
        if (st.party.includes(uid)) return { ok: false, code: 'already_in_party' };
        if (st.party.length >= PARTY_MAX) return { ok: false, code: 'party_full' };
        st.party.push(uid);
        this.syncTeamMirror();
        return { ok: true, index: st.party.length - 1 };
    }

    // 移除指定下标。默认不允许移除出战者、也不允许把队伍清空（与旧规则一致）
    removeAt(index, { allowActive = false } = {}) {
        const st = this.state;
        if (!Number.isInteger(index) || index < 0 || index >= st.party.length) return { ok: false, code: 'bad_index' };
        if (st.party.length <= 1) return { ok: false, code: 'last_member' };
        if (index === st.activePokemonIndex && !allowActive) return { ok: false, code: 'active_member' };
        const [uid] = st.party.splice(index, 1);
        if (st.activePokemonIndex > index) st.activePokemonIndex--;
        else if (st.activePokemonIndex >= st.party.length) st.activePokemonIndex = 0;
        this.syncTeamMirror();
        return { ok: true, uid };
    }

    remove(uid, opts) {
        const index = this.indexOf(uid);
        return index === -1 ? { ok: false, code: 'not_in_party' } : this.removeAt(index, opts);
    }

    // 用另一只替换指定下标，返回被换下的 uid（调用方负责把它放到别处）
    replaceAt(index, newUid) {
        const st = this.state;
        if (!Number.isInteger(index) || index < 0 || index >= st.party.length) return { ok: false, code: 'bad_index' };
        if (!ownedLookup(st.ownedPokemon, newUid)) return { ok: false, code: 'unknown_pokemon' };
        if (st.party.includes(newUid)) return { ok: false, code: 'already_in_party' };
        const old = st.party[index];
        st.party[index] = newUid;
        this.syncTeamMirror();
        return { ok: true, replaced: old };
    }

    // 交换两个位置（出战下标跟着走，保证出战的仍是同一只）
    swap(i, j) {
        const st = this.state;
        const n = st.party.length;
        if (![i, j].every(x => Number.isInteger(x) && x >= 0 && x < n)) return { ok: false, code: 'bad_index' };
        if (i === j) return { ok: true };
        [st.party[i], st.party[j]] = [st.party[j], st.party[i]];
        if (st.activePokemonIndex === i) st.activePokemonIndex = j;
        else if (st.activePokemonIndex === j) st.activePokemonIndex = i;
        this.syncTeamMirror();
        return { ok: true };
    }

    // 把 from 位置的成员挪到 to 位置（其余顺序依次顺延）；出战的仍是同一只
    move(from, to) {
        const st = this.state;
        const n = st.party.length;
        if (![from, to].every(x => Number.isInteger(x) && x >= 0 && x < n)) return { ok: false, code: 'bad_index' };
        if (from === to) return { ok: true };
        const activeUid = st.party[st.activePokemonIndex];
        const [uid] = st.party.splice(from, 1);
        st.party.splice(to, 0, uid);
        const i = st.party.indexOf(activeUid);
        st.activePokemonIndex = i === -1 ? 0 : i;
        this.syncTeamMirror();
        return { ok: true };
    }

    setActive(index) {
        const st = this.state;
        if (!Number.isInteger(index) || index < 0 || index >= st.party.length) return { ok: false, code: 'bad_index' };
        st.activePokemonIndex = index;
        return { ok: true };
    }

    activeUid() { return this.state.party[this.state.activePokemonIndex] ?? null; }
}
