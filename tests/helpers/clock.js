'use strict';
// 假时钟：控制 SaveManager 的 now / setTimer，实现可重复的防抖与备份间隔测试
function fakeClock(start = 1700000000000) {
    let now = start;
    let nextId = 0;
    const timers = new Map();
    return {
        now: () => now,
        setTimer: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, at: now + ms }); return id; },
        clearTimer: (id) => { timers.delete(id); },
        advance(ms) {
            const target = now + ms;
            for (;;) {
                const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                now = due[1].at;
                timers.delete(due[0]);
                due[1].fn();
            }
            now = target;
        },
        pendingTimers: () => timers.size,
    };
}
module.exports = { fakeClock };
