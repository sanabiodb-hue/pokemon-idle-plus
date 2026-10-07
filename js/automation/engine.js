// 自动化引擎（挂在 GameCore 上的 mixin，与 guidance.js 同样的装配方式）。
// 数据流：GAME STATE → POLICY → ENGINE → DECISION → ACTION → GAME RULES → STATE CHANGE → EVENT。
// 引擎只做"决定与调度"；伤害、经验、捕获、奖励一律由核心规则完成，界面不参与任何决策。
// 默认关闭：没有策略/会话时游戏行为与旧版完全一致。

const AutomationMethods = {
    // ---------- 策略 ----------
    // 未配置过时返回默认策略（不写入存档，保持"从未配置 = 默认关闭"）
    getAutomationPolicy() {
        const a = this.gameState && this.gameState.automation;
        return a && a.policy ? a.policy : defaultAutomationPolicy();
    },

    isAutomationConfigured() {
        return !!(this.gameState && this.gameState.automation && this.gameState.automation.policy);
    },

    // ---------- 会话 ----------
    getHuntSession() {
        const a = this.gameState && this.gameState.automation;
        return a && a.session ? a.session : null;
    },

    // ---------- 动作 ----------
    // 所有自动化动作（开始/停止狩猎、换队员、换路线……）的唯一入口：校验 → 执行 → 发事件
    dispatchAutomationAction(action) {
        if (!this._dispatcher) this._dispatcher = new ActionDispatcher(this);
        return this._dispatcher.dispatch(action);
    },

    // 路线是否存在且所在地区已解锁（changeRoute 本身不校验路线是否存在）
    _checkRouteAccess(routeId) {
        if (typeof routeId !== 'string' || !routeId) return { ok: false, code: 'invalid_route', message: 'Rota inválida.' };
        for (const regionKey in REGIONS) {
            if (REGIONS[regionKey].routes.some(r => r.id === routeId)) {
                return this.isRegionUnlocked(regionKey) ? { ok: true } : { ok: false, code: 'route_locked', message: 'Essa rota ainda está bloqueada.' };
            }
        }
        return { ok: false, code: 'invalid_route', message: 'Rota inválida.' };
    },

    // 严格校验后才会保存；无效策略不改变任何状态。返回 { ok, errors, policy }
    setAutomationPolicy(raw) {
        const result = validateAutomationPolicy(raw);
        if (!result.ok) return result;
        const gs = this.gameState;
        if (!gs.automation) gs.automation = {};
        gs.automation.policy = result.policy;
        this._emit('policy_changed', { policy: result.policy });
        this.save();
        return result;
    },
};

function installAutomation(GameCoreClass) {
    for (const key of Object.keys(AutomationMethods)) GameCoreClass.prototype[key] = AutomationMethods[key];
}

installAutomation(GameCore);
