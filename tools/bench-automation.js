'use strict';
// Benchmark do driver rápido da automação (fase 5A).
//   node tools/bench-automation.js            # padrão: 1 / 100 / 1000 sessões de 1 h + durações + política A × B
//   node tools/bench-automation.js --quick    # versão pequena (usada nos testes)
//   node tools/bench-automation.js --json     # saída em JSON
// Cada "sessão" é uma partida nova com semente própria, caçando pelo driver rápido (sem timers reais, sem save).
const { createSimGame, getContext } = require('./automation-sim');

const MIN = 60 * 1000, HOUR = 60 * MIN;
const mb = (bytes) => Math.round(bytes / 1048576 * 10) / 10;

function runSessions(count, durationMs, opts = {}) {
    const ctx = getContext();
    if (global.gc) global.gc();
    const mem0 = process.memoryUsage();
    const t0 = process.hrtime.bigint();
    const tot = { battles: 0, victories: 0, defeats: 0, xp: 0, captures: 0, shinies: 0, money: 0, potionsUsed: 0, simulatedMs: 0, decisions: 0, actions: 0, evaluations: 0, stopped: 0 };
    let peakHeap = mem0.heapUsed;
    for (let i = 0; i < count; i++) {
        const { game } = createSimGame({ ctx, seed: (opts.seedBase || 1000) + i, policy: opts.policy || { heal: { enabled: true } }, starterLevel: opts.starterLevel || 25, routeId: opts.routeId, potions: opts.potions ?? 99999 });
        const r = ctx.simulateHunt(game, durationMs);
        for (const k of ['battles', 'victories', 'defeats', 'xp', 'captures', 'shinies', 'money', 'potionsUsed', 'simulatedMs']) tot[k] += r[k];
        if (r.state === 'stopped') tot.stopped++;
        const eng = game._engine;
        if (eng) { tot.decisions += eng.stats.decisions; tot.actions += eng.stats.actionsOk + eng.stats.actionsRejected; tot.evaluations += eng.stats.evaluations; }
        if ((i & 63) === 0) peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
        game.stopBattle();
    }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const mem1 = process.memoryUsage();
    const hours = tot.simulatedMs / HOUR;
    return {
        sessions: count,
        simulatedPerSession: durationMs,
        wallMs: Math.round(ms),
        speedup: Math.round(tot.simulatedMs / Math.max(1, ms)),               // vezes mais rápido que o tempo real
        battles: tot.battles,
        battlesPerSecond: Math.round(tot.battles / Math.max(0.001, ms / 1000)),
        actions: tot.actions,
        decisions: tot.decisions,
        evaluations: tot.evaluations,
        xpPerHour: hours > 0 ? Math.round(tot.xp / hours) : 0,                // média por sessão-hora
        capturesPerHour: hours > 0 ? Math.round(tot.captures / hours * 10) / 10 : 0,
        winRate: tot.victories + tot.defeats > 0 ? Math.round(tot.victories / (tot.victories + tot.defeats) * 1000) / 10 : 0,
        stoppedSessions: tot.stopped,
        heapUsedMB: mb(mem1.heapUsed),
        heapDeltaMB: mb(mem1.heapUsed - mem0.heapUsed),
        peakHeapMB: mb(peakHeap),
        rssMB: mb(mem1.rss),
    };
}

function runDurations(durations, opts = {}) {
    const ctx = getContext();
    return durations.map(([label, ms]) => {
        const { game } = createSimGame({ ctx, seed: 7, policy: opts.policy || { heal: { enabled: true } }, starterLevel: 30, potions: 99999 });
        const t0 = process.hrtime.bigint();
        const r = ctx.simulateHunt(game, ms);
        const wall = Number(process.hrtime.bigint() - t0) / 1e6;
        game.stopBattle();
        return { label, simulatedMs: r.simulatedMs, wallMs: Math.round(wall), battles: r.battles, xp: r.xp, captures: r.captures, efficiency: r.efficiency, stopReason: r.stopReason };
    });
}

function comparePolicies(durationMs, sessions) {
    const A = { name: 'A (captura tudo)', policy: { heal: { enabled: true } } };
    const B = { name: 'B (só qualidade ≥ 60%)', policy: { heal: { enabled: true }, capture: { minQualityPercent: 60, alwaysNewSpecies: false } } };
    return [A, B].map((p) => {
        const r = runSessions(sessions, durationMs, { policy: p.policy, seedBase: 5000 });
        return { name: p.name, captures: r.capturesPerHour, xpPerHour: r.xpPerHour, winRate: r.winRate, battles: r.battles };
    });
}

function runBenchmark(options = {}) {
    const quick = !!options.quick;
    const sessionCounts = quick ? [1, 5] : [1, 100, 1000];
    const sessionDuration = quick ? 10 * MIN : HOUR;
    const durations = quick
        ? [['10 min', 10 * MIN], ['1 h', HOUR]]
        : [['10 min', 10 * MIN], ['1 h', HOUR], ['4 h', 4 * HOUR], ['24 h', 24 * HOUR]];
    return {
        node: process.version,
        sessions: sessionCounts.map((n) => runSessions(n, sessionDuration)),
        durations: runDurations(durations),
        policies: comparePolicies(quick ? 30 * MIN : 4 * HOUR, quick ? 3 : 20),
    };
}

function print(report) {
    const line = (...a) => console.log(...a);
    line(`\n=== Benchmark da automação (Node ${report.node}) ===`);
    line('\n-- Sessões (cada uma com semente própria) --');
    for (const r of report.sessions) {
        line(`${String(r.sessions).padStart(5)} sessão(ões) × ${r.simulatedPerSession / MIN} min: ${r.wallMs} ms | ${r.battles} batalhas (${r.battlesPerSecond}/s) | avaliações ${r.evaluations} | ações ${r.actions} | XP/h ${r.xpPerHour} | capturas/h ${r.capturesPerHour} | vitórias ${r.winRate}% | heap Δ ${r.heapDeltaMB} MB (pico ${r.peakHeapMB} MB, RSS ${r.rssMB} MB) | ${r.speedup}× tempo real`);
    }
    line('\n-- Durações simuladas (uma sessão) --');
    for (const d of report.durations) line(`${d.label.padStart(7)}: ${String(d.wallMs).padStart(5)} ms | ${d.battles} batalhas | XP/h ${d.efficiency.xpPerHour} | capturas/h ${d.efficiency.capturesPerHour} | vitórias ${d.efficiency.winRate}%`);
    line('\n-- Política A × B --');
    for (const p of report.policies) line(`${p.name.padEnd(26)} capturas/h ${String(p.captures).padStart(6)} | XP/h ${String(p.xpPerHour).padStart(8)} | vitórias ${p.winRate}%`);
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const report = runBenchmark({ quick: args.includes('--quick') });
    if (args.includes('--json')) console.log(JSON.stringify(report, null, 2)); else print(report);
}

module.exports = { runBenchmark, runSessions, runDurations, comparePolicies };
