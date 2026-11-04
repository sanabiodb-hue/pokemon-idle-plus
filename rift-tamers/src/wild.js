// Batalha clássica por turnos contra criatura selvagem (Mapa de Caça): Lutar / Orbe / Trocar / Fugir.
// Pura e determinística pela semente. Cada ação devolve uma lista de passos para a interface animar em ordem.
import { makeRng } from './rng.js';
import { multiEffectiveness, TYPE_INFO } from './data.js';
import { statsOf, movesOf, RARITY_INDEX, displayName } from './genome.js';

export const PP = { strike: Infinity, art: 12, ult: 4 };
const RARITY_CATCH = [1, 0.7, 0.45, 0.26, 0.14];

function unit(g, mods, hpFrac = 1) {
    const st = statsOf(g, mods || {});
    const moves = movesOf(g).map(m => ({ ...m, pp: PP[m.key], maxPp: PP[m.key] }));
    return { g, ...st, maxHp: st.hp, hp: Math.max(0, Math.round(st.hp * hpFrac)), moves, status: null };
}

// team: genomas do jogador; hp: { id: fração } persistente durante a caçada; wild: genoma selvagem
export function startWild(team, wild, opts = {}) {
    const mine = team.map(g => unit(g, opts.mods, opts.hp && opts.hp[g.id] !== undefined ? opts.hp[g.id] : 1));
    const active = Math.max(0, mine.findIndex(u => u.hp > 0));
    return {
        rng: makeRng(opts.seed ?? 1), mine, active, foe: unit(wild, opts.foeMods), over: null, turn: 0, tide: opts.tide || null, orbs: opts.orbs ?? 0,
        orbBonus: opts.orbBonus || 1, runs: 0,
    };
}
export const activeUnit = (st) => st.mine[st.active];

function damage(st, a, d, move) {
    const eff = multiEffectiveness(move.type, d.g.types);
    const stab = a.g.types.includes(move.type) ? 1.2 : 1, tide = st.tide === move.type ? 1.25 : 1;
    const crit = st.rng() < 0.0625;
    let dmg = (move.power / 40) * a.atk * (a.atk / (a.atk + d.def)) * stab * eff * tide * (crit ? 1.5 : 1) * (0.88 + st.rng() * 0.17);
    return { dmg: Math.max(1, Math.round(dmg)), eff, crit };
}
const effText = (eff) => eff >= 2 ? 'É super efetivo!' : eff < 1 ? 'Não é muito efetivo…' : null;

function useMove(st, side, move, out) {
    const a = side === 'me' ? activeUnit(st) : st.foe, d = side === 'me' ? st.foe : activeUnit(st);
    const who = side === 'me' ? displayName(a.g) : displayName(a.g) + ' selvagem';
    if (move.pp !== Infinity) move.pp--;
    out.push({ t: 'text', msg: `${who} usou ${move.name}!` });
    if (a.status === 'stun' && st.rng() < 0.4) { out.push({ t: 'text', msg: `${who} está paralisado e não se move!` }); return; }
    if (st.rng() > move.acc) { out.push({ t: 'miss', side, msg: 'O ataque errou!' }); return; }
    const r = damage(st, a, d, move);
    d.hp = Math.max(0, d.hp - r.dmg);
    out.push({ t: 'hit', side, dmg: r.dmg, eff: r.eff, crit: r.crit, tier: move.key, mtype: move.type, hp: d.hp, maxHp: d.maxHp });
    if (r.crit) out.push({ t: 'text', msg: 'Um golpe crítico!' });
    const e = effText(r.eff); if (e) out.push({ t: 'text', msg: e });
    if (move.key === 'art' && !d.status && d.hp > 0 && st.rng() < 0.3) {
        const s = { ember: 'burn', venom: 'poison', volt: 'stun' }[move.type];
        if (s) { d.status = s; out.push({ t: 'status', side: side === 'me' ? 'foe' : 'me', status: s, msg: `${side === 'me' ? displayName(d.g) + ' selvagem' : displayName(d.g)} ficou ${{ burn: 'queimado', poison: 'envenenado', stun: 'paralisado' }[s]}!` }); }
    }
}
function endOfTurn(st, out) {
    for (const [u, side] of [[activeUnit(st), 'me'], [st.foe, 'foe']]) {
        if (u.hp > 0 && (u.status === 'burn' || u.status === 'poison')) {
            const d = Math.max(1, Math.round(u.maxHp / 16)); u.hp = Math.max(0, u.hp - d);
            out.push({ t: 'dot', side, dmg: d, hp: u.hp, maxHp: u.maxHp, msg: `${displayName(u.g)} sofre com ${u.status === 'burn' ? 'a queimadura' : 'o veneno'}!` });
        }
    }
}
function checkFaints(st, out) {
    if (st.foe.hp <= 0 && !st.over) { out.push({ t: 'faint', side: 'foe', msg: `${displayName(st.foe.g)} selvagem desmaiou!` }); st.over = 'win'; return; }
    const me = activeUnit(st);
    if (me.hp <= 0) {
        out.push({ t: 'faint', side: 'me', msg: `${displayName(me.g)} desmaiou!` });
        const next = st.mine.findIndex(u => u.hp > 0);
        if (next < 0) { st.over = 'lose'; out.push({ t: 'text', msg: 'Todas as suas criaturas desmaiaram… você corre de volta ao cristal de cura.' }); }
        else { st.active = next; out.push({ t: 'switch', idx: next, msg: `Vai, ${displayName(st.mine[next].g)}!` }); }
    }
}
function foeMove(st) {
    const ms = st.foe.moves.filter(m => m.pp > 0);
    const w = ms.map(m => (m.key === 'ult' ? 0.5 : m.key === 'art' ? 1.2 : 1) * (1 + multiEffectiveness(m.type, activeUnit(st).g.types) * 0.5));
    let x = st.rng() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ms.length; i++) { x -= w[i]; if (x <= 0) return ms[i]; }
    return ms[0];
}

