// ============================================================
// 个体名册（Roster）- 把“个体 / 队伍 / PC / 已放生”组织在一起，并维护旧结构的兼容视图
//
// 权威数据（会被存档）：
//   state.ownedPokemon   { uid: 个体 }                  玩家拥有的每一只个体
//   state.party          [uid, ...] （≤6）              当前队伍
//   state.pc             { boxes: [...] }               箱子
//   state.released       [记录, ...]                    放生/转移的历史
//   state.speciesPrimary { 物种ID: uid }                每个物种的“主个体”
//   state.nextPokemonSeq 下一个 uid 序号
//
// 兼容视图（旧代码仍在读写，存档里也保留一份镜像）：
//   state.caughtPokemon[物种ID]  === 该物种“主个体”对象本身（同一个引用）
//        → 旧代码修改 level/exp/ivs/skillLevel 时，个体自动同步，无需拷贝。
//   state.team                   物种ID数组，与 party 同下标（由 PartyManager 就地同步）
//   state.pokedex / shinyDex     图鉴记录（拥有任一个体 ⇒ pokedex 为 caught；主个体闪光 ⇒ shinyDex 为 true）
//
// 不变量（由 pokemon-validation.js 的 validateRosterIntegrity 检查）：
//   每只个体恰好在一个位置（队伍 或 某个箱子的某一格）；每个有个体的物种恰有一个主个体。
// 本类不依赖 GameCore，传入 getState 即可单独使用和测试。
// ============================================================
const RELEASED_LOG_MAX = 500;

class PokemonRoster {
    // opts.now: () => 时间戳（捕获日期用，测试可注入）
    constructor(getState, opts = {}) {
        this._getState = getState;
        this._now = opts.now || (() => Date.now());
        this.party = new PartyManager(getState);
        this.pc = new PCStorage(getState);
        // 变化通知：create / release / setPrimary 之后以 (物种ID) 调用；整体重建时以 (null) 调用。
        // GameCore 用它让属性缓存失效——名册本身不知道缓存的存在。
        this.onChange = null;
        this._index = null;       // Map<物种ID, uid[]>
        this._indexState = null;  // 索引对应的 state 引用；state 被整体替换（读档/导入）时自动重建
    }

    get state() { return this._getState(); }

    // 补齐新结构（幂等）。也会补齐旧结构字段，方便独立测试
    static initState(state) {
        if (!state.ownedPokemon || typeof state.ownedPokemon !== 'object') state.ownedPokemon = {};
        if (!Array.isArray(state.party)) state.party = [];
        if (!state.pc || !Array.isArray(state.pc.boxes)) state.pc = PCStorage.createEmpty();
        if (!Array.isArray(state.released)) state.released = [];
        if (!state.speciesPrimary || typeof state.speciesPrimary !== 'object') state.speciesPrimary = {};
        if (!Number.isInteger(state.nextPokemonSeq) || state.nextPokemonSeq < 1) state.nextPokemonSeq = 1;
        if (!state.caughtPokemon) state.caughtPokemon = {};
        if (!Array.isArray(state.team)) state.team = [];
        if (!state.pokedex) state.pokedex = {};
        if (!state.shinyDex) state.shinyDex = {};
        if (!Number.isInteger(state.activePokemonIndex)) state.activePokemonIndex = 0;
        return state;
    }

    _notify(speciesId) {
        if (typeof this.onChange === 'function') this.onChange(speciesId);
    }

    // ---------- 索引 ----------
    _ensureIndex() {
        const st = this.state;
        if (this._index && this._indexState === st) return this._index;
        const index = new Map();
        for (const uid of Object.keys(st.ownedPokemon)) {
            const inst = st.ownedPokemon[uid];
            if (!index.has(inst.speciesId)) index.set(inst.speciesId, []);
            index.get(inst.speciesId).push(uid);
        }
        this._index = index;
        this._indexState = st;
        return index;
    }

