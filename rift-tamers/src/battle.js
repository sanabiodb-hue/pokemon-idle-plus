// Simulador de batalha automática em tempo contínuo (barra de ação por velocidade, estilo ATB).
// Puro e determinístico: a mesma semente produz a mesma luta. O 3D só reproduz os eventos; o modo offline roda o mesmo código sem render.
import { makeRng } from './rng.js';
import { multiEffectiveness, TYPE_STATUS } from './data.js';
import { statsOf, movesOf } from './genome.js';

export const GAUGE_RATE = 0.015;        // fração de barra por ponto de velocidade por segundo (50 de velocidade ≈ 0,75 ação/s)
export const MAX_TIME = 75;             // segundos de luta; ao estourar o tempo, o atacante (lado A) perde
export const TICK = 0.05;
export const SYNC_MAX = 100;            // medidor de Sincronia do jogador (ativado à mão: todas as criaturas agem já com energia cheia)
const OFFENSIVE = new Set(['burn', 'poison', 'slow', 'stun', 'curse']);

function makeUnit(g, side, idx, mods) {
    const s = statsOf(g, { atk: mods.dmg, hp: mods.hp, spd: mods.spd, def: mods.def });
    return { g, id: g.id, side, idx, ...s, maxHp: s.hp, energy: 0, gauge: 10 + idx * 7, status: {}, alive: true, moves: movesOf(g), dealt: 0 };
}

// teamA/teamB: arrays de genomas. opts: { seed, tide, modsA, modsB }
export function createBattle(teamA, teamB, opts = {}) {
    const modsA = { dmg: 1, hp: 1, spd: 1, def: 1, crit: 0, energy: 0, ...(opts.modsA || {}) };
    const modsB = { dmg: 1, hp: 1, spd: 1, def: 1, crit: 0, energy: 0, ...(opts.modsB || {}) };
    return {
        rng: makeRng(opts.seed ?? 1), t: 0, tide: opts.tide || null, result: null,
        mods: { A: modsA, B: modsB },
        units: [...teamA.map((g, i) => makeUnit(g, 'A', i, modsA)), ...teamB.map((g, i) => makeUnit(g, 'B', i, modsB))],
        sync: 0, syncQueued: false, actions: 0,
    };
}

export const alive = (st, side) => st.units.filter(u => u.side === side && u.alive);

export function triggerSync(st) {
    if (st.sync < SYNC_MAX || st.result) return false;
    st.sync = 0; st.syncQueued = true;
    return true;
}

function chooseMove(st, u) {
    const ult = u.moves[2], art = u.moves[1], strike = u.moves[0];
    if (u.energy >= ult.cost) return ult;
    if (u.energy >= art.cost && st.rng() < 0.65) return art;
    return strike;
}
function chooseTarget(st, u, move) {
    const foes = alive(st, u.side === 'A' ? 'B' : 'A');
    let best = null, score = -1;
    for (const f of foes) {
        const sc = multiEffectiveness(move.type, f.g.types) * (1.6 - (f.hp / f.maxHp) * 0.6) - f.idx * 0.01;
        if (sc > score) { score = sc; best = f; }
    }
    return best;
}

