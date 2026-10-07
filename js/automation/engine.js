// 自动化引擎（挂在 GameCore 上的 mixin，与 guidance.js 同样的装配方式）。
// 数据流：GAME STATE → POLICY → ENGINE → DECISION → ACTION → GAME RULES → STATE CHANGE → EVENT。
// 引擎只做"决定与调度"；伤害、经验、捕获、奖励一律由核心规则完成，界面不参与任何决策。
// 默认关闭：没有策略/会话时游戏行为与旧版完全一致。

// 实时驱动（live driver）：订阅核心事件，在"遭遇开始 / 战斗结束"这些边界上收集快照 → 交给纯决策函数 → 经 ActionDispatcher 执行。
// 战斗本身仍由核心的 50ms 战斗循环推进（引擎不碰伤害/经验/捕获/奖励）。
// 只在有"进行中"的狩猎时订阅总线；没有狩猎时零开销，游戏行为与旧版一致。
// 防循环：每次评估最多执行 AUTOMATION_MAX_ACTIONS_PER_EVALUATION 个动作，且评估期间不会被重入；
//        动作产生的事件（route_changed 等）只更新会话，不会再触发评估。
const AUTOMATION_MAX_ACTIONS_PER_EVALUATION = 4;

class AutomationEngine {
    constructor(game) {
        this.game = game;
        this._unsubs = [];
        this._evaluating = false;
        this.stats = { evaluations: 0, decisions: 0, actionsOk: 0, actionsRejected: 0 };
    }

    isAttached() { return this._unsubs.length > 0; }

    // 让订阅状态与会话状态一致：running → 订阅；其他 → 取消订阅
    sync() {
        if (this.game.isHuntRunning()) this._attach(); else this._detach();
    }

    _attach() {
        if (this.isAttached()) return;
        const bus = this.game.bus;
        this._unsubs = [
            bus.on('battle_completed', (e) => this._onBattleCompleted(e)),
            bus.on('battle_started', (e) => this._onBattleStarted(e)),
            bus.on('pokemon_captured', (e) => this._onCaptured(e)),
            bus.on('route_changed', (e) => this._onRouteChanged(e)),
        ];
    }

    _detach() {
        for (const off of this._unsubs) off();
        this._unsubs = [];
    }

    // 会话在运行才处理；否则顺手取消订阅（例如存档被重置后残留的订阅）
    _session() {
        const s = this.game.getHuntSession();
        if (!s || s.state !== 'running') { this._detach(); return null; }
        return s;
    }

    _onBattleCompleted(e) {
        const s = this._session();
        if (!s || e.tower) return;
        if (e.result === 'victory') huntSessionRecord(s, { battles: 1, victories: 1, xp: e.xp, money: e.gold });
        else if (e.result === 'defeat') huntSessionRecord(s, { battles: 1, defeats: 1 });
        if (e.offline) return;                          // 离线结算期间只累计统计，不在批处理中途做决策
        this.evaluate('after_battle');
    }

    _onCaptured(e) {
        const s = this._session();
        if (!s) return;
        const isNew = e.firstCatch || e.newIndividual;
        huntSessionRecord(s, { captures: isNew ? 1 : 0, shinies: isNew && e.shiny ? 1 : 0 });
    }

    _onRouteChanged(e) {
        const s = this._session();
        if (s) s.routeId = e.route;
    }

    _onBattleStarted(e) {
        if (!this._session() || e.offline) return;
        this.evaluate('encounter');
    }

    _snapshot(stage) {
        const g = this.game;
        const session = g.getHuntSession();
        const snap = {
            policy: g.getAutomationPolicy(),
            stats: session.stats,
            durationMs: huntSessionDurationMs(session, g.now()),
            currentRouteId: g.gameState.currentRoute,
            activeIndex: g.gameState.activePokemonIndex,
        };
        if (stage === 'after_battle') {
            snap.routeComplete = g._isRouteCompleteByCondition(g.gameState.currentRoute);
            if (snap.routeComplete && snap.policy.route.mode === 'switchWhenComplete') {
                const next = g.findNextIncompleteRoute();
                snap.nextRouteId = next ? next.routeId : null;
            }
        } else if (stage === 'encounter') {
            const enemy = g.gameState.currentEnemy;
            snap.bestIndex = enemy && snap.policy.switchPolicy.mode === 'bestMatchup' && g.gameState.team.length > 1 ? g.getBestTeamMemberForEnemy(enemy) : -1;
        }
        return snap;
    }

    // 评估一次：快照 → 决策 → 逐个动作经调度器执行。返回执行结果列表（便于测试/调试）
    evaluate(stage) {
        if (this._evaluating || !this.game.isHuntRunning()) return [];
        this._evaluating = true;
        const results = [];
        try {
            this.stats.evaluations++;
            const decisions = decideAutomationActions(stage, this._snapshot(stage)).slice(0, AUTOMATION_MAX_ACTIONS_PER_EVALUATION);
            for (const d of decisions) {
                if (!this.game.isHuntRunning()) break;           // 前一个动作（例如停止）之后不再继续
                this.stats.decisions++;
                this.game._emit('automation_decision', { stage, action: d.action.type, reason: d.reason });
                const r = this.game.dispatchAutomationAction(d.action);
                if (r.ok) this.stats.actionsOk++; else this.stats.actionsRejected++;
                results.push(r);
            }
        } catch (err) {
            this.game._emit('automation_error', { stage, message: String(err && err.message).slice(0, 120) });
        } finally {
            this._evaluating = false;
        }
        return results;
    }
}

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
    isHuntRunning() {
        const s = this.getHuntSession();
        return !!s && s.state === 'running';
    },

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

    // 会话状态变化后调用：同步引擎订阅；战斗循环空闲时（例如暂停后恢复）开始下一场遭遇
    _automationSync() {
        if (!this._engine) this._engine = new AutomationEngine(this);
        this._engine.sync();
        if (this.isHuntRunning() && !this.battleTimer && !this.healTimer && !this._nextBattleTimeout && !this._towerMode && !this._isOfflineSimulating) {
            this.dispatchAutomationAction({ type: 'ATTACK' });
        }
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
