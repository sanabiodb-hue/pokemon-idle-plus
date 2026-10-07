// ============================================================
// 狩猎分析器（Hunt Analyzer）：把 HuntSession 的累计数字变成"每小时"指标、历史和按路线的累计。
//   - 只存聚合：最近 20 次狩猎 + 每条路线一行累计数字（有上限），永远不存逐场事件。
//   - 界面渲染只读这些聚合，不会重算几十万条事件。
//   - 路线对比 / 目标推荐在 route-compare.js（F6.5）。
// 数据流：HuntSession.stats →（切路线/暂停/结束时 flush）→ analyzer.routes[路线] 累计；结束时再写一条 history。
// ============================================================
const ANALYZER_ROUTE_KEYS = ['ms', 'battles', 'victories', 'defeats', 'xp', 'money', 'captures', 'shinies', 'potions', 'healCost', 'qualitySum'];

function emptyRouteAgg() {
    const o = {};
    for (const k of ANALYZER_ROUTE_KEYS) o[k] = 0;
    o.last = 0;
    return o;
}

// 把累计数字换算成每小时指标。shinyRate（可选）用来算"期望闪光/小时"（真实闪光样本太少，目标=闪光时用期望值）
function huntRates(agg, shinyRate) {
    const hours = agg.ms > 0 ? agg.ms / 3600000 : 0;
    const per = (v) => (hours > 0 ? v / hours : 0);
    const decided = agg.victories + agg.defeats;
    const battlesPerHour = per(agg.battles);
    return {
        sampleMs: agg.ms,
        battlesPerHour,
        victoriesPerHour: per(agg.victories),
        xpPerHour: per(agg.xp),
        moneyPerHour: per(agg.money),
        capturesPerHour: per(agg.captures),
        shiniesPerHour: per(agg.shinies),
        expectedShiniesPerHour: Number.isFinite(shinyRate) ? battlesPerHour * shinyRate : per(agg.shinies),
        potionsPerHour: per(agg.potions),
        healCostPerHour: per(agg.healCost),
        operationCostPerHour: per(agg.healCost),         // 目前运营成本 = 治疗成本；以后加入其他消耗
        profitPerHour: per(agg.money - agg.healCost),
        winRate: decided > 0 ? agg.victories / decided * 100 : 0,
        captureRate: agg.victories > 0 ? agg.captures / agg.victories * 100 : 0,
        avgBattleMs: agg.battles > 0 ? agg.ms / agg.battles : 0,
        avgQuality: agg.captures > 0 ? agg.qualitySum / agg.captures : 0,
    };
}

// 目标 → 用来比较的指标
function goalMetric(rates, goal) {
    switch (goal) {
        case 'money': return rates.profitPerHour;
        case 'captures': return rates.capturesPerHour;
        case 'shiny': return rates.expectedShiniesPerHour;
        default: return rates.xpPerHour;
    }
}

function _cleanAgg(raw) {
    const out = emptyRouteAgg();
    if (!_isObj(raw)) return out;
    for (const k of ANALYZER_ROUTE_KEYS) out[k] = _num(raw[k], 0, 0);
    out.last = _num(raw.last, 0, 0);
    return out;
}

