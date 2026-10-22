'use strict';
// 假时钟：控制 SaveManager 的 now / setTimer，实现可重复的防抖与备份间隔测试
function fakeClock(start = 1700000000000) {
    let now = start;
    let nextId = 0;
    const timers = new Map();
    return {
        now: () => now,
        setTimer: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, at: now + ms }); return id; },
        // Repetido (setInterval): dispara a cada `ms` e se reagenda a partir do instante em que disparou
        setRepeating: (fn, ms) => { const id = ++nextId; timers.set(id, { fn, at: now + ms, every: Math.max(1, ms) }); return id; },
        clearTimer: (id) => { timers.delete(id); },
        advance(ms) {
            const target = now + ms;
            for (;;) {
                const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
                if (!due) break;
                now = due[1].at;
                if (due[1].every) due[1].at = now + due[1].every; else timers.delete(due[0]);
                due[1].fn();
            }
            now = target;
        },
        pendingTimers: () => timers.size,
    };
}

// Troca os timers do contexto vm do jogo (setTimeout/setInterval/clear*) por um relógio falso: o teste avança o tempo à mão, sem esperar de verdade.
// Chamar DEPOIS de newGame() e ANTES de iniciar batalha/cura/offline, para que os timers nasçam no relógio falso.
function installFakeTimers(ctx, clock = fakeClock()) {
    const sb = ctx.sandbox;
    sb.setTimeout = (fn, ms = 0) => clock.setTimer(fn, ms);
    sb.setInterval = (fn, ms) => clock.setRepeating(fn, ms);
    sb.clearTimeout = clock.clearTimer;
    sb.clearInterval = clock.clearTimer;
    return clock;
}
module.exports = { fakeClock, installFakeTimers };
