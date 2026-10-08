// ============================================================
// 路线对比与推荐（挂在 GameCore 上的 mixin）
//   - 玩过的路线（样本 ≥ minSampleMs）用真实数据；没玩过/样本太少的用快速模拟估算，并标注"估算"。
//   - 估算在无头副本上跑（simulation.js 的 createSimulationClone），不会改动真实存档，结果带缓存。
//   - 推荐只给信息：绝不自动换路线（换路线仍是玩家/策略的决定）。
// ============================================================
const RouteCompareMethods = {
    _routeLabel(routeId) {
        for (const k in REGIONS) {
            const r = REGIONS[k].routes.find(x => x.id === routeId);
            if (r) return { name: r.name, regionName: REGIONS[k].name, levelRange: r.levelRange || null };
        }
        return null;
    },

    // 估算缓存的指纹：队伍（物种/等级分档/个体值）、升级、相关策略、徽章、天赋……任何会改变收益的东西
    _estimateFingerprint() {
        const g = this.gameState;
        const band = (lv) => Math.round(Math.log(Math.max(1, lv)) / Math.log(1.05));      // 等级按 5% 分档，升一级不会让缓存全部失效
        const party = (g.party || []).map(uid => {
            const i = this.roster.get(uid);
            return i ? [i.speciesId, band(i.level), ivTotal(i.ivs), i.nature, i.shiny ? 1 : 0] : 0;
        });
        const p = this.getAutomationPolicy();
        return JSON.stringify([party, g.activePokemonIndex, g.upgrades || {}, p.capture, p.heal, p.switchPolicy, g.settings && g.settings.autoSwitchBest,
            Object.keys(g.badges || {}), g.talents || {}, g.tower && g.tower.highestFloor, (g.gems || []).length, g.settings && g.settings.captureDuplicates, band(this.getProgressLevel())]);
    },

    // 已缓存的估算（指纹不一致或没算过 → null）；不会触发模拟
    getCachedEstimate(routeId) {
        const cache = this._routeEstimates;
        if (!cache || cache.key !== this._estimateFingerprint()) return null;
        return cache.map.get(routeId) || null;
    },

    // 估算一条路线（同步，约几十毫秒）。返回 { routeId, source:'estimated', rates, agg, simulatedMs } 或 null
    estimateRoute(routeId) {
        if (!this.gameState) return null;
        const cache = this._routeEstimates || (this._routeEstimates = { key: null, map: new Map() });
        const key = this._estimateFingerprint();
        if (cache.key !== key) { cache.key = key; cache.map.clear(); }
        if (cache.map.has(routeId)) return cache.map.get(routeId);
        const durationMs = this.getEconomyConfig().compare.estimateMs;
        const clone = createSimulationClone(this, routeId);
        let result = null;
        if (clone) {
            const r = simulateHunt(clone, durationMs);
            if (r.ok) {
                const st = clone.getHuntSession().stats;
                const agg = {
                    ms: r.simulatedMs, battles: st.battles, victories: st.victories, defeats: st.defeats, xp: st.xp, money: st.money,
                    captures: st.captures, shinies: st.shinies, potions: st.healingSpent, healCost: st.healCost, qualitySum: st.qualitySum,
                };
                result = { routeId, source: 'estimated', agg, rates: huntRates(agg, clone.getShinyRate()), simulatedMs: r.simulatedMs };
            }
        }
        cache.map.set(routeId, result);
        return result;
    },

    // 一条路线的指标：真实优先（样本够长），否则（allowEstimate 时）估算。没有数据且不允许估算 → null
    getRouteMetrics(routeId, allowEstimate = true) {
        const agg = this.getRouteAgg(routeId);
        const minMs = this.getEconomyConfig().analyzer.minSampleMs;
        if (agg && agg.ms >= minMs) return { routeId, source: 'real', agg, rates: huntRates(agg, this.getShinyRate()), simulatedMs: agg.ms, last: agg.last };
        if (allowEstimate === 'cached') return this.getCachedEstimate(routeId);        // 只用已经算好的估算，不触发新的模拟
        return allowEstimate ? this.estimateRoute(routeId) : null;
    },

    // 值得比较的候选路线：已解锁、等级合理、数量有限；当前路线和玩过的路线一定在内
    getCandidateRoutes() {
        const cfg = this.getEconomyConfig().compare;
        const levels = (this.gameState.party || []).map(uid => (this.roster.get(uid) || {}).level || 0).filter(l => l > 0);
        const avg = levels.length ? levels.reduce((a, b) => a + b, 0) / levels.length : 1;
        const lo = avg * cfg.levelBand[0], hi = avg * cfg.levelBand[1];
        const current = this.gameState.currentRoute;
        const inBand = [];
        for (const k in REGIONS) {
            if (!this.isRegionUnlocked(k)) continue;
            for (const r of REGIONS[k].routes) {
                const min = r.levelRange ? r.levelRange[0] : 0;
                if (r.id !== current && min >= lo && min <= hi) inBand.push({ id: r.id, d: Math.abs(Math.log((min + 1) / (avg + 1))) });
            }
        }
        inBand.sort((a, b) => a.d - b.d);
        const ids = [current];
        for (const c of inBand) if (ids.length < cfg.maxCandidates) ids.push(c.id);
        return ids;
    },

    // 风险提示：药水开销超过收入、胜率太低……（不阻止，只告知）
    _routeWarnings(rates) {
        const w = [];
        const cfg = this.getEconomyConfig().compare;
        if (rates.winRate < cfg.minWinRate) w.push({ code: 'low_win_rate', text: `Taxa de vitória baixa (${Math.round(rates.winRate)}%).` });
        if (rates.healCostPerHour > rates.moneyPerHour && rates.healCostPerHour > 0) w.push({ code: 'potion_burn', text: 'O custo de cura passa do dinheiro que a rota rende: você perde moedas a cada hora.' });
        else if (rates.healCostPerHour > rates.moneyPerHour * cfg.maxHealCostShare) w.push({ code: 'potion_heavy_cost', text: `As poções consomem mais de ${Math.round(cfg.maxHealCostShare * 100)}% do dinheiro que a rota rende.` });
        else if (rates.potionsPerHour > this.getPotionCapacity() * 2) w.push({ code: 'potion_heavy', text: 'Consome muitas poções por hora; o estoque acaba rápido.' });
        return w;
    },

    // 对比表。opts.estimate：true（缺的路线现场估算）/ 'cached'（只用已缓存的估算）/ false（只用真实数据）。false 时只用真实数据（没有数据的路线 rates=null，pending=true），界面用它分片估算
    compareRoutes(opts = {}) {
        const allowEstimate = opts.estimate === undefined ? true : opts.estimate;
        const ids = opts.routeIds || this.getCandidateRoutes();
        const current = this.gameState.currentRoute;
        const rows = ids.map(id => {
            const label = this._routeLabel(id);
            if (!label) return null;
            const m = this.getRouteMetrics(id, allowEstimate);
            return {
                routeId: id, ...label, current: id === current,
                source: m ? m.source : null, pending: !m, rates: m ? m.rates : null,
                warnings: m ? this._routeWarnings(m.rates) : [],
            };
        }).filter(Boolean);
        const cfg = this.getEconomyConfig().compare;
        // 可推荐 = 胜率够高 且 治疗成本撑得住（药水开销不超过收入的一定比例），否则新手会被"XP 很高但药水烧钱"的路线拖垮
        const viable = rows.filter(r => r.rates && r.rates.winRate >= cfg.minWinRate && r.rates.battlesPerHour > 0 &&
            r.rates.healCostPerHour <= r.rates.moneyPerHour * cfg.maxHealCostShare);
        const best = {};
        for (const goal of this.getEconomyConfig().analyzer.goals) {
            let top = null;
            for (const r of viable) {
                const v = goalMetric(r.rates, goal);
                if (v > 0 && (!top || v > top.value)) top = { routeId: r.routeId, value: v };
            }
            best[goal] = top;
        }
        return { goal: this.getAnalyzerGoal(), current, rows, best, pendingCount: rows.filter(r => r.pending).length };
    },

    // 按目标推荐：返回 { routeId, name, goal, gainPct, text, source } 或 { none:true, text }
    recommendRouteForGoal(goal, comparison) {
        goal = goal || this.getAnalyzerGoal();
        const cmp = comparison || this.compareRoutes();
        const cfg = this.getEconomyConfig().compare;
        const label = { xp: 'XP/h', money: 'lucro/h', captures: 'capturas/h', shiny: 'chance de Shiny/h' }[goal];
        const cur = cmp.rows.find(r => r.current);
        const curValue = cur && cur.rates ? goalMetric(cur.rates, goal) : 0;
        const top = cmp.best[goal];
        if (!top) return { none: true, goal, text: 'Ainda não há dados suficientes para recomendar uma rota.' };
        if (top.routeId === cmp.current) return { none: true, goal, current: true, routeId: top.routeId, text: `A rota atual já é a melhor para ${label}.` };
        const gainPct = curValue > 0 ? Math.round((top.value / curValue - 1) * 100) : null;
        if (gainPct !== null && gainPct < cfg.recommendMinGainPct) return { none: true, goal, current: true, routeId: cmp.current, text: `A rota atual já é a melhor para ${label}.` };
        const row = cmp.rows.find(r => r.routeId === top.routeId);
        const src = row.source === 'real' ? 'real' : 'estimado';
        const text = gainPct === null
            ? `${row.name}: rende ${label} na estimativa, enquanto a rota atual não rende nada nesse objetivo.`
            : `+${gainPct}% de ${label} ${src} em relação à rota atual.`;
        return { routeId: top.routeId, name: row.name, regionName: row.regionName, goal, gainPct, text, source: row.source, value: top.value, currentValue: curValue };
    },

    // 界面显示推荐时调用：事件限频（同一推荐 5 分钟内只发一次）
    noteRouteRecommended(rec) {
        if (!rec || rec.none) return false;
        const key = `${rec.routeId}|${rec.goal}`;
        const now = this.now();
        if (this._recNoted && this._recNoted.key === key && now - this._recNoted.t < 5 * 60000) return false;
        this._recNoted = { key, t: now };
        this._emit('route_recommended', { route: rec.routeId, goal: rec.goal, gainPct: rec.gainPct, source: rec.source });
        this._track('route_recommended', { goal: rec.goal });
        return true;
    },
};

function installRouteCompare(GameCoreClass) {
    for (const key of Object.keys(RouteCompareMethods)) GameCoreClass.prototype[key] = RouteCompareMethods[key];
}

installRouteCompare(GameCore);