// 存档清洗：任何输入都得到合法结构；路线 id 必须是已存在的路线
function sanitizeAnalyzerState(raw) {
    const cfg = ECONOMY_CONFIG.analyzer;
    const out = { goal: cfg.defaultGoal, history: [], routes: {}, mark: null };
    if (!_isObj(raw)) return out;
    if (cfg.goals.includes(raw.goal)) out.goal = raw.goal;
    const validRoute = (id) => {
        if (typeof id !== 'string' || !/^[a-z0-9_]{1,64}$/.test(id)) return false;
        for (const k in REGIONS) if (REGIONS[k].routes.some(r => r.id === id)) return true;   // 只认真实存在的路线
        return false;
    };
    if (Array.isArray(raw.history)) {
        for (const h of raw.history.slice(-cfg.historyMax)) {
            if (!_isObj(h) || !validRoute(h.routeId)) continue;
            const rec = { routeId: h.routeId, startedAt: _num(h.startedAt, 0, 0), endedAt: _num(h.endedAt, 0, 0), stopReason: typeof h.stopReason === 'string' ? h.stopReason.slice(0, 20) : null };
            for (const k of ANALYZER_ROUTE_KEYS) rec[k] = _num(h[k], 0, 0);
            out.history.push(rec);
        }
    }
    if (_isObj(raw.routes)) {
        const ids = Object.keys(raw.routes).filter(validRoute)
            .sort((a, b) => _num(raw.routes[b] && raw.routes[b].last, 0, 0) - _num(raw.routes[a] && raw.routes[a].last, 0, 0))
            .slice(0, cfg.routesMax);
        for (const id of ids) out.routes[id] = _cleanAgg(raw.routes[id]);
    }
    if (_isObj(raw.mark) && validRoute(raw.mark.routeId) && typeof raw.mark.sessionId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.mark.sessionId)) {
        const stats = {};
        for (const k of HUNT_STAT_KEYS) stats[k] = _num(_isObj(raw.mark.stats) ? raw.mark.stats[k] : 0, 0, 0);
        out.mark = { sessionId: raw.mark.sessionId, routeId: raw.mark.routeId, stats, ms: _num(raw.mark.ms, 0, 0) };
    }
    return out;
}