    // 外部直接改了 ownedPokemon 时调用
    invalidateIndex() { this._index = null; this._indexState = null; }

    // ---------- 查询 ----------
    get(uid) { return ownedLookup(this.state.ownedPokemon, uid); }
    has(uid) { return !!ownedLookup(this.state.ownedPokemon, uid); }
    count() { return Object.keys(this.state.ownedPokemon).length; }
    all() { return Object.values(this.state.ownedPokemon); }

    ofSpecies(speciesId) {
        const uids = this._ensureIndex().get(Number(speciesId)) || [];
        const owned = this.state.ownedPokemon;
        return uids.map(u => owned[u]);
    }

    countOfSpecies(speciesId) {
        return (this._ensureIndex().get(Number(speciesId)) || []).length;
    }

    // 位置：{ where: 'party', index } | { where: 'pc', box, slot } | null
    locate(uid) {
        const idx = this.party.indexOf(uid);
        if (idx !== -1) return { where: 'party', index: idx };
        const pos = this.pc.find(uid);
        return pos ? { where: 'pc', box: pos.box, slot: pos.slot } : null;
    }

    // 主个体：旧代码里“这个物种”指的就是它
    primaryOf(speciesId) {
        const st = this.state;
        const id = Number(speciesId);
        const uid = st.speciesPrimary[id];
        const inst = uid ? ownedLookup(st.ownedPokemon, uid) : null;
        if (inst && inst.speciesId === id) return inst;
        const best = PokemonRoster.chooseBest(this.ofSpecies(id));
        if (best) this._setPrimaryInternal(best.uid);
        else if (st.speciesPrimary[id]) { delete st.speciesPrimary[id]; this._unlinkLegacy(id); }
        return best;
    }

    isPrimary(inst) {
        return !!inst && this.state.speciesPrimary[inst.speciesId] === inst.uid;
    }

    // 选“最强”的：等级高者优先，同级取更早获得的（uid 序号小）
    static chooseBest(list) {
        let best = null;
        for (const inst of list) {
            if (!best || inst.level > best.level ||
                (inst.level === best.level && (uidSequence(inst.uid) ?? Infinity) < (uidSequence(best.uid) ?? Infinity))) {
                best = inst;
            }
        }
        return best;
    }

    // ---------- 创建 / 主个体 ----------
    nextUid() {
        const st = this.state;
        let uid;
        do { uid = 'p' + (st.nextPokemonSeq++); } while (st.ownedPokemon[uid]);
        return uid;
    }

    // opts：见 createPokemonInstance，另有 place: 'pc'(默认) | 'party' | 'none'
    // 返回 { ok, instance, placed } 或 { ok:false, code }
    create(opts = {}) {
        const st = this.state;
        if (!Object.prototype.hasOwnProperty.call(POKEMON_DATA, opts.speciesId)) return { ok: false, code: 'unknown_species' };
        const place = opts.place || 'pc';
        const inst = createPokemonInstance({
            ...opts,
            uid: this.nextUid(),
            caughtAt: opts.caughtAt === undefined ? this._now() : opts.caughtAt,
        });
        const index = this._ensureIndex();   // 必须在写入 ownedPokemon 之前：索引首次构建时不能把新个体算两次
        st.ownedPokemon[inst.uid] = inst;
        if (!index.has(inst.speciesId)) index.set(inst.speciesId, []);
        index.get(inst.speciesId).push(inst.uid);

        let placed = 'none';
        if (place === 'party' && !this.party.isFull()) {
            this.party.add(inst.uid);
            placed = 'party';
        } else if (place === 'party' || place === 'pc') {
            const r = this.pc.deposit(inst.uid);
            if (!r.ok) { this._removeInstance(inst); return { ok: false, code: r.code }; }
            placed = 'pc';
        }

        if (!st.speciesPrimary[inst.speciesId] || !ownedLookup(st.ownedPokemon, st.speciesPrimary[inst.speciesId])) {
            this._setPrimaryInternal(inst.uid);
        } else {
            st.pokedex[inst.speciesId] = 'caught';
        }
        this._notify(inst.speciesId);
        return { ok: true, instance: inst, placed };
    }

