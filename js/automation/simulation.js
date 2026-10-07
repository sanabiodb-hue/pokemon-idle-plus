// 自动化 · 模拟与报告：快速驱动的同步入口、狩猎离线报告、"下一步建议"。
// 快速驱动 = 核心的 _fastBattleStep（与在线共用伤害/经验/捕获/奖励规则），这里只负责
// 搭好模拟时钟、静默回调、汇总结果。没有任何自己的战斗规则。

// 可复现的随机数（mulberry32）：同一个种子 + 同一份初始状态 = 同一条时间线
function createSimulationRng(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// 效率指标（按"模拟出来的"时长折算成每小时）
function huntEfficiency(stats, ms) {
    const hours = ms > 0 ? ms / 3600000 : 0;
    const per = (v) => (hours > 0 ? Math.round(v / hours) : 0);
    const decided = stats.victories + stats.defeats;
    return {
        xpPerHour: per(stats.xp),
        capturesPerHour: per(stats.captures),
        battlesPerHour: per(stats.battles),
        moneyPerHour: per(stats.money),
        winRate: decided > 0 ? Math.round(stats.victories / decided * 1000) / 10 : 0,
    };
}

function _statsDiff(after, before) {
    const out = {};
    for (const k of HUNT_STAT_KEYS) out[k] = Math.max(0, (after[k] || 0) - (before[k] || 0));
    return out;
}

// 同步跑一段快速模拟（狩猎必须正在运行）。会改变传入的 game 的状态——要"假设一下"请先拿一份副本
function simulateHunt(game, durationMs) {
    const session = game.getHuntSession();
    if (!session || session.state !== 'running') return { ok: false, code: 'no_running_hunt' };
    if (!(durationMs > 0) || game._isOfflineSimulating || game._towerMode) return { ok: false, code: 'invalid_request' };

    const realClock = game.clock;
    const ownClock = !(realClock instanceof SimulationClock);
    if (ownClock) game.clock = new SimulationClock(realClock.now());
    const wasSim = game._simMode;
    game._simMode = true;                                  // 模拟期间不写存档
    game._beginOfflineSilence(durationMs);
    const before = { ...session.stats };
    const potionsBefore = game.getPotions();
    const startedAt = game.now();
    const s = game._buildFastSimState(durationMs, durationMs);
    let simulatedMs = 0;
    if (s) {
        game._fastSim = s;
        try {
            game._runFastSync(s);
        } finally {
            game._fastSim = null;
        }
        simulatedMs = s.haltedAtMs !== undefined ? s.haltedAtMs : durationMs;
    }
    game._endOfflineSilence(s ? s.battlesSimulated : 0);
    game._simMode = wasSim;
    if (ownClock) game.clock = realClock;

    const d = _statsDiff(session.stats, before);
    return {
        ok: !!s,
        requestedMs: durationMs,
        simulatedMs,
        startedAt,
        battles: d.battles, victories: d.victories, defeats: d.defeats,
        xp: d.xp, captures: d.captures, shinies: d.shinies, money: d.money,
        potionsUsed: potionsBefore - game.getPotions(),
        potionsLeft: game.getPotions(),
        routeId: game.gameState.currentRoute,
        state: session.state,
        stopReason: session.stopReason,
        stopMessage: huntStopMessage(session),
        efficiency: huntEfficiency(d, simulatedMs),
    };
}

// ---------- 离线报告 ----------
function buildHuntOfflineReport(game, session, h, simulatedMs, reportedMs) {
    if (!session) return null;
    const d = _statsDiff(session.stats, h.statsBefore);
    const info = {
        sessionId: h.sessionId,
        state: session.state,
        stopReason: session.stopReason,
        message: huntStopMessage(session),
        reasonShort: huntStopReasonShort(session),
        absenceMs: reportedMs,
        huntMs: simulatedMs,
        battles: d.battles, victories: d.victories, defeats: d.defeats,
        xp: d.xp, captures: d.captures, shinies: d.shinies, money: d.money,
        potionsUsed: Math.max(0, h.potionsBefore - game.getPotions()),
        potionsLeft: game.getPotions(),
        routeBefore: h.routeBefore,
        route: game.gameState.currentRoute,
        efficiency: huntEfficiency(d, simulatedMs),
    };
    info.nextRecommendation = recommendHuntNext(game, session, info);
    return info;
}

function recommendHuntNext(game, session, info) {
    const tips = [];
    switch (session && session.stopReason) {
        case 'no_potions':
            tips.push('Você ficou sem poções. Por enquanto, escolha uma rota mais fácil ou desligue a cura automática; a compra de poções chega em breve.');
            break;
        case 'shiny_found':
            tips.push('Você encontrou um Shiny! Confira sua equipe e a PC antes de continuar.');
            break;
        case 'route_complete': {
            const next = game.findNextIncompleteRoute();
            tips.push(next ? `Rota concluída. Que tal ir para ${next.routeName}?` : 'Todas as rotas disponíveis estão concluídas.');
            break;
        }
        case 'battle_limit':
        case 'time_limit':
            tips.push('O limite da caçada foi atingido. Inicie uma nova quando quiser.');
            break;
    }
    if (!tips.length) {
        const wr = info && info.efficiency ? info.efficiency.winRate : 100;
        if (info && info.defeats > 0 && wr < 70) tips.push('Sua equipe perdeu muitas batalhas. Considere uma rota mais fácil ou ative a cura automática.');
        else if (session && session.state === 'paused') tips.push('Retome a caçada quando quiser.');
        else tips.push('Tudo certo por aqui.');
    }
    if (info && info.potionsLeft <= 2 && session && session.stopReason !== 'no_potions' && game.getAutomationPolicy().heal.enabled) {
        tips.push('Restam poucas poções.');
    }
    return tips.join(' ');
}

// ---------- recomendação de rota ----------
// Regra simples: entre as rotas desbloqueadas ainda incompletas, a mais forte cujo nível mínimo
// ainda não passa do nível médio da equipe. Sem nenhuma assim, a primeira incompleta.
function recommendHuntRoute(game) {
    const state = game.gameState;
    const levels = (state.party || []).map(uid => (game.roster.get(uid) || {}).level || 0).filter(l => l > 0);
    if (!levels.length) return null;
    const avg = levels.reduce((a, b) => a + b, 0) / levels.length;
    let best = null;
    let firstIncomplete = null;
    for (const regionKey in REGIONS) {
        if (!game.isRegionUnlocked(regionKey)) continue;
        for (const route of REGIONS[regionKey].routes) {
            if (game._isRouteCompleteByCondition(route.id)) continue;
            if (!firstIncomplete) firstIncomplete = route;
            const min = route.levelRange ? route.levelRange[0] : 0;
            if (min <= avg && (!best || min >= (best.levelRange ? best.levelRange[0] : 0))) best = route;
        }
    }
    const route = best || firstIncomplete;
    if (!route) return null;
    return {
        routeId: route.id,
        name: route.name,
        reason: best ? 'Inimigos no nível certo para a sua equipe.' : 'Rota mais acessível ainda não concluída.',
    };
}


// ---------- 估算用的临时副本 ----------
// 复制当前存档到一个"无头"GameCore（无 Worker、不写存档、固定随机种子、模拟时钟），让它按玩家当前的
// 队伍/升级/策略在指定路线上快速狩猎。原来的游戏对象不受任何影响。路线不可用时返回 null。
function createSimulationClone(game, routeId, opts = {}) {
    const access = game._checkRouteAccess(routeId);
    if (!access.ok) return null;
    const clone = new GameCore({ headless: true });
    clone._simMode = true;
    clone.guideAutoUpdate = false;
    clone.rng = createSimulationRng(opts.seed === undefined ? 20240607 : opts.seed);
    clone.clock = new SimulationClock(game.now());
    clone.econCfg = game.econCfg || null;
    clone.gameState = JSON.parse(JSON.stringify(game.gameState));
    clone._invalidateAllCaches();
    const gs = clone.gameState;
    gs.currentRoute = routeId;
    for (const k in REGIONS) if (REGIONS[k].routes.some(r => r.id === routeId)) gs.currentRegion = k;
    gs.currentEnemy = null;
    delete gs.battleHp;
    delete gs.automation;
    delete gs.analyzer;
    gs.inventory = { potions: opts.potions || 99999 };           // 估算的是"每小时用多少药水"，不让药水耗尽中途停止
    clone.roster.reconcile();
    const policy = JSON.parse(JSON.stringify(game.getAutomationPolicy()));
    policy.route.mode = 'stay';
    policy.stopConditions = { timeLimitMinutes: 0, battleLimit: 0, shinyFound: false, routeComplete: false };
    const set = clone.setAutomationPolicy(policy);
    if (!set.ok) return null;
    const start = clone.dispatchAutomationAction({ type: 'START_HUNT' });
    return start.ok ? clone : null;
}
