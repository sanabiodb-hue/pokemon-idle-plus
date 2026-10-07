// 自动化 · 决策（纯函数）：输入一份"局面快照"，输出要执行的动作列表。不读写游戏状态、不消耗随机数、
// 不依赖时间/界面——所以同一份快照永远得到同一个决定，也可以原样搬到服务器或模拟器里跑。
//
// 阶段（stage）：
//   after_battle  一场战斗结束后（胜利/失败）：检查停止条件、路线策略
//   encounter     新遭遇开始时：按换人策略选出战宝可梦
// 快照字段（按阶段需要）：
//   policy, stats（会话累计）, durationMs, routeComplete, nextRouteId, currentRouteId, bestIndex, activeIndex
// 返回 [{ action: {type, ...}, reason }]，最多一个"停止"动作，停止优先于其他动作。

function decideAutomationActions(stage, snap) {
    const policy = snap && snap.policy ? snap.policy : null;
    if (!policy) return [];
    if (stage === 'after_battle') return _decideAfterBattle(policy, snap);
    if (stage === 'encounter') return _decideEncounter(policy, snap);
    return [];
}

function _decideAfterBattle(policy, snap) {
    const stop = (reason) => [{ action: { type: 'STOP_HUNT', reason }, reason }];
    const sc = policy.stopConditions;
    const stats = snap.stats || {};
    if (sc.maxBattles > 0 && (stats.battles || 0) >= sc.maxBattles) return stop('max_battles');
    if (sc.maxMinutes > 0 && (snap.durationMs || 0) >= sc.maxMinutes * 60000) return stop('max_minutes');

    if (snap.routeComplete) {
        const mode = policy.route.mode;
        if (mode === 'stop') return stop('route_complete');
        if (mode === 'switchWhenComplete') {
            if (snap.nextRouteId && snap.nextRouteId !== snap.currentRouteId) {
                return [{ action: { type: 'CHANGE_ROUTE', routeId: snap.nextRouteId }, reason: 'route_complete' }];
            }
            return stop('route_complete');                  // 没有下一条未完成的路线了
        }
    }
    return [];
}

function _decideEncounter(policy, snap) {
    if (policy.switchPolicy.mode !== 'bestMatchup') return [];
    const best = snap.bestIndex;
    if (!Number.isInteger(best) || best < 0 || best === snap.activeIndex) return [];
    return [{ action: { type: 'SWITCH_POKEMON', index: best, reason: 'best_matchup' }, reason: 'best_matchup' }];
}
