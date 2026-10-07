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
        this._shinyFound = false;                       // 击败过闪光，等下一次评估时按 stopConditions.shinyFound 处理
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
            bus.on('pokemon_defeated', (e) => { if (e.shiny) this._shinyFound = true; }),
            bus.on('hp_low', (e) => this._onHpLow(e)),
            bus.on('heal', (e) => this._onHeal(e)),
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
        if (e.offline && !this.game._fastSim) return;   // 非快速驱动的离线事件只累计统计
        this.evaluate('after_battle', { fainted: e.result === 'defeat' });
    }

    _onHpLow(e) {
        if (!this._session() || (e.offline && !this.game._fastSim)) return;
        this.evaluate('hp_low');
    }

    _onHeal(e) {
        const s = this._session();
        if (s && e.potion) huntSessionRecord(s, { healingSpent: 1 });
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

    _snapshot(stage, extra) {
        const g = this.game;
        const session = g.getHuntSession();
        const snap = {
            policy: g.getAutomationPolicy(),
            stats: session.stats,
            durationMs: huntSessionDurationMs(session, g.now()),
            currentRouteId: g.gameState.currentRoute,
            activeIndex: g.gameState.activePokemonIndex,
            potions: g.getPotions(),
            fainted: !!(extra && extra.fainted),
            shinyFound: this._shinyFound,
        };
        const fast = g._fastSim;
        const b = g.currentBattle;
        if (fast) snap.hpPercent = fast.playerStats.hp > 0 ? Math.max(0, fast.playerHp) / fast.playerStats.hp * 100 : 100;
        else snap.hpPercent = b && b.playerMaxHp > 0 ? b.playerCurrentHp / b.playerMaxHp * 100 : 100;
        if (stage === 'after_battle') {
            snap.routeComplete = g._isRouteCompleteByCondition(g.gameState.currentRoute);
            if (snap.routeComplete && snap.policy.route.mode === 'switchWhenComplete') {
                const next = g.findNextIncompleteRoute();
                snap.nextRouteId = next ? next.routeId : null;
            }
        } else if (stage === 'encounter') {
            const enemy = fast ? fast.wild : g.gameState.currentEnemy;
            const cache = fast ? { teamStats: fast.cachedTeamStats, teamLevels: fast.cachedTeamLevels } : null;
            snap.bestIndex = enemy && snap.policy.switchPolicy.mode === 'bestMatchup' && g.gameState.team.length > 1 ? g.getBestTeamMemberForEnemy(enemy, cache) : -1;
        }
        return snap;
    }

    // 执行动作：快速驱动里需要"战斗现场"的动作（治疗/换人）由核心的快速执行器处理，其余统一走 ActionDispatcher
    _execute(action) {
        if (this.game._fastSim) {
            const r = this.game._fastExecute(action);
            if (r) return r;
        }
        return this.game.dispatchAutomationAction(action);
    }

    // 评估一次：快照 → 决策 → 逐个动作经调度器执行。返回执行结果列表（便于测试/调试）
    evaluate(stage, extra) {
        if (this._evaluating || !this.game.isHuntRunning()) return [];
        this._evaluating = true;
        const results = [];
        try {
            this.stats.evaluations++;
            const decisions = decideAutomationActions(stage, this._snapshot(stage, extra)).slice(0, AUTOMATION_MAX_ACTIONS_PER_EVALUATION);
            for (const d of decisions) {
                if (!this.game.isHuntRunning()) break;           // 前一个动作（例如停止）之后不再继续
                this.stats.decisions++;
                this.game._emit('automation_decision', { stage, action: d.action.type, reason: d.reason });
                const r = this._execute(d.action);
                if (r.ok) this.stats.actionsOk++; else this.stats.actionsRejected++;
                results.push(r);
            }
        } catch (err) {
            this.game._emit('automation_error', { stage, message: String(err && err.message).slice(0, 120) });
        } finally {
            if (stage === 'after_battle') this._shinyFound = false;
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

    _getEngine() {
        if (!this._engine) this._engine = new AutomationEngine(this);
        return this._engine;
    },

    // 会话状态变化后调用：同步引擎订阅；战斗循环空闲时（例如暂停后恢复）开始下一场遭遇
    _automationSync() {
        this._getEngine().sync();
        if (this.isHuntRunning() && !this.battleTimer && !this.healTimer && !this._nextBattleTimeout && !this._towerMode && !this._isOfflineSimulating && !this._simMode) {
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
