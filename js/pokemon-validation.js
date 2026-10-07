// ============================================================
// 个体名册的校验：
//   sanitizeInstance()        清洗单只个体（读档/导入时不信任任何字段）
//   sanitizeRosterSection()   清洗整个名册（个体/队伍/PC/放生记录/主个体），并重建旧兼容视图
//   validateRosterIntegrity() 检查运行中状态是否满足全部不变量（测试与调试用，返回问题列表）
//
// 清洗遵循与 sanitizeSave 相同的原则：白名单重建，强制类型和范围，字符串只保留安全字符。
// ============================================================
const MAX_OWNED_POKEMON = PC_MAX_BOXES * PC_BOX_CAPACITY;   // 个体总数上限（与 PC 容量一致，防止恶意存档撑爆内存）

// 清洗单只个体；返回规范个体或 null。key 是它在 ownedPokemon 里的键（uid 的唯一依据）
function sanitizeInstance(raw, key) {
    if (!_isObj(raw) || !isValidInstanceUid(key)) return null;
    const speciesId = _validPokemonId(raw.speciesId);
    if (speciesId === null) return null;
    const data = POKEMON_DATA[speciesId];
    const level = _int(raw.level, 1, MAX_POKEMON_LEVEL, 1);
    return buildInstance({
        uid: key,
        speciesId,
        level,
        // exp 可以低于该等级起点（旧版新开局的 Lv5 皮卡丘 exp=0），不强行抬高
        exp: _num(raw.exp, 0, getExpForLevel(data.expGroup, level)),
        ivs: raw.ivs,
        nature: raw.nature,
        ability: raw.ability,
        gender: raw.gender,
        shiny: raw.shiny === true,
        nickname: raw.nickname,
        origin: raw.origin,
        originRoute: raw.originRoute,
        caughtAt: raw.caughtAt === null ? null : _num(raw.caughtAt, 0, null),
        battles: _num(raw.battles, 0, 0),
        stats: _isObj(raw.stats) ? raw.stats : {},
        skillLevel: _int(raw.skillLevel, 0, MAX_SKILL_LEVEL, 0),
    });
}

// 图鉴存档记录：只保留旧结构需要的几项
function sanitizeArchivedRecord(raw, speciesId) {
    if (!_isObj(raw)) return null;
    const data = POKEMON_DATA[speciesId];
    const level = _int(raw.level, 1, MAX_POKEMON_LEVEL, 1);
    return {
        speciesId,
        level,
        exp: _num(raw.exp, 0, getExpForLevel(data.expGroup, level)),
        ivs: normalizeIvs(raw.ivs),
        skillLevel: _int(raw.skillLevel, 0, MAX_SKILL_LEVEL, 0),
    };
}

function sanitizeReleasedRecord(raw, ownedUids) {
    if (!_isObj(raw) || !isValidInstanceUid(raw.uid) || ownedUids.has(raw.uid)) return null;
    const speciesId = _validPokemonId(raw.speciesId);
    if (speciesId === null) return null;
    return {
        uid: raw.uid,
        speciesId,
        level: _int(raw.level, 1, MAX_POKEMON_LEVEL, 1),
        shiny: raw.shiny === true,
        nickname: sanitizeNickname(raw.nickname),
        nature: isValidNature(raw.nature) ? raw.nature : DEFAULT_NATURE,
        ivs: normalizeIvs(raw.ivs),
        origin: POKEMON_ORIGINS.includes(raw.origin) ? raw.origin : 'unknown',
        caughtAt: raw.caughtAt === null || raw.caughtAt === undefined ? null : toCaptureDate(raw.caughtAt),
        releasedAt: _num(raw.releasedAt, 0, null),
        reason: raw.reason === 'transfer' ? 'transfer' : 'release',
    };
}

