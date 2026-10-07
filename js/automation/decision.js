// 自动化 · 决策（纯函数）：输入一份"局面快照"，输出要执行的动作列表。不读写游戏状态、不消耗随机数、
// 不依赖时间/界面——所以同一份快照永远得到同一个决定，也可以原样搬到服务器或模拟器里跑。
//
// 阶段（stage）：
//   after_battle  一场战斗结束后（胜利/失败）：停止条件、（倒下时的）治疗、路线策略
//   hp_low        出战宝可梦血量落到阈值以下 / 胜利回血结算之后：治疗或"没药水则停"
//   encounter     新遭遇开始时：按换人策略选出战宝可梦
// 快照字段（按阶段需要）：
//   policy, stats（会话累计）, durationMs, routeComplete, nextRouteId, currentRouteId,
//   bestIndex, activeIndex, hpPercent（0–100）, fainted, potions
// 返回 [{ action: {type, ...}, reason }]；"停止"动作优先，且一次评估里停止之后不再有别的动作。

function decideAutomationActions(stage, snap) {
    const policy = snap && snap.policy ? snap.policy : null;
    if (!policy) return [];
    if (stage === 'after_battle') return _decideAfterBattle(policy, snap);
    if (stage === 'hp_low') return _decideHeal(policy, snap);
    if (stage === 'encounter') return _decideEncounter(policy, snap);
    return [];
}

const _stop = (reason) => [{ action: { type: 'STOP_HUNT', reason }, reason }];

// 血量低于阈值 → 有药水就治疗，没有就按 onNoPotions 处理（目前只有 stop）
function _decideHeal(policy, snap) {
    const heal = policy.heal;
    if (!heal.enabled) return [];
    const hp = Number.isFinite(snap.hpPercent) ? snap.hpPercent : 100;
    if (!snap.fainted && hp >= heal.whenHpBelowPercent) return [];
    if ((snap.potions || 0) > 0) return [{ action: { type: 'HEAL' }, reason: 'hp_below_threshold' }];
    return _stop('no_potions');
}

function _decideAfterBattle(policy, snap) {
    const sc = policy.stopConditions;
    const stats = snap.stats || {};
    if (sc.battleLimit > 0 && (stats.battles || 0) >= sc.battleLimit) return _stop('battle_limit');
    if (sc.timeLimitMinutes > 0 && (snap.durationMs || 0) >= sc.timeLimitMinutes * 60000) return _stop('time_limit');

    const mode = policy.route.mode;
    const routeDone = !!snap.routeComplete;
    if (routeDone && (mode === 'stopWhenComplete' || sc.routeComplete)) return _stop('route_complete');

    const out = [];
    if (snap.fainted) {
        const heal = _decideHeal(policy, snap);
        if (heal.length && heal[0].action.type === 'STOP_HUNT') return heal;
        out.push(...heal);
    }
    if (routeDone && mode === 'switchWhenComplete') {
        if (snap.nextRouteId && snap.nextRouteId !== snap.currentRouteId) {
            out.push({ action: { type: 'CHANGE_ROUTE', routeId: snap.nextRouteId }, reason: 'route_complete' });
        } else {
            return _stop('route_complete');                 // 没有下一条未完成的路线了
        }
    }
    return out;
}

function _decideEncounter(policy, snap) {
    if (policy.switchPolicy.mode !== 'bestMatchup') return [];
    const best = snap.bestIndex;
    if (!Number.isInteger(best) || best < 0 || best === snap.activeIndex) return [];
    return [{ action: { type: 'SWITCH_POKEMON', index: best, reason: 'best_matchup' }, reason: 'best_matchup' }];
}
