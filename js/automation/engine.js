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