// 在 sanitizeSave 里调用。
//   raw：原始（已迁移）对象；out：已清洗的旧结构（caughtPokemon / pokedex / shinyDex 等）
// 旧结构与新结构并存时的优先级（过渡期兼容规则）：
//   - 旧 caughtPokemon[物种] 的 等级/经验/个体值/技能等级 覆盖该物种“主个体”的同名字段；
//   - 旧 team 决定队伍的“物种顺序”，party 里同位置且物种相同的个体优先（用于同物种多只）；
//   - 闪光：主个体闪光 或 shinyDex 为 true ⇒ 两边都置为 true。
// 正常存档里两边完全一致（旧视图就是主个体对象本身），该规则只在被篡改/旧工具改写时起作用。
// 返回 { ok, error?, warnings }，并就地把 out 补全：
//   ownedPokemon / party / pc / released / speciesPrimary / nextPokemonSeq / caughtPokemon / team / pokedex
function sanitizeRosterSection(raw, out) {
    const warnings = [];
    const instances = {};
    let dropped = 0;

    if (_isObj(raw.ownedPokemon)) {
        let n = 0;
        for (const key of Object.keys(raw.ownedPokemon)) {
            if (n >= MAX_OWNED_POKEMON) { dropped++; continue; }
            const inst = sanitizeInstance(raw.ownedPokemon[key], key);
            if (inst) { instances[inst.uid] = inst; n++; } else dropped++;
        }
    }

    let seq = _int(raw.nextPokemonSeq, 1, Number.MAX_SAFE_INTEGER, 1);
    for (const uid of Object.keys(instances)) {
        const s = uidSequence(uid);
        if (s !== null && s >= seq) seq = s + 1;
    }
    const newUid = () => { let u; do { u = 'p' + (seq++); } while (instances[u]); return u; };

    const bySpecies = new Map();
    for (const inst of Object.values(instances)) {
        if (!bySpecies.has(inst.speciesId)) bySpecies.set(inst.speciesId, []);
        bySpecies.get(inst.speciesId).push(inst);
    }

    // ---- 主个体：优先存档记录的，否则选最强的 ----
    const rawPrimary = _isObj(raw.speciesPrimary) ? raw.speciesPrimary : {};
    const primary = {};
    for (const [sp, list] of bySpecies) {
        const hinted = list.find(i => i.uid === (_has(rawPrimary, sp) ? rawPrimary[sp] : null));
        primary[sp] = hinted || PokemonRoster.chooseBest(list);
    }

    // ---- 图鉴存档：物种的最后一只个体进化走之后留下的记录 ----
    const rawArchived = _isObj(raw.archivedSpecies) ? raw.archivedSpecies : {};
    const archived = {};
    for (const key of Object.keys(rawArchived)) {
        const sp = _validPokemonId(key);
        if (sp === null || primary[sp]) continue;           // 有活的个体就不需要存档
        const rec = sanitizeArchivedRecord(rawArchived[key], sp);
        if (rec) archived[sp] = rec;
    }

    // ---- 旧结构覆盖/补全 ----
    for (const idStr of Object.keys(out.caughtPokemon)) {
        const sp = Number(idStr);
        const legacy = out.caughtPokemon[sp];
        let p = primary[sp];
        if (!p && archived[sp]) {          // 旧镜像里的数值覆盖存档
            Object.assign(archived[sp], { level: legacy.level, exp: legacy.exp, ivs: { ...legacy.ivs }, skillLevel: legacy.skillLevel });
            continue;
        }
        if (p) {
            p.level = legacy.level;
            p.exp = legacy.exp;
            p.ivs = { ...legacy.ivs };
            p.skillLevel = legacy.skillLevel;
        } else {
            if (Object.keys(instances).length >= MAX_OWNED_POKEMON) { dropped++; continue; }
            p = buildInstance({
                uid: newUid(), speciesId: sp, level: legacy.level, exp: legacy.exp, ivs: legacy.ivs,
                skillLevel: legacy.skillLevel, shiny: !!out.shinyDex[sp], nature: DEFAULT_NATURE,
                origin: 'legacy_migration', caughtAt: null,
            });
            instances[p.uid] = p;
            primary[sp] = p;
            if (!bySpecies.has(sp)) bySpecies.set(sp, []);
            bySpecies.get(sp).push(p);
        }
    }
    // 闪光双向对齐
    for (const [sp, p] of Object.entries(primary)) {
        if (out.shinyDex[sp]) p.shiny = true;
        else if (p.shiny) out.shinyDex[sp] = true;
    }

    // ---- 队伍 ----
    const rawParty = Array.isArray(raw.party) ? raw.party.slice(0, 100) : [];
    const rawTeam = Array.isArray(raw.team) ? raw.team.slice(0, 100) : [];
    const used = new Set();
    const party = [];
    const pick = (speciesId, hint) => {
        if (hint && hint.speciesId === speciesId && !used.has(hint.uid)) return hint;
        const p = primary[speciesId];
        if (p && !used.has(p.uid)) return p;
        return (bySpecies.get(speciesId) || []).find(i => !used.has(i.uid)) || null;
    };
    const teamSpecies = rawTeam.map(_validPokemonId);
    if (rawTeam.length > 0) {   // 旧的 team 一旦存在就是权威：它里面一个有效成员都没有，即视为存档损坏
        for (let i = 0; i < teamSpecies.length && party.length < PARTY_MAX; i++) {
            if (teamSpecies[i] === null) continue;
            const hint = ownedLookup(instances, rawParty[i]);
            const inst = pick(teamSpecies[i], hint);
            if (inst) { used.add(inst.uid); party.push(inst.uid); }
        }
    } else {
        for (const u of rawParty) {
            const inst = ownedLookup(instances, u);
            if (inst && !used.has(inst.uid) && party.length < PARTY_MAX) { used.add(inst.uid); party.push(inst.uid); }
        }
    }
    if (party.length === 0) {
        return { ok: false, error: 'A equipe do save não tem nenhum Pokémon capturado válido.', warnings };
    }

    // ---- PC：保留合法的格子位置，其余（含孤儿）按物种顺序补进空格 ----
    const placed = new Set(party);
    const boxes = [];
    const rawBoxes = _isObj(raw.pc) && Array.isArray(raw.pc.boxes) ? raw.pc.boxes.slice(0, PC_MAX_BOXES) : [];
    const usedBoxIds = new Set();
    rawBoxes.forEach((rb, bi) => {
        if (!_isObj(rb)) return;
        const capacity = _int(rb.capacity, 1, PC_BOX_CAPACITY, PC_BOX_CAPACITY);
        let id = _int(rb.id, 1, 1e9, bi + 1);
        while (usedBoxIds.has(id)) id++;
        usedBoxIds.add(id);
        const box = { id, name: sanitizeBoxName(rb.name, bi), capacity, slots: new Array(capacity).fill(null) };
        const slots = Array.isArray(rb.slots) ? rb.slots : [];
        for (let i = 0; i < capacity; i++) {
            const u = slots[i];
            if (ownedLookup(instances, u) && !placed.has(u)) { box.slots[i] = u; placed.add(u); }
        }
        boxes.push(box);
    });
    if (boxes.length === 0) boxes.push(PCStorage.createBox(1, sanitizeBoxName('', 0)));
    const orphans = Object.values(instances)
        .filter(i => !placed.has(i.uid))
        .sort((a, b) => a.speciesId - b.speciesId || (uidSequence(a.uid) ?? 0) - (uidSequence(b.uid) ?? 0));
    let overflow = 0;
    for (const inst of orphans) {
        let done = false;
        for (const box of boxes) {
            const slot = box.slots.indexOf(null);
            if (slot !== -1) { box.slots[slot] = inst.uid; done = true; break; }
        }
        if (!done && boxes.length < PC_MAX_BOXES) {
            const box = PCStorage.createBox(boxes.reduce((m, b) => Math.max(m, b.id), 0) + 1, sanitizeBoxName('', boxes.length));
            box.slots[0] = inst.uid;
            boxes.push(box);
            done = true;
        }
        if (done) placed.add(inst.uid);
        else { delete instances[inst.uid]; overflow++; }
    }
    if (overflow) warnings.push(`PC 已满，丢弃了 ${overflow} 只个体`);
    // 主个体不能指向被丢弃的个体
    for (const [sp, p] of Object.entries(primary)) {
        if (!instances[p.uid]) {
            const best = PokemonRoster.chooseBest(Object.values(instances).filter(i => i.speciesId === Number(sp)));
            if (best) primary[sp] = best; else delete primary[sp];
        }
    }

    // ---- 放生记录 ----
    const ownedUids = new Set(Object.keys(instances));
    const released = [];
    if (Array.isArray(raw.released)) {
        for (const r of raw.released.slice(-RELEASED_LOG_MAX)) {
            const rec = sanitizeReleasedRecord(r, ownedUids);
            if (rec) released.push(rec);
        }
    }

    // ---- 写回 out，并重建旧兼容视图 ----
    out.ownedPokemon = instances;
    out.party = party;
    out.pc = { boxes };
    out.released = released;
    out.speciesPrimary = Object.fromEntries(Object.entries(primary).map(([sp, p]) => [sp, p.uid]));
    out.nextPokemonSeq = seq;
    out.archivedSpecies = archived;
    out.caughtPokemon = {};
    for (const [sp, p] of Object.entries(primary)) out.caughtPokemon[sp] = p;   // 同一个对象引用
    for (const [sp, rec] of Object.entries(archived)) out.caughtPokemon[sp] = rec;
    out.team = party.map(u => instances[u].speciesId);

    if (dropped) warnings.push(`已忽略 ${dropped} 只无效的个体`);
    return { ok: true, warnings };
}

