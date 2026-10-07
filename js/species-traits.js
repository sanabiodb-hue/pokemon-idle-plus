// ============================================================
// 物种特质：性格 / 性别 / 特性槽位 的随机生成（纯函数，无游戏状态依赖）
//
// 数据说明（重要）：
//   - 项目的物种表里没有“性别比例”和“特性列表”，所以：
//       性别：下面的 GENDER_OVERRIDES 只列出常见的“无性别 / 只有雄性 / 只有雌性”物种，其余一律 50/50。
//             这是近似数据，将来补全物种表后只需替换这一个文件。
//       特性：先记录“特性槽位”（a1 / a2 / ha=隐藏），每只个体独立随机；具体特性名称与效果等有数据后再接入。
//   - rollTraits 无论结果如何都固定消耗 4 个随机数，所以同一个随机序列下结果可复现。
// ============================================================
const ABILITY_SLOTS = ['a1', 'a2', 'ha'];
const HIDDEN_ABILITY_RATE = 1 / 64;    // 隐藏特性概率

const _ids = (...ranges) => {
    const out = [];
    for (const r of ranges) {
        if (Array.isArray(r)) for (let i = r[0]; i <= r[1]; i++) out.push(i);
        else out.push(r);
    }
    return out;
};

const GENDER_OVERRIDES = (() => {
    const map = {};
    // 无性别：磁怪/雷电球/海星/百变怪/多边兽、传说与幻之等
    for (const id of _ids(81, 82, 100, 101, 120, 121, 132, 137, 144, 145, 146, 150, 151, 201, 233, 243, 244, 245,
        249, 250, 251, 292, 337, 338, 343, 344, 374, 375, 376, [377, 386], 436, 437, 462, 474, 479, [480, 493],
        [599, 601], 615, 622, 623, [638, 649], 703, [716, 721], 772, 773, [785, 800], 801, 802)) map[id] = 'genderless';
    // 只有雄性
    for (const id of _ids([32, 34], 106, 107, 128, 236, 237, 313, 414, 475, 538, 539, 627, 628, 641, 642, 645)) map[id] = 'male';
    // 只有雌性
    for (const id of _ids([29, 31], 113, 115, 124, 238, 241, 242, 314, 413, 416, 440, 478, 488, 548, 549, 629, 630,
        [669, 671], [761, 763])) map[id] = 'female';
    return map;
})();

// 该物种可能出现的性别：'genderless' | 'male' | 'female' | 'both'
function getGenderRule(speciesId) {
    return GENDER_OVERRIDES[speciesId] || 'both';
}

function rollNature(rng) {
    return POKEMON_NATURES[Math.floor(rng() * POKEMON_NATURES.length)].id;
}

// 固定消耗 1 个随机数
function rollGender(speciesId, rng) {
    const r = rng();
    switch (getGenderRule(speciesId)) {
        case 'genderless': return null;
        case 'male': return 'male';
        case 'female': return 'female';
        default: return r < 0.5 ? 'male' : 'female';
    }
}

// 固定消耗 2 个随机数
function rollAbilitySlot(rng) {
    const hidden = rng() < HIDDEN_ABILITY_RATE;
    const second = rng() < 0.5;
    return hidden ? 'ha' : (second ? 'a2' : 'a1');
}

// 一只新个体的先天特质：{ nature, gender, ability }。固定消耗 4 个随机数
function rollTraits(speciesId, rng) {
    return {
        nature: rollNature(rng),
        gender: rollGender(speciesId, rng),
        ability: rollAbilitySlot(rng),
    };
}