export function captureChance(st, ballMult = 1) {
    const f = st.foe, rar = RARITY_CATCH[RARITY_INDEX[f.g.rarity]] ?? 0.2;
    let a = (1 - (2 / 3) * (f.hp / f.maxHp)) * rar * ballMult * st.orbBonus * (f.status ? 1.5 : 1) * (f.g.alpha ? 0.6 : 1);
    return Math.min(1, Math.max(0.02, a));
}

// action: { type: 'move', i } | { type: 'orb' } | { type: 'switch', i } | { type: 'run' }
export function act(st, action) {
    const out = [];
    if (st.over) return out;
    st.turn++;
    const me = activeUnit(st);
    if (action.type === 'run') {
        const p = Math.min(1, 0.55 + (me.spd / Math.max(1, st.foe.spd)) * 0.3 + st.runs * 0.15); st.runs++;
        if (st.rng() < p || !st.foe.g.alpha && st.rng() < 0.3) { out.push({ t: 'text', msg: 'Você fugiu em segurança!' }); st.over = 'run'; return out; }
        out.push({ t: 'text', msg: 'Não deu para fugir!' });
    } else if (action.type === 'orb') {
        if (st.orbs <= 0) { out.push({ t: 'text', msg: 'Você não tem orbes!' }); st.turn--; return out; }
        st.orbs--;
        out.push({ t: 'throw', msg: 'Você lançou um Orbe da Fenda!' });
        const p = captureChance(st), shakeP = Math.pow(p, 1 / 3);
        let shakes = 0;
        while (shakes < 3 && st.rng() < shakeP) shakes++;
        for (let i = 0; i < Math.min(shakes, 3); i++) out.push({ t: 'shake', n: i + 1 });
        if (shakes >= 3) { out.push({ t: 'caught', msg: `Peguei! ${displayName(st.foe.g)} foi capturado!` }); st.over = 'caught'; return out; }
        out.push({ t: 'breakfree', msg: ['Ah, não! Escapou!', 'Quase! Estava tão perto!', 'Argh! Quase pegou!'][Math.min(2, shakes)] });
    } else if (action.type === 'switch') {
        if (action.i === st.active || !st.mine[action.i] || st.mine[action.i].hp <= 0) { st.turn--; return out; }
        out.push({ t: 'recall', msg: `Volte, ${displayName(me.g)}!` });
        st.active = action.i;
        out.push({ t: 'switch', idx: action.i, msg: `Vai, ${displayName(activeUnit(st).g)}!` });
    } else if (action.type === 'move') {
        const move = me.moves[action.i];
        if (!move || move.pp <= 0) { out.push({ t: 'text', msg: 'Sem PP para esse golpe!' }); st.turn--; return out; }
        const foeM = foeMove(st);
        const meFirst = me.spd * (me.status === 'stun' ? 0.5 : 1) >= st.foe.spd * (st.foe.status === 'stun' ? 0.5 : 1);
        const order = meFirst ? [['me', move], ['foe', foeM]] : [['foe', foeM], ['me', move]];
        for (const [side, m] of order) {
            useMove(st, side, m, out); checkFaints(st, out);
            if (st.over || (side === 'foe' && activeUnit(st) !== me)) break;
        }
        if (!st.over) { endOfTurn(st, out); checkFaints(st, out); }
        return out;
    }
    // ações sem golpe (fuga falha, orbe, troca): o selvagem ataca
    if (!st.over) { useMove(st, 'foe', foeMove(st), out); checkFaints(st, out); if (!st.over) { endOfTurn(st, out); checkFaints(st, out); } }
    return out;
}
export { TYPE_INFO };