// 检查运行中的状态是否满足全部不变量。返回问题描述数组（空数组 = 完全健康）
function validateRosterIntegrity(state) {
    const problems = [];
    const owned = state.ownedPokemon;
    if (!_isObj(owned)) return ['ownedPokemon 缺失'];
    const ownedUids = Object.keys(owned);

    // 1. 个体本身
    for (const uid of ownedUids) {
        const inst = owned[uid];
        if (inst.uid !== uid) problems.push(`个体 ${uid} 的 uid 字段是 ${inst.uid}`);
        if (!_has(POKEMON_DATA, inst.speciesId)) problems.push(`个体 ${uid} 的物种 ${inst.speciesId} 不存在`);
        if (!isValidInstanceUid(uid)) problems.push(`个体 uid ${uid} 含非法字符或与内置属性重名`);
        const seqN = uidSequence(uid);
        if (seqN !== null && seqN >= state.nextPokemonSeq) problems.push(`nextPokemonSeq(${state.nextPokemonSeq}) 没有超过 ${uid}`);
    }

    // 2. 位置：每只恰好一处
    const where = new Map();
    const place = (uid, label) => {
        if (!ownedLookup(owned, uid)) problems.push(`${label} 引用了不存在的个体 ${uid}`);
        if (where.has(uid)) problems.push(`个体 ${uid} 同时出现在 ${where.get(uid)} 与 ${label}`);
        else where.set(uid, label);
    };
    if (!Array.isArray(state.party)) problems.push('party 缺失');
    else {
        if (state.party.length < 1) problems.push('队伍为空');
        if (state.party.length > PARTY_MAX) problems.push(`队伍超过 ${PARTY_MAX} 只`);
        state.party.forEach((uid, i) => place(uid, `队伍[${i}]`));
        if (!Number.isInteger(state.activePokemonIndex) || state.activePokemonIndex < 0 || state.activePokemonIndex >= state.party.length) {
            problems.push(`出战下标 ${state.activePokemonIndex} 超出队伍范围`);
        }
        if (!Array.isArray(state.team) || state.team.length !== state.party.length ||
            state.party.some((u, i) => !ownedLookup(owned, u) || owned[u].speciesId !== state.team[i])) {
            problems.push('team 视图与 party 不一致');
        }
    }
    const boxes = state.pc && state.pc.boxes;
    if (!Array.isArray(boxes) || boxes.length < 1) problems.push('PC 没有箱子');
    else {
        if (boxes.length > PC_MAX_BOXES) problems.push('箱子数量超过上限');
        const ids = new Set();
        boxes.forEach((box, bi) => {
            if (ids.has(box.id)) problems.push(`箱子 id ${box.id} 重复`);
            ids.add(box.id);
            if (!Array.isArray(box.slots) || box.slots.length !== box.capacity) problems.push(`箱子 ${bi} 的格子数与容量不符`);
            (box.slots || []).forEach((uid, si) => { if (uid !== null) place(uid, `PC[${bi}][${si}]`); });
        });
    }
    for (const uid of ownedUids) if (!where.has(uid)) problems.push(`个体 ${uid} 不在队伍也不在 PC（孤儿）`);

    // 3. 主个体与旧兼容视图
    const speciesWithInstances = new Set(ownedUids.map(u => owned[u].speciesId));
    const archivedMap = _isObj(state.archivedSpecies) ? state.archivedSpecies : {};
    for (const sp of Object.keys(archivedMap)) {
        if (speciesWithInstances.has(Number(sp))) problems.push(`物种 #${sp} 已有个体，不应再有图鉴存档`);
        if (state.caughtPokemon[sp] !== archivedMap[sp]) problems.push(`caughtPokemon[#${sp}] 不是图鉴存档本身`);
        if (state.pokedex[sp] !== 'caught') problems.push(`图鉴存档物种 #${sp} 的图鉴不是 caught`);
    }
    for (const sp of speciesWithInstances) {
        const uid = state.speciesPrimary && state.speciesPrimary[sp];
        const p = uid ? owned[uid] : null;
        if (!p || p.speciesId !== sp) { problems.push(`物种 #${sp} 没有有效的主个体`); continue; }
        if (state.caughtPokemon[sp] !== p) problems.push(`caughtPokemon[#${sp}] 不是主个体对象本身`);
        if (state.pokedex[sp] !== 'caught') problems.push(`物种 #${sp} 有个体但图鉴不是 caught`);
        if (p.shiny && !state.shinyDex[sp]) problems.push(`物种 #${sp} 的主个体闪光但 shinyDex 未记录`);
    }
    for (const sp of Object.keys(state.caughtPokemon || {})) {
        if (!speciesWithInstances.has(Number(sp)) && !_has(archivedMap, sp)) problems.push(`caughtPokemon[#${sp}] 没有对应个体或图鉴存档`);
    }
    for (const sp of Object.keys(state.speciesPrimary || {})) {
        if (!speciesWithInstances.has(Number(sp))) problems.push(`speciesPrimary[#${sp}] 指向没有个体的物种`);
    }

    // 4. 放生记录
    for (const rec of state.released || []) {
        if (owned[rec.uid]) problems.push(`放生记录 ${rec.uid} 仍在 ownedPokemon 中`);
    }
    return problems;
}
