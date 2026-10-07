// ============================================================
// 测试期统计（Analytics）：一层很小的事件记录，用来衡量第一批玩家的真实行为
//
// 设计原则
//   - 不依赖 DOM / 游戏状态，所有外部能力（存储、时钟、gtag、sendBeacon）都由构造参数注入，所以能在 Node 里完整测试。
//   - 隐私：不记录任何个人信息；事件参数只允许短字符串/数字/布尔；玩家可以在设置里关闭；
//     浏览器开启 Do Not Track 时默认关闭（玩家手动打开则以玩家为准）。
//   - 本地优先：事件先进入本地环形缓冲（localStorage，最多 ANALYTICS_QUEUE_MAX 条），
//     再按需转发给 gtag（项目里已有的 Google Analytics）和/或自定义 endpoint。
//     没有后端也能用：设置里的“复制测试报告”会导出漏斗摘要（getSummary）。
//   - 不放进存档：统计属于“这台设备/这次安装”，导入别人的存档不应改变它。
//
// 事件（name → 何时触发）
//   game_open        页面加载（带 returning / days_since_first / sessions）
//   session_start    一次会话开始     session_end 会话结束（隐藏页面/关闭，带 duration_s、last_step、battles、captures）
//   first_action     这次安装第一次操作（点击/触摸/按键）
//   first_capture    第一次捕获到初始伙伴以外的新物种
//   battle_start     每次会话的第一场战斗（以及这次安装的第一场）
//   battle_complete  这次安装的第一场胜利，之后每 25 场一次（精确次数在 counters.battles）
//   level_up         出战队伍成员升级（只记 ≤Lv10 或 5 的倍数，避免刷屏）
//   evolution        每次进化
//   pc_open          打开 PC（每次会话第一次，以及这次安装的第一次）
//   route_unlock     解锁新地区
//   shiny_found      发现闪光
//   以及补充事件：capture（新物种）、route_change、onboarding_step、onboarding_skip、goal_complete、offline_return
// ============================================================
const ANALYTICS_STORAGE_KEY = 'pokemon_idle_analytics';
const ANALYTICS_QUEUE_MAX = 300;
const ANALYTICS_SESSION_GAP_MS = 30 * 60 * 1000;   // 离开超过 30 分钟再回来算新一次会话
const ANALYTICS_BATCH_SIZE = 20;                   // 攒够这么多条未发送事件就 flush 一次
// 转发给页面里已有的 gtag（Google Analytics）。注意：index.html 里的测量 ID 是项目原作者的，
// 发布自己的版本前请换成自己的 ID，或把它设为 false。
const ANALYTICS_GTAG_SINK = true;
// 自定义收集地址（留空 = 不发送）。事件以 JSON 数组 POST 过去（sendBeacon）。
const ANALYTICS_ENDPOINT = '';

const ANALYTICS_EVENT_NAMES = [
    'game_open', 'session_start', 'session_end', 'first_action', 'first_capture',
    'battle_start', 'battle_complete', 'level_up', 'evolution', 'pc_open', 'route_unlock', 'shiny_found',
    'capture', 'route_change', 'onboarding_step', 'onboarding_skip', 'goal_complete', 'offline_return',
];

// 会话中“走到哪一步”的先后顺序，用来标记放弃点（last_step）
const ANALYTICS_FUNNEL = ['game_open', 'first_action', 'battle_start', 'battle_complete', 'first_capture', 'pc_open', 'evolution'];

function _analyticsDay(ts) {
    return new Date(ts).toISOString().slice(0, 10);
}