    _setPrimaryInternal(uid) {
        const inst = this.get(uid);
        if (!inst) return { ok: false, code: 'unknown_pokemon' };
        this.state.speciesPrimary[inst.speciesId] = uid;
        this._linkLegacy(inst.speciesId);
        return { ok: true };
    }

    setPrimary(uid) {
        const r = this._setPrimaryInternal(uid);
        if (r.ok) this._notify(this.get(uid).speciesId);
        return r;
    }

    // 让旧视图指向主个体（同一个对象引用）
    _linkLegacy(speciesId) {
        const st = this.state;
        const uid = st.speciesPrimary[speciesId];
        const inst = uid ? ownedLookup(st.ownedPokemon, uid) : null;
        if (!inst) { this._unlinkLegacy(speciesId); return; }
        st.caughtPokemon[speciesId] = inst;
        st.pokedex[speciesId] = 'caught';
        if (inst.shiny) st.shinyDex[speciesId] = true;
    }

    _unlinkLegacy(speciesId) {
        delete this.state.caughtPokemon[speciesId];
    }

    rebuildLegacyViews() {
        const st = this.state;
        for (const id of this._ensureIndex().keys()) this.primaryOf(id);
        for (const id of Object.keys(st.caughtPokemon)) {
            if (!this.countOfSpecies(id)) delete st.caughtPokemon[id];
        }
        this.party.syncTeamMirror();
        this._notify(null);
    }

    _removeInstance(inst) {
        const st = this.state;
        delete st.ownedPokemon[inst.uid];
        const list = this._ensureIndex().get(inst.speciesId);
        if (list) {
            const i = list.indexOf(inst.uid);
            if (i !== -1) list.splice(i, 1);
            if (list.length === 0) this._ensureIndex().delete(inst.speciesId);
        }
    }

    // ---------- 放生 / 转移 ----------
    // 规则（兼容旧系统）：队伍里的不能直接放生；一个物种的最后一只不能放生
    // （旧代码用“物种有个体”表示图鉴已收集，删光会让旧逻辑拿到空数据）。
    release(uid, { reason = 'release' } = {}) {
        const st = this.state;
        const inst = this.get(uid);
        if (!inst) return { ok: false, code: 'unknown_pokemon' };
        if (reason !== 'release' && reason !== 'transfer') return { ok: false, code: 'bad_reason' };
        if (this.party.contains(uid)) return { ok: false, code: 'in_party' };
        if (this.countOfSpecies(inst.speciesId) <= 1) return { ok: false, code: 'last_of_species' };

        const wasPrimary = this.isPrimary(inst);
        this.pc.withdraw(uid);
        this._removeInstance(inst);
        if (wasPrimary) {
            delete st.speciesPrimary[inst.speciesId];
            this.primaryOf(inst.speciesId); // 选出新的主个体并重新链接旧视图
        }
        this._notify(inst.speciesId);
        const record = {
            uid: inst.uid,
            speciesId: inst.speciesId,
            level: inst.level,
            shiny: inst.shiny,
            nickname: inst.nickname,
            nature: inst.nature,
            ivs: { ...inst.ivs },
            origin: inst.origin,
            caughtAt: inst.caughtAt,
            releasedAt: this._now(),
            reason,
        };
        st.released.push(record);
        if (st.released.length > RELEASED_LOG_MAX) st.released.splice(0, st.released.length - RELEASED_LOG_MAX);
        return { ok: true, record };
    }

