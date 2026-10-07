// ============================================================
// 时钟（Clock）：把“现在几点”和“稍后做某事”从全局 Date / setTimeout 里抽出来。
//
//   SystemClock  真实时间（默认；行为与直接用 Date.now / setTimeout 完全一样）
//   ManualClock  手动推进的模拟时钟：advance(ms) 会按时间顺序触发到期的计时器。
//                用于测试和“自动化模拟器”——同样的状态 + 同样的策略 + 同样的种子 = 同样的结果，且不需要等真实时间。
//
// 接口：now() / setTimer(fn, ms) → id / clearTimer(id)
// ============================================================
class SystemClock {
    now() { return Date.now(); }
    setTimer(fn, ms) { return setTimeout(fn, ms); }
    clearTimer(id) { clearTimeout(id); }
}

class ManualClock {
    constructor(start = 0) {
        this._now = start;
        this._nextId = 0;
        this._timers = new Map();        // id → { fn, at }
    }
    now() { return this._now; }
    setTimer(fn, ms) {
        const id = ++this._nextId;
        this._timers.set(id, { fn, at: this._now + Math.max(0, ms) });
        return id;
    }
    clearTimer(id) { this._timers.delete(id); }
    pendingTimers() { return this._timers.size; }

    // 推进 ms 毫秒：按到期时间（同一时刻按创建顺序）依次触发计时器；回调里新建的计时器如果也在窗口内，同样会被触发
    advance(ms) {
        const target = this._now + Math.max(0, ms);
        for (;;) {
            let dueId = null, due = null;
            for (const [id, t] of this._timers) {
                if (t.at <= target && (due === null || t.at < due.at)) { dueId = id; due = t; }
            }
            if (dueId === null) break;
            this._timers.delete(dueId);
            this._now = due.at;
            due.fn();
        }
        this._now = target;
        return this._now;
    }

    // 直接把时间设到某个时刻（不触发计时器，仅用于构造测试场景）
    set(ts) { this._now = ts; }
}

// 模拟时钟：快速驱动/模拟器专用。时间只会随"模拟出来的战斗时长"前进，和真实时间无关，
// 所以 24 小时的狩猎也能在毫秒内跑完，且同一个种子永远得到同一个时间线。
class SimulationClock extends ManualClock {
    // 距离起点已经过去多久
    elapsed(since) { return this._now - since; }
}
