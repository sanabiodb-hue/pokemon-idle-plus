// ============================================================
// 迁移：旧存档（每个物种一条 caughtPokemon）→ 新结构（每只个体一条 ownedPokemon）
//
// 规则（对应存档 schema v2 → v3）：
//   1. 每个已捕获物种创建一只“初始个体”，保留 个体值 / 等级 / 经验 / 技能等级；
//      闪光 = shinyDex 里该物种是否为 true。性格为中性（hardy）、特性/性别为空、来源 legacy_migration。
//   2. 队伍：按旧 team 的顺序映射成 party（出战下标不变）。
//   3. 其余个体按图鉴编号顺序放进 PC 箱子（每箱 30 只）。
//   4. 旧字段（caughtPokemon / team / pokedex / shinyDex）原样保留：旧代码继续可用。
//   5. uid 按物种编号升序依次分配（p1, p2, …），所以同一份旧存档每次迁移结果完全相同。
//
// 输入是“尚未清洗的原始对象”，所以这里只做宽松读取；类型和范围由随后的 sanitizeSave 强制。
// 重复迁移是安全的：总是丢弃已有的新结构并从旧结构重新生成。
// ============================================================
function migrateLegacyToInstances(data) {
    const caught = _isObj(data.caughtPokemon) ? data.caughtPokemon : {};
    const shinyDex = _isObj(data.shinyDex) ? data.shinyDex : {};
    const owned = {};
    const uidBySpecies = {};
    let seq = 1;

    const speciesIds = Object.keys(caught)
        .map(_validPokemonId)
        .filter(id => id !== null && _isObj(caught[id]))
        .sort((a, b) => a - b);

    for (const id of speciesIds) {
        const entry = caught[id];
        const uid = 'p' + (seq++);
        owned[uid] = buildInstance({
            uid,
            speciesId: id,
            level: entry.level,
            exp: entry.exp,
            ivs: entry.ivs,
            skillLevel: entry.skillLevel,
            shiny: !!shinyDex[id],
            nature: DEFAULT_NATURE,
            origin: 'legacy_migration',
            caughtAt: null,
        });
        uidBySpecies[id] = uid;
    }

    // 队伍：保持旧顺序；同一物种重复出现只取第一次（旧结构里一个物种只有一条数据）
    const party = [];
    const inParty = new Set();
    const team = Array.isArray(data.team) ? data.team.slice(0, 100) : [];
    for (const raw of team) {
        const id = _validPokemonId(raw);
        if (id === null || !uidBySpecies[id] || inParty.has(id)) continue;
        inParty.add(id);
        party.push(uidBySpecies[id]);
        if (party.length >= PARTY_MAX) break;
    }

    // PC：不在队伍里的，按图鉴编号顺序
    const stored = speciesIds.filter(id => !inParty.has(id)).map(id => uidBySpecies[id]);
    const { pc, overflow } = PCStorage.layout(stored);

    data.ownedPokemon = owned;
    data.party = party;
    data.pc = pc;
    data.released = [];
    data.speciesPrimary = Object.fromEntries(speciesIds.map(id => [id, uidBySpecies[id]]));
    data.nextPokemonSeq = seq;
    return { data, created: speciesIds.length, overflow: overflow.length };
}