    // ---------- 队伍 ↔ PC ----------
    moveToParty(uid) {
        if (!this.has(uid)) return { ok: false, code: 'unknown_pokemon' };
        if (this.party.contains(uid)) return { ok: false, code: 'already_in_party' };
        if (this.party.isFull()) return { ok: false, code: 'party_full' };
        const pos = this.pc.withdraw(uid);
        if (!pos.ok) return pos;
        const r = this.party.add(uid);
        if (!r.ok) { this.pc.deposit(uid, { box: pos.box, slot: pos.slot }); return r; }
        return { ok: true, index: r.index };
    }

    moveToPc(uid, opts) {
        const index = this.party.indexOf(uid);
        if (index === -1) return { ok: false, code: 'not_in_party' };
        const st = this.state;
        if (this.pc.count() >= this.pc.totalCapacity() && st.pc.boxes.length >= PC_MAX_BOXES) return { ok: false, code: 'pc_full' };
        const removed = this.party.removeAt(index, opts);
        if (!removed.ok) return removed;
        const dep = this.pc.deposit(uid);
        return dep.ok ? { ok: true, box: dep.box, slot: dep.slot } : dep;
    }

    // 用 PC 里的某只换下队伍里某个位置的，换下的那只放进同一个格子
    swapPartyWithPc(partyIndex, pcUid) {
        const st = this.state;
        if (!Number.isInteger(partyIndex) || partyIndex < 0 || partyIndex >= st.party.length) return { ok: false, code: 'bad_index' };
        const pos = this.pc.find(pcUid);
        if (!pos) return { ok: false, code: 'not_in_pc' };
        this.pc.withdraw(pcUid);
        const r = this.party.replaceAt(partyIndex, pcUid);
        if (!r.ok) { this.pc.deposit(pcUid, pos); return r; }
        this.pc.deposit(r.replaced, pos);
        return { ok: true, replaced: r.replaced };
    }

    setNickname(uid, nickname) {
        const inst = this.get(uid);
        if (!inst) return { ok: false, code: 'unknown_pokemon' };
        inst.nickname = sanitizeNickname(nickname);
        return { ok: true, nickname: inst.nickname };
    }

    // ---------- 与旧代码对齐 ----------
    // 旧代码（和旧测试）会直接改 state.team。每次需要队伍个体前调用：
    // 一致则几乎零开销；不一致则以 team 为准重建 party，被换下的个体放进 PC，绝不丢个体。
    reconcile() {
        if (this.party.isMirrorConsistent()) return false;
        const st = this.state;
        const oldParty = st.party.slice();
        const team = Array.isArray(st.team) ? st.team : [];
        const used = new Set();
        const next = [];
        for (let i = 0; i < team.length && next.length < PARTY_MAX; i++) {
            const sp = Number(team[i]);
            if (!Object.prototype.hasOwnProperty.call(POKEMON_DATA, sp)) continue;
            let cand = ownedLookup(st.ownedPokemon, oldParty[i]);
            if (!cand || cand.speciesId !== sp || used.has(cand.uid)) cand = this.primaryOf(sp);
            if (!cand || used.has(cand.uid)) cand = this.ofSpecies(sp).find(c => !used.has(c.uid)) || null;
            if (!cand) continue;
            used.add(cand.uid);
            next.push(cand.uid);
        }
        if (next.length === 0) { this.party.syncTeamMirror(); return true; } // 无法重建：保持旧队伍

        for (const uid of next) { if (this.pc.contains(uid)) this.pc.withdraw(uid); }
        st.party.length = 0;
        for (const uid of next) st.party.push(uid);
        for (const uid of oldParty) {
            if (ownedLookup(st.ownedPokemon, uid) && !used.has(uid) && !this.pc.contains(uid)) this.pc.deposit(uid);
        }
        if (st.activePokemonIndex >= st.party.length || st.activePokemonIndex < 0) st.activePokemonIndex = 0;
        this.party.syncTeamMirror();
        return true;
    }

    checkIntegrity() {
        return validateRosterIntegrity(this.state);
    }
}
