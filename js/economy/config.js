// ============================================================
// 经济配置（阶段 6）：所有会改变平衡的数字都集中在这里，代码里不写死价格/系数。
// 这些值是"起点"，最终数字由 tools/simulate-economy.js 的模拟结果决定（见 README 的平衡表）。
// 实例可以通过 game.econCfg 覆盖（模拟器用来比较不同配置而不污染全局）。
// ============================================================
const ECONOMY_CONFIG = {
    // 打怪就掉钱，不再等到拿到关都徽章；宝石/树果/天赋商店仍按旧的徽章进度解锁
    earnFromStart: true,

    // 每次钱的变动都必须带一个来源（reason）；未登记的来源会被拒绝
    reasons: {
        earn: ['battle', 'sale', 'reward', 'refund'],
        spend: ['gem_purchase', 'berry_seed', 'talent_reset', 'potion_purchase', 'upgrade_purchase'],
    },

    // 药水（第一个商店物品）。价格随进度缩放：price = max(basePrice, ceil(winsPerPotion × 一场胜利的基础金币(进度等级)))
    // 进度等级 = 玩家拥有过的最高等级（只增不减，避免在低级路线买便宜药水去高级路线用）
    potion: {
        basePrice: 40,
        winsPerPotion: 10,         // 一瓶药水 ≈ 这么多场"同等级"胜利的收入（起点值，最终值由模拟决定）
        capacityBase: 30,          // 药水库存上限（可由升级提高）
        packs: [1, 5, 10],         // 界面上的快捷购买数量
    },

    // 升级（阶段 6 的 5 个）：花钱买"效率"。所有效果通过修改器注册表（modifiers.js）生效，核心里没有 if 升级X。
    //   cost(n) = ceil(base × growth^n × 进度缩放)，n = 当前等级（买下一级的价格）
    //   effects：stat 是修改器名；kind 'mult' = 1 + perLevel×等级（delay 类用 1 − perLevel×等级，不低于 floor）；'add' = perLevel×等级
    //   requires：[{ id, level }]，全部满足才解锁
    // 数值是起点，最终由 tools/simulate-economy.js 的模拟结果校准。
    upgradeCostScale: { referenceLevel: 5 },        // 进度缩放 = max(1, 一场胜利金币(进度等级) / 一场胜利金币(referenceLevel))
    upgrades: {
        heal_efficiency: {
            id: 'heal_efficiency', name: 'Eficiência de Cura', icon: '💊', build: 'support',
            description: 'Cada poção recupera mais HP, então você gasta menos poções.',
            maxLevel: 10, cost: { base: 150, growth: 1.45 }, requires: [],
            effects: [{ stat: 'potion_heal', kind: 'mult', perLevel: 0.08, unit: '% de cura' }],
        },
        potion_capacity: {
            id: 'potion_capacity', name: 'Capacidade de Poções', icon: '🎒', build: 'support',
            description: 'Aumenta quantas poções você consegue guardar: caçadas longas e offline aguentam mais.',
            maxLevel: 10, cost: { base: 120, growth: 1.4 }, requires: [],
            effects: [{ stat: 'potion_cap', kind: 'add', perLevel: 6, unit: ' poções' }],
        },
        hunt_speed: {
            id: 'hunt_speed', name: 'Velocidade de Caça', icon: '⚡', build: 'speed',
            description: 'Reduz o intervalo entre um encontro e o próximo.',
            maxLevel: 15, cost: { base: 300, growth: 1.5 }, requires: [{ id: 'heal_efficiency', level: 2 }],
            effects: [{ stat: 'battle_delay', kind: 'delay', perLevel: 0.04, floor: 0.4, unit: '% de intervalo' }],
        },
        hunt_xp: {
            id: 'hunt_xp', name: 'XP de Caça', icon: '📚', build: 'xp',
            description: 'Aumenta a EXP ganha ao vencer.',
            maxLevel: 20, cost: { base: 400, growth: 1.5 }, requires: [{ id: 'potion_capacity', level: 2 }],
            effects: [{ stat: 'exp', kind: 'mult', perLevel: 0.05, unit: '% de EXP' }],
        },
        hunt_profit: {
            id: 'hunt_profit', name: 'Lucro de Caça', icon: '💰', build: 'money',
            description: 'Aumenta as moedas ganhas ao vencer.',
            maxLevel: 20, cost: { base: 500, growth: 1.5 }, requires: [{ id: 'heal_efficiency', level: 2 }, { id: 'potion_capacity', level: 2 }],
            effects: [{ stat: 'gold', kind: 'mult', perLevel: 0.05, unit: '% de moedas' }],
        },
    },

    // 狩猎分析器：只存聚合数字（最近 N 次狩猎 + 每条路线的累计），不存逐场事件
    analyzer: {
        goals: ['xp', 'money', 'captures', 'shiny'],
        defaultGoal: 'xp',
        historyMax: 20,
        routesMax: 60,                         // 最多保留多少条路线的累计（超出时淘汰最久没玩的）
        minSampleMs: 10 * 60 * 1000,           // 真实数据至少要有这么长的样本才当作"实测"，否则显示"估算"
    },

    // 路线对比 / 推荐
    compare: {
        estimateMs: 30 * 60 * 1000,            // 估算用的模拟时长
        maxCandidates: 8,                      // 一次最多比较多少条路线
        minWinRate: 50,                        // 胜率低于此值的路线不会被推荐为"最好"
        levelBand: [0.3, 1.3],                 // 候选路线的最低等级 ∈ [队伍平均等级×0.3, ×1.3]
        recommendMinGainPct: 5,                // 比当前路线至少好这么多才推荐换
    },

    // 余额上限（防止数值溢出）
    maxMoney: Number.MAX_SAFE_INTEGER / 4,
};

// 存档里的 economy 字段：只存累计数字（不存流水）。没有字段 = 从未发生过经济活动
function sanitizeEconomyState(raw) {
    const out = { earned: 0, spent: 0, byReason: {} };
    if (!_isObj(raw)) return out;
    out.earned = _num(raw.earned, 0, 0);
    out.spent = _num(raw.spent, 0, 0);
    if (_has(raw, 'progressLevel')) out.progressLevel = _int(raw.progressLevel, 1, 1e6, 1);
    const all = ECONOMY_CONFIG.reasons.earn.concat(ECONOMY_CONFIG.reasons.spend);
    if (_isObj(raw.byReason)) {
        for (const reason of all) {
            const r = raw.byReason[reason];
            if (_isObj(r)) out.byReason[reason] = { earned: _num(r.earned, 0, 0), spent: _num(r.spent, 0, 0) };
        }
    }
    return out;
}

// 存档里的升级等级：{ id: 等级 }，只认登记过的升级，等级限制在 0..maxLevel
function sanitizeUpgradesState(raw) {
    const out = {};
    if (!_isObj(raw)) return out;
    for (const id of Object.keys(ECONOMY_CONFIG.upgrades)) {
        if (!_has(raw, id)) continue;
        const lv = _int(raw[id], 0, ECONOMY_CONFIG.upgrades[id].maxLevel, 0);
        if (lv > 0) out[id] = lv;
    }
    return out;
}