const AnalyzerMethods = {
    ensureAnalyzer() {
        const gs = this.gameState;
        if (!gs) return null;
        if (!_isObj(gs.analyzer)) gs.analyzer = sanitizeAnalyzerState(null);
        return gs.analyzer;
    },

    // ---------- 目标 ----------
    getAnalyzerGoal() {
        const a = this.gameState && this.gameState.analyzer;
        return a && ECONOMY_CONFIG.analyzer.goals.includes(a.goal) ? a.goal : this.getEconomyConfig().analyzer.defaultGoal;
    },

    setAnalyzerGoal(goal) {
        if (!this.getEconomyConfig().analyzer.goals.includes(goal)) return { ok: false, code: 'invalid_goal' };
        this.ensureAnalyzer().goal = goal;
        this.save();
        return { ok: true, goal };
    },

    // 打开分析面板（界面调用）：事件/统计限频，避免刷屏
    noteAnalyzerOpened() {
        const now = this.now();
        if (this._analyzerOpenedAt && now - this._analyzerOpenedAt < 60000) return false;
        this._analyzerOpenedAt = now;
        this._emit('analyzer_opened', { goal: this.getAnalyzerGoal() });
        this._track('analyzer_opened', { goal: this.getAnalyzerGoal() });
        return true;
    },

    // ---------- 采集：flush / 标记 ----------
    analyzerBegin(session) {
        const a = this.ensureAnalyzer();
        a.mark = { sessionId: session.id, routeId: session.routeId, stats: { ...session.stats }, ms: huntSessionDurationMs(session, this.now()) };
    },

    analyzerMarkRoute(routeId) {
        const a = this.gameState && this.gameState.analyzer;
        if (a && a.mark) a.mark.routeId = routeId;
    },

    // 把"上次标记之后"的增量记到标记所在的路线上，然后推进标记。会话不一致时什么都不做（不会重复记账）
    analyzerFlush() {
        const a = this.gameState && this.gameState.analyzer;
        const s = this.getHuntSession();
        if (!a || !a.mark || !s || a.mark.sessionId !== s.id) return null;
        const delta = {};
        for (const k of HUNT_STAT_KEYS) delta[k] = Math.max(0, s.stats[k] - (a.mark.stats[k] || 0));
        const ms = Math.max(0, huntSessionDurationMs(s, this.now()) - a.mark.ms);
        a.mark.stats = { ...s.stats };
        a.mark.ms += ms;
        if (ms <= 0 && delta.battles <= 0) return null;
        const routeId = a.mark.routeId;
        const agg = _has(a.routes, routeId) ? a.routes[routeId] : (a.routes[routeId] = emptyRouteAgg());
        agg.ms += ms;
        agg.battles += delta.battles; agg.victories += delta.victories; agg.defeats += delta.defeats;
        agg.xp += delta.xp; agg.money += delta.money; agg.captures += delta.captures; agg.shinies += delta.shinies;
        agg.potions += delta.healingSpent; agg.healCost += delta.healCost; agg.qualitySum += delta.qualitySum;
        agg.last = this.now();
        const ids = Object.keys(a.routes);
        const max = this.getEconomyConfig().analyzer.routesMax;
        if (ids.length > max) {
            ids.sort((x, y) => a.routes[x].last - a.routes[y].last);
            for (const id of ids.slice(0, ids.length - max)) delete a.routes[id];
        }
        return { routeId, ms, delta };
    },

    // 狩猎结束：最后一次 flush + 写入历史（最多 20 条）+ hunt_completed（因条件结束时）
    analyzerFinish(session) {
        this.analyzerFlush();
        const a = this.ensureAnalyzer();
        const rec = { routeId: session.routeId, startedAt: session.startedAt || 0, endedAt: session.endedAt || this.now(), stopReason: session.stopReason, ms: session.activeMs };
        rec.battles = session.stats.battles; rec.victories = session.stats.victories; rec.defeats = session.stats.defeats;
        rec.xp = session.stats.xp; rec.money = session.stats.money; rec.captures = session.stats.captures; rec.shinies = session.stats.shinies;
        rec.potions = session.stats.healingSpent; rec.healCost = session.stats.healCost; rec.qualitySum = session.stats.qualitySum;
        a.history.push(rec);
        const max = this.getEconomyConfig().analyzer.historyMax;
        if (a.history.length > max) a.history.splice(0, a.history.length - max);
        a.mark = null;
        if (huntStoppedByCondition(session)) {
            this._emit('hunt_completed', { id: session.id, route: rec.routeId, reason: session.stopReason, durationMs: rec.ms, battles: rec.battles, xp: rec.xp, money: rec.money, captures: rec.captures });
            this._track('hunt_completed', { reason: session.stopReason, minutes: Math.round(rec.ms / 60000), battles: rec.battles });
        }
        return rec;
    },

    // ---------- 读取（界面只读这些）----------
    getHuntHistory() {
        const a = this.gameState && this.gameState.analyzer;
        return a ? a.history.slice().reverse() : [];               // 最新的在前
    },

    // 当前（或最近一次）狩猎的指标
    getHuntAnalysis() {
        const s = this.getHuntSession();
        if (!s) return null;
        const dur = huntSessionDurationMs(s, this.now());
        const agg = {
            ms: dur, battles: s.stats.battles, victories: s.stats.victories, defeats: s.stats.defeats, xp: s.stats.xp, money: s.stats.money,
            captures: s.stats.captures, shinies: s.stats.shinies, potions: s.stats.healingSpent, healCost: s.stats.healCost, qualitySum: s.stats.qualitySum,
        };
        return { sessionId: s.id, state: s.state, routeId: s.routeId, rates: huntRates(agg, this.getShinyRate()), totals: agg };
    },

    // 某条路线的累计（包含正在进行的、尚未 flush 的那一段），没有数据返回 null
    getRouteAgg(routeId) {
        const a = this.gameState && this.gameState.analyzer;
        const base = a && _has(a.routes, routeId) ? { ...a.routes[routeId] } : null;
        const s = this.getHuntSession();
        if (a && a.mark && s && a.mark.sessionId === s.id && a.mark.routeId === routeId && (s.state === 'running' || s.state === 'paused')) {
            const out = base || emptyRouteAgg();
            const d = (k) => Math.max(0, s.stats[k] - (a.mark.stats[k] || 0));
            out.ms += Math.max(0, huntSessionDurationMs(s, this.now()) - a.mark.ms);
            out.battles += d('battles'); out.victories += d('victories'); out.defeats += d('defeats'); out.xp += d('xp'); out.money += d('money');
            out.captures += d('captures'); out.shinies += d('shinies'); out.potions += d('healingSpent'); out.healCost += d('healCost'); out.qualitySum += d('qualitySum');
            return out;
        }
        return base;
    },

    getRouteRates(routeId) {
        const agg = this.getRouteAgg(routeId);
        return agg ? huntRates(agg, this.getShinyRate()) : null;
    },
};

function installAnalyzer(GameCoreClass) {
    for (const key of Object.keys(AnalyzerMethods)) GameCoreClass.prototype[key] = AnalyzerMethods[key];
}

installAnalyzer(GameCore);
