// ============================================================
// 事件总线（EventBus）：自动化引擎、界面、统计、报告共用的内部事件通道。
//
//   - 多个订阅者（不像旧的 onBattleEvent 只能有一个）；订阅返回“取消订阅”函数；'*' 订阅全部。
//   - 只接受已登记的事件名（AUTOMATION_EVENT_TYPES），拼错会被拒绝并计数，而不是悄悄丢掉。
//   - 保留最近 N 条事件的环形缓冲（内存里，不进存档），供界面“重要事件”列表、报告、调试使用。
//   - 订阅者抛异常不会影响游戏，也不会影响其他订阅者（错误计数 + 可选 onError）。
//   - 事件对象只含小而干净的字段：{ seq, type, t, ...payload }；offline=true 表示来自离线结算。
//
// 旧的回调（onBattleEvent / onCatch / onLevelUp / onGuideEvent）保持不变，总线是并行的新通道。
// ============================================================
const AUTOMATION_EVENT_TYPES = [
    'hunt_started', 'hunt_stopped', 'hunt_paused', 'hunt_resumed',
    'battle_started', 'battle_completed', 'pokemon_defeated',
    'capture_attempted', 'pokemon_captured', 'capture_skipped',
    'xp_gained', 'level_up', 'evolution', 'heal', 'hp_low',
    'route_changed', 'pokemon_switched',
    'automation_decision', 'automation_error', 'action_rejected', 'policy_changed',
];

class EventBus {
    // opts: { capacity, now, onError }
    constructor(opts = {}) {
        this.capacity = opts.capacity || 200;
        this.now = opts.now || (() => Date.now());
        this.onError = opts.onError || null;
        this._subs = new Map();          // type → Set<fn>
        this._buffer = [];
        this._seq = 0;
        this._listenerCount = 0;
        this.stats = { emitted: 0, rejected: 0, subscriberErrors: 0 };
    }

    on(type, fn) {
        if (typeof fn !== 'function') throw new TypeError('EventBus.on: 需要函数');
        if (type !== '*' && !AUTOMATION_EVENT_TYPES.includes(type)) throw new Error('EventBus.on: 未知事件 ' + type);
        let set = this._subs.get(type);
        if (!set) { set = new Set(); this._subs.set(type, set); }
        if (!set.has(fn)) { set.add(fn); this._listenerCount++; }
        return () => this.off(type, fn);
    }

    once(type, fn) {
        const off = this.on(type, (ev) => { off(); fn(ev); });
        return off;
    }

    off(type, fn) {
        const set = this._subs.get(type);
        if (set && set.delete(fn)) this._listenerCount--;
    }

    hasListeners() { return this._listenerCount > 0; }

    // 发出事件。返回事件对象；未知事件名返回 null（并计数）。
    emit(type, payload, meta) {
        if (!AUTOMATION_EVENT_TYPES.includes(type)) { this.stats.rejected++; return null; }
        const ev = { seq: ++this._seq, type, t: this.now() };
        if (payload && typeof payload === 'object') Object.assign(ev, payload);
        if (meta && meta.offline) ev.offline = true;
        this.stats.emitted++;
        this._buffer.push(ev);
        if (this._buffer.length > this.capacity) this._buffer.splice(0, this._buffer.length - this.capacity);
        this._deliver(this._subs.get(type), ev);
        this._deliver(this._subs.get('*'), ev);
        return ev;
    }

    _deliver(set, ev) {
        if (!set || set.size === 0) return;
        for (const fn of [...set]) {       // 拷贝：订阅者可以在回调里取消订阅
            try { fn(ev); } catch (e) {
                this.stats.subscriberErrors++;
                if (this.onError) { try { this.onError(e, ev); } catch (e2) { /* 忽略 */ } }
            }
        }
    }

    // 最近的事件（新的在后）。filter：事件名、事件名数组或函数
    recent(limit = 50, filter) {
        let list = this._buffer;
        if (filter) {
            const types = typeof filter === 'string' ? [filter] : Array.isArray(filter) ? filter : null;
            list = list.filter(typeof filter === 'function' ? filter : (e) => types.includes(e.type));
        }
        return list.slice(-limit);
    }

    clear() { this._buffer = []; }
}
