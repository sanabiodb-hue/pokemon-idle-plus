// 自动化 · 狩猎会话（HuntSession）：一次"开始狩猎 → 结束"的运行记录与累计统计。
// 纯数据 + 纯函数（时间由调用方传入），可直接放进存档；不存逐场日志，只存累计数字。
//
//   状态：idle → running ⇄ paused → stopped（人工/条件终止）| finished（正常跑完，例如目标达成）
//   只有 running 时才累计统计与时长；stopped/finished 之后任何记录都被忽略。

const HUNT_SESSION_STATES = ['idle', 'running', 'paused', 'stopped', 'finished'];
const HUNT_STOP_REASONS = ['manual', 'no_potions', 'party_fainted', 'max_battles', 'max_minutes', 'route_complete', 'invalid_policy', 'error'];
const HUNT_SESSION_TRANSITIONS = {
    idle: ['running', 'stopped'],
    running: ['paused', 'stopped', 'finished'],
    paused: ['running', 'stopped'],
    stopped: [],
    finished: [],
};
const HUNT_STAT_KEYS = ['battles', 'victories', 'defeats', 'captures', 'shinies', 'xp', 'money', 'healingSpent'];

function createHuntSessionStats() {
    const s = {};
    for (const k of HUNT_STAT_KEYS) s[k] = 0;
    return s;
}

// info: { id, now, routeId, policy, partyUids }
function createHuntSession(info) {
    return {
        id: String(info.id),
        state: 'idle',
        stopReason: null,
        routeId: info.routeId,
        policy: info.policy,                                  // 开始时的快照；会话期间改策略不影响已记录的 policy
        partyUids: Array.isArray(info.partyUids) ? info.partyUids.slice(0, 6) : [],
        createdAt: info.now,
        startedAt: null,
        endedAt: null,
        activeMs: 0,                                          // 已累计的运行时长（不含暂停）
        resumedAt: null,                                      // 最近一次进入 running 的时间
        stats: createHuntSessionStats(),
    };
}

function huntSessionCanTransition(session, to) {
    return !!session && HUNT_SESSION_TRANSITIONS[session.state] && HUNT_SESSION_TRANSITIONS[session.state].includes(to);
}

function huntSessionDurationMs(session, now) {
    if (!session) return 0;
    const live = session.state === 'running' && session.resumedAt !== null ? Math.max(0, now - session.resumedAt) : 0;
    return session.activeMs + live;
}

// 返回 true=已迁移；非法迁移返回 false 且不改任何字段
function huntSessionTransition(session, to, now, reason) {
    if (!huntSessionCanTransition(session, to)) return false;
    if (to === 'running') {
        if (session.startedAt === null) session.startedAt = now;
        session.resumedAt = now;
    } else {
        // 离开 running：把这段运行时长并入 activeMs
        if (session.state === 'running') session.activeMs = huntSessionDurationMs(session, now);
        session.resumedAt = null;
        if (to === 'stopped' || to === 'finished') {
            session.endedAt = now;
            session.stopReason = HUNT_STOP_REASONS.includes(reason) ? reason : (to === 'finished' ? null : 'manual');
        }
    }
    session.state = to;
    return true;
}

// 累计统计：只在 running 时生效。amounts 里只认已知键，非法数字忽略。返回是否记录
function huntSessionRecord(session, amounts) {
    if (!session || session.state !== 'running' || !_isObj(amounts)) return false;
    for (const k of HUNT_STAT_KEYS) {
        const v = amounts[k];
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) session.stats[k] += v;
    }
    return true;
}

// 存档清洗：任何东西进来都得到合法会话或 null。读档时 running 一律降为 paused（不会悄悄自己继续跑）
function sanitizeHuntSession(raw) {
    if (!_isObj(raw) || !HUNT_SESSION_STATES.includes(raw.state)) return null;
    const policyResult = sanitizeAutomationPolicy(raw.policy);
    const state = raw.state === 'running' ? 'paused' : raw.state;
    const out = {
        id: typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.id) ? raw.id : 'h0',
        state,
        stopReason: HUNT_STOP_REASONS.includes(raw.stopReason) ? raw.stopReason : null,
        routeId: typeof raw.routeId === 'string' && /^[a-z0-9_]{1,64}$/.test(raw.routeId) ? raw.routeId : null,
        policy: policyResult,
        partyUids: Array.isArray(raw.partyUids) ? raw.partyUids.filter(u => typeof u === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(u)).slice(0, 6) : [],
        createdAt: _num(raw.createdAt, 0, 0),
        startedAt: raw.startedAt === null || raw.startedAt === undefined ? null : _num(raw.startedAt, 0, null),
        endedAt: raw.endedAt === null || raw.endedAt === undefined ? null : _num(raw.endedAt, 0, null),
        activeMs: _num(raw.activeMs, 0, 0),
        resumedAt: null,
        stats: createHuntSessionStats(),
    };
    if (_isObj(raw.stats)) for (const k of HUNT_STAT_KEYS) out.stats[k] = _num(raw.stats[k], 0, 0);
    // 关机期间的时间不算运行时长：running 降为 paused 时只保留已并入 activeMs 的部分
    if (out.routeId === null) return null;
    return out;
}
