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

    // 余额上限（防止数值溢出）
    maxMoney: Number.MAX_SAFE_INTEGER / 4,
};

// 存档里的 economy 字段：只存累计数字（不存流水）。没有字段 = 从未发生过经济活动
function sanitizeEconomyState(raw) {
    const out = { earned: 0, spent: 0, byReason: {} };
    if (!_isObj(raw)) return out;
    out.earned = _num(raw.earned, 0, 0);
    out.spent = _num(raw.spent, 0, 0);
    const all = ECONOMY_CONFIG.reasons.earn.concat(ECONOMY_CONFIG.reasons.spend);
    if (_isObj(raw.byReason)) {
        for (const reason of all) {
            const r = raw.byReason[reason];
            if (_isObj(r)) out.byReason[reason] = { earned: _num(r.earned, 0, 0), spent: _num(r.spent, 0, 0) };
        }
    }
    return out;
}
