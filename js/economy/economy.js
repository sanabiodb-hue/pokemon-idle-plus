// ============================================================
// 经济（挂在 GameCore 上的 mixin）：金币的唯一出入口。
//   earnMoney / spendMoney：校验 → 修改余额 → 记账（累计数字）→ 发 money_earned / money_spent 事件。
// 约定：
//   - 界面和自动化绝不直接改 gameState.gold，只请求这里的操作。
//   - 余额永远不会为负；金额必须是正整数；必须带已登记的 reason。
//   - 只存累计数字（按来源汇总），不存逐笔流水。
// ============================================================
const EconomyMethods = {
    getEconomyConfig() {
        return this.econCfg || ECONOMY_CONFIG;
    },

    ensureEconomy() {
        const gs = this.gameState;
        if (!gs) return null;
        if (!_isObj(gs.economy)) gs.economy = { earned: 0, spent: 0, byReason: {} };
        return gs.economy;
    },

    getMoney() {
        return this.gameState ? this.gameState.gold : 0;
    },

    canAfford(amount) {
        return Number.isFinite(amount) && amount >= 0 && this.getMoney() >= amount;
    },

    // 打怪是否掉钱：新经济下从游戏开始就掉；关都徽章仍然控制旧的商店
    isMoneyEarningEnabled() {
        return this.getEconomyConfig().earnFromStart || this.isGoldUnlocked();
    },

    _validateMoneyOp(kind, amount, reason) {
        if (!this.gameState) return { ok: false, code: 'no_state' };
        if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) return { ok: false, code: 'invalid_amount' };
        const list = this.getEconomyConfig().reasons[kind];
        if (typeof reason !== 'string' || !list.includes(reason)) return { ok: false, code: 'invalid_reason' };
        return { ok: true };
    },

    _ledger(kind, amount, reason) {
        const eco = this.ensureEconomy();
        eco[kind === 'earn' ? 'earned' : 'spent'] += amount;
        const row = eco.byReason[reason] || (eco.byReason[reason] = { earned: 0, spent: 0 });
        row[kind === 'earn' ? 'earned' : 'spent'] += amount;
    },

    _moneyEvent(type, amount, reason, meta) {
        const s = this.getHuntSession();
        const payload = { amount, reason, balance: this.gameState.gold, sessionId: s && s.state === 'running' ? s.id : null };
        if (meta && typeof meta === 'object') for (const k of Object.keys(meta)) if (!(k in payload)) payload[k] = meta[k];
        this._emit(type, payload);
    },

    // 获得金币。amount 必须是正整数；返回 { ok, amount, balance }
    earnMoney(amount, reason, meta) {
        const v = this._validateMoneyOp('earn', amount, reason);
        if (!v.ok) return v;
        const gs = this.gameState;
        const room = Math.max(0, this.getEconomyConfig().maxMoney - gs.gold);
        const credited = Math.min(amount, room);
        if (credited <= 0) return { ok: true, amount: 0, balance: gs.gold };
        gs.gold += credited;
        gs.stats.totalGold += credited;
        this._ledger('earn', credited, reason);
        this._moneyEvent('money_earned', credited, reason, meta);
        return { ok: true, amount: credited, balance: gs.gold };
    },

    // 花费金币。余额不足时什么都不改；返回 { ok, amount, balance } 或 { ok:false, code }
    spendMoney(amount, reason, meta) {
        const v = this._validateMoneyOp('spend', amount, reason);
        if (!v.ok) return v;
        const gs = this.gameState;
        if (gs.gold < amount) return { ok: false, code: 'insufficient_funds', need: amount, have: gs.gold };
        gs.gold -= amount;
        this._ledger('spend', amount, reason);
        this._moneyEvent('money_spent', amount, reason, meta);
        return { ok: true, amount, balance: gs.gold };
    },

    // 旧接口：战斗掉落走这里（来源固定为 battle）
    addGold(amount) {
        return this.earnMoney(amount, 'battle');
    },
};

function installEconomy(GameCoreClass) {
    for (const key of Object.keys(EconomyMethods)) GameCoreClass.prototype[key] = EconomyMethods[key];
}

installEconomy(GameCore);