function _analyticsCleanProps(props) {
    const out = {};
    if (!props || typeof props !== 'object') return out;
    let n = 0;
    for (const k of Object.keys(props)) {
        if (n >= 10) break;
        if (!/^[a-z][a-z0-9_]{0,31}$/.test(k)) continue;
        const v = props[k];
        if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100;
        else if (typeof v === 'boolean') out[k] = v;
        else if (typeof v === 'string') out[k] = v.replace(/[\p{Cc}\p{Cf}<>"'`\\]/gu, '').slice(0, 40);
        else continue;
        n++;
    }
    return out;
}

function _analyticsRandomId(rng) {
    let s = '';
    for (let i = 0; i < 12; i++) s += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(rng() * 36)];
    return s;
}

class Analytics {
    // deps：{ storage, now, rng, gtag, beacon, endpoint, doNotTrack, gtagSink }
    constructor(deps = {}) {
        this.storage = deps.storage || null;
        this.now = deps.now || Date.now;
        this.rng = deps.rng || Math.random;
        this.gtag = typeof deps.gtag === 'function' ? deps.gtag : null;
        this.beacon = typeof deps.beacon === 'function' ? deps.beacon : null;
        this.endpoint = deps.endpoint !== undefined ? deps.endpoint : ANALYTICS_ENDPOINT;
        this.gtagSink = deps.gtagSink !== undefined ? deps.gtagSink : ANALYTICS_GTAG_SINK;
        this.doNotTrack = !!deps.doNotTrack;
        this.sessionId = 0;
        this._visibleSince = null;
        this._hiddenAt = null;
        this._sessionActiveMs = 0;
        this._sessionStats = { battles: 0, captures: 0 };
        this._sessionOnce = new Set();
        this._sent = 0;                 // queue 里已经发送给 endpoint 的条数
        this.state = this._load();
    }

    // ---------- 存储 ----------
    _fresh() {
        return {
            v: 1, installId: _analyticsRandomId(this.rng), createdAt: this.now(), enabled: null,
            sessions: 0, lastSessionAt: 0, days: [], firsts: {}, lastStep: null,
            counters: { battles: 0, captures: 0, duplicates: 0, levelUps: 0, evolutions: 0, shinies: 0, sessionMs: 0, pcOpens: 0 },
            queue: [],
        };
    }

    _load() {
        const base = this._fresh();
        try {
            const raw = this.storage && this.storage.getItem(ANALYTICS_STORAGE_KEY);
            if (!raw) return base;
            const d = JSON.parse(raw);
            if (!d || typeof d !== 'object' || d.v !== 1) return base;
            const st = { ...base, ...d, counters: { ...base.counters, ...(d.counters || {}) } };
            if (!Array.isArray(st.queue)) st.queue = [];
            if (!Array.isArray(st.days)) st.days = [];
            if (!st.firsts || typeof st.firsts !== 'object') st.firsts = {};
            if (typeof st.installId !== 'string' || !/^[a-z0-9]{6,16}$/.test(st.installId)) st.installId = base.installId;
            st.queue = st.queue.slice(-ANALYTICS_QUEUE_MAX);
            return st;
        } catch (e) {
            return base;
        }
    }

    _save() {
        try { if (this.storage) this.storage.setItem(ANALYTICS_STORAGE_KEY, JSON.stringify(this.state)); } catch (e) { /* 配额/隐私模式：统计丢了不影响游戏 */ }
    }

    // ---------- 开关 ----------
    isEnabled() {
        if (this.state.enabled === true) return true;
        if (this.state.enabled === false) return false;
        return !this.doNotTrack;       // 玩家没表态：跟随浏览器的 Do Not Track
    }

    setEnabled(on) {
        this.state.enabled = !!on;
        if (!on) { this.state.queue = []; this._sent = 0; }
        this._save();
    }

    // ---------- 记录 ----------
    track(name, props, ts) {
        if (!this.isEnabled() || !ANALYTICS_EVENT_NAMES.includes(name)) return false;
        const clean = _analyticsCleanProps(props);
        const ev = { n: name, t: ts || this.now(), s: this.sessionId };
        if (Object.keys(clean).length) ev.p = clean;
        const st = this.state;
        st.queue.push(ev);
        if (st.queue.length > ANALYTICS_QUEUE_MAX) {
            const drop = st.queue.length - ANALYTICS_QUEUE_MAX;
            st.queue.splice(0, drop);
            this._sent = Math.max(0, this._sent - drop);
        }
        if (!st.firsts[name]) st.firsts[name] = ev.t;     // 每种事件第一次出现的时间（漏斗用）
        const rank = ANALYTICS_FUNNEL.indexOf(name);
        if (rank !== -1 && rank >= ANALYTICS_FUNNEL.indexOf(st.lastStep)) st.lastStep = name;
        if (this.gtag && this.gtagSink) {
            try { this.gtag('event', name, clean); } catch (e) { /* 忽略 */ }
        }
        this._save();
        if (st.queue.length - this._sent >= ANALYTICS_BATCH_SIZE) this.flush();
        return true;
    }

    // 这次安装只记一次（first_*）
    once(name, props) {
        if (this.state.firsts[name]) return false;
        if (!this.track(name, props)) return false;
        this.state.firsts[name] = this.now();
        this._save();
        return true;
    }

    // 每次会话只记一次；这次安装的第一次带 first_ever=true
    oncePerSession(name, props) {
        if (this._sessionOnce.has(name)) return false;
        this._sessionOnce.add(name);
        const first = !this.state.firsts[name];
        const ok = this.track(name, { ...(props || {}), first_ever: first });
        if (ok && first) { this.state.firsts[name] = this.now(); this._save(); }
        return ok;
    }

    // 计数器：精确次数永远准确（不受事件节流影响）。落盘在下一次 track / 隐藏 / 结束时一起做，避免每场战斗写一次
    count(key, n = 1) {
        if (!this.isEnabled() || !(key in this.state.counters)) return;
        this.state.counters[key] += n;
        if (key === 'battles') this._sessionStats.battles += n;
        if (key === 'captures') this._sessionStats.captures += n;
        this._dirty = true;
    }

    // ---------- 会话 ----------
    // 页面加载时调用。上一次会话没有正常结束（手机直接杀掉页面）时，先补记它的 session_end。
    startSession(extra) {
        const now = this.now();
        const st = this.state;
        if (st.open) this._closeOpen('recovered');
        const returning = st.sessions > 0;
        const sinceLastH = st.lastSessionAt ? (now - st.lastSessionAt) / 3600000 : 0;
        const firstDay = _analyticsDay(st.createdAt);
        const today = _analyticsDay(now);
        const daysSinceFirst = Math.round((Date.parse(today) - Date.parse(firstDay)) / 86400000);
        st.sessions++;
        st.lastSessionAt = now;
        if (!st.days.includes(today)) st.days.push(today);
        if (st.days.length > 90) st.days.splice(0, st.days.length - 90);
        this.sessionId = st.sessions;
        this._visibleSince = now;
        this._hiddenAt = null;
        this._sessionActiveMs = 0;
        this._sessionStats = { battles: 0, captures: 0 };
        this._sessionOnce = new Set();
        st.open = { id: this.sessionId, activeMs: 0, seen: now, battles: 0, captures: 0 };
        this._save();
        const info = {
            returning, sessions: st.sessions, days_since_first: daysSinceFirst,
            hours_since_last: Math.round(sinceLastH * 10) / 10, ...(extra || {}),
        };
        this.track('game_open', info);
        this.track('session_start', { n: st.sessions });
        return info;
    }

    // 记录“会话还开着”的最新状态，崩溃/被杀后下次启动可以据此补记结束
    _touchOpen() {
        const st = this.state;
        if (!st.open) return;
        const now = this.now();
        const live = this._visibleSince !== null ? now - this._visibleSince : 0;
        st.open.activeMs = this._sessionActiveMs + live;
        st.open.seen = now;
        st.open.battles = this._sessionStats.battles;
        st.open.captures = this._sessionStats.captures;
    }

    _emitEnd(reason, activeMs, battles, captures, ts) {
        this.state.counters.sessionMs += activeMs;
        this.track('session_end', {
            duration_s: Math.round(activeMs / 1000), reason,
            last_step: this.state.lastStep || 'none', battles, captures,
        }, ts);
    }

    _closeOpen(reason) {
        const o = this.state.open;
        if (!o) return;
        this._emitEnd(reason, o.activeMs, o.battles, o.captures, o.seen);
        this.state.open = null;
        this._save();
    }

    endSession(reason) {
        if (!this.sessionId || !this.state.open) return;
        const now = this.now();
        if (this._visibleSince !== null) { this._sessionActiveMs += now - this._visibleSince; this._visibleSince = null; }
        this._emitEnd(reason || 'close', this._sessionActiveMs, this._sessionStats.battles, this._sessionStats.captures);
        this.state.open = null;
        this.state.lastSessionAt = now;
        this._sessionActiveMs = 0;
        this._sessionStats = { battles: 0, captures: 0 };
        this._save();
        this.flush();
    }

    // 页面切到后台：暂停计时并落盘（不立刻结束会话——切回来很常见）
    onHidden() {
        if (!this.sessionId || this._hiddenAt !== null || !this.state.open) return;
        const now = this.now();
        if (this._visibleSince !== null) { this._sessionActiveMs += now - this._visibleSince; this._visibleSince = null; }
        this._hiddenAt = now;
        this._touchOpen();
        this._save();
        this.flush();
    }

    // 回到前台：离开不到 30 分钟继续同一次会话；否则先结束旧会话，再开新会话
    onVisible(extra) {
        if (this._hiddenAt === null) return null;
        const away = this.now() - this._hiddenAt;
        const hiddenAt = this._hiddenAt;
        this._hiddenAt = null;
        if (away < ANALYTICS_SESSION_GAP_MS) { this._visibleSince = this.now(); return null; }
        this._emitEnd('timeout', this._sessionActiveMs, this._sessionStats.battles, this._sessionStats.captures, hiddenAt);
        this.state.open = null;
        return this.startSession(extra);
    }

    // ---------- 发送 ----------
    flush() {
        if (this._dirty) { this._dirty = false; this._touchOpen(); this._save(); }
        if (!this.endpoint || !this.isEnabled()) return false;
        const pending = this.state.queue.slice(this._sent);
        if (!pending.length) return false;
        const body = JSON.stringify({ id: this.state.installId, events: pending });
        try {
            const send = this.beacon || (typeof navigator !== 'undefined' && navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null);
            if (!send) return false;
            if (send(this.endpoint, body) === false) return false;
            this._sent = this.state.queue.length;
            return true;
        } catch (e) {
            return false;
        }
    }

    // ---------- 指标摘要（供“复制测试报告”和后续分析使用）----------
    getSummary() {
        const st = this.state;
        const at = (k) => (st.firsts[k] ? Math.round((st.firsts[k] - st.createdAt) / 1000) : null);
        const firstDay = _analyticsDay(st.createdAt);
        const d1 = _analyticsDay(Date.parse(firstDay) + 86400000);
        const ended = st.queue.filter(e => e.n === 'session_end');
        const dropoffs = {};
        for (const e of ended) { const k = (e.p && e.p.last_step) || 'none'; dropoffs[k] = (dropoffs[k] || 0) + 1; }
        return {
            installId: st.installId,
            enabled: this.isEnabled(),
            firstOpenDay: firstDay,
            sessions: st.sessions,
            daysPlayed: st.days.length,
            returnedNextDay: st.days.includes(d1),
            avgSessionSeconds: st.sessions ? Math.round(st.counters.sessionMs / 1000 / Math.max(1, ended.length || st.sessions)) : 0,
            totalPlaySeconds: Math.round(st.counters.sessionMs / 1000),
            // 距离第一次打开多少秒才到达各个里程碑（null = 还没到）
            secondsToFirst: {
                action: at('first_action'), battle: at('battle_start'), battleComplete: at('battle_complete'),
                capture: at('first_capture'), pc: at('pc_open'), evolution: at('evolution'),
            },
            counters: { ...st.counters, sessionMs: undefined },
            lastStep: st.lastStep,
            sessionEndsByLastStep: dropoffs,
        };
    }

    reset() {
        this.state = this._fresh();
        this._sent = 0;
        this._save();
    }
}