function act(st, u, ev) {
    const mods = st.mods[u.side];
    // efeitos contínuos no início da ação de quem os carrega
    for (const k of ['burn', 'poison']) if (u.status[k]) {
        const d = Math.max(1, Math.round(u.maxHp * 0.06));
        u.hp -= d; ev.push({ t: 'dot', at: st.t, dst: u.id, dmg: d, status: k });
        if (u.hp <= 0) { u.hp = 0; u.alive = false; ev.push({ t: 'faint', at: st.t, dst: u.id }); return; }
    }
    const tick = () => { for (const k in u.status) if (--u.status[k] <= 0) delete u.status[k]; };
    if (u.status.stun) { delete u.status.stun; ev.push({ t: 'skip', at: st.t, src: u.id }); tick(); return; }
    u.energy = Math.min(10, u.energy + 1 + (mods.energy || 0));
    const move = chooseMove(st, u);
    const target = chooseTarget(st, u, move);
    if (!target) return;
    u.energy -= move.cost;
    st.actions++;
    const hit = st.rng() < move.acc;
    if (!hit) { ev.push({ t: 'miss', at: st.t, src: u.id, dst: target.id, move: move.name, mtype: move.type, tier: move.key }); tick(); return; }
    const eff = multiEffectiveness(move.type, target.g.types);
    const stab = u.g.types.includes(move.type) ? 1.2 : 1;
    const tide = st.tide === move.type ? 1.25 : 1;
    const crit = st.rng() < 0.08 + (mods.crit || 0);
    let dmg = (move.power / 40) * u.atk * (u.atk / (u.atk + target.def)) * stab * eff * tide * (crit ? 1.5 : 1) * (0.9 + st.rng() * 0.15);
    if (target.status.guard) dmg *= 0.7;
    if (target.status.curse) dmg *= 1.25;
    dmg = Math.max(1, Math.round(dmg));
    target.hp -= dmg; u.dealt += dmg;
    if (u.side === 'A') st.sync = Math.min(SYNC_MAX, st.sync + 4 + (move.key === 'ult' ? 6 : 0));
    ev.push({ t: 'hit', at: st.t, src: u.id, dst: target.id, dmg, eff, crit, move: move.name, mtype: move.type, tier: move.key });
    if (u.status.leech) { const h = Math.round(dmg * 0.4); u.hp = Math.min(u.maxHp, u.hp + h); ev.push({ t: 'heal', at: st.t, dst: u.id, amount: h }); }
    if (move.key === 'art' && st.rng() < 0.35) {
        const s = TYPE_STATUS[move.type];
        if (OFFENSIVE.has(s)) { if (target.hp > 0) { target.status[s] = 3; ev.push({ t: 'status', at: st.t, dst: target.id, status: s }); } }
        else if (s === 'heal') { const h = Math.round(u.maxHp * 0.2); u.hp = Math.min(u.maxHp, u.hp + h); ev.push({ t: 'heal', at: st.t, dst: u.id, amount: h }); }
        else { u.status[s] = 3; ev.push({ t: 'status', at: st.t, dst: u.id, status: s }); }
    }
    if (target.hp <= 0) { target.hp = 0; target.alive = false; ev.push({ t: 'faint', at: st.t, dst: target.id, src: u.id }); }
    tick();
}

// Avança dt segundos. Devolve a lista de eventos do intervalo.
export function step(st, dt) {
    const ev = [];
    if (st.result) return ev;
    if (st.syncQueued) {
        st.syncQueued = false;
        for (const u of alive(st, 'A')) { u.gauge = 100; u.energy = Math.max(u.energy, 4); }
        ev.push({ t: 'sync', at: st.t });
    }
    // passo fixo de 0,05 s: o render (dt variável) e a simulação rápida (1 s) produzem exatamente a mesma luta
    st.acc = (st.acc || 0) + dt;
    while (st.acc >= TICK - 1e-9 && !st.result) {
        st.acc -= TICK;
        st.t = Math.round((st.t + TICK) * 1000) / 1000;
        const h = TICK;
        const ready = [];
        for (const u of st.units) if (u.alive) {
            const sp = u.spd * (u.status.haste ? 1.3 : 1) * (u.status.slow ? 0.7 : 1);
            u.gauge += sp * GAUGE_RATE * h * 100;
            if (u.gauge >= 100) ready.push(u);
        }
        ready.sort((a, b) => b.gauge - a.gauge || (a.side < b.side ? -1 : 1) || a.idx - b.idx);
        for (const u of ready) {
            if (!u.alive || st.result) continue;
            u.gauge -= 100;
            act(st, u, ev);
            if (!alive(st, 'B').length) st.result = 'A';
            else if (!alive(st, 'A').length) st.result = 'B';
        }
        if (!st.result && st.t >= MAX_TIME) { st.result = 'B'; ev.push({ t: 'timeout', at: st.t }); }
    }
    if (st.result) ev.push({ t: 'end', at: st.t, result: st.result });
    return ev;
}

// Resolve a luta inteira sem render (offline, previsões). Devolve { result, time, survivors, units }.
export function simulate(teamA, teamB, opts = {}) {
    const st = createBattle(teamA, teamB, opts);
    while (!st.result) step(st, 1);
    return { result: st.result, time: st.t, survivorsA: alive(st, 'A').length, units: st.units, actions: st.actions };
}
