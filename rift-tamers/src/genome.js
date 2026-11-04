// Genoma das criaturas: cada uma é única, gerada de forma determinística por uma semente.
// O genoma define aparência 3D (corpo, membros, cores, padrões), tipos, potenciais e golpes.
import { makeRng } from './rng.js';
import { TYPES, TYPE_INFO, MOVE_TEMPLATES, MOVE_NAMES } from './data.js';

export const BODIES = ['orb', 'quad', 'serpent', 'biped', 'avian', 'crystal'];
export const BODY_INFO = {
    orb: { name: 'Esférico', base: { hp: 1.1, atk: 0.9, def: 1.0, spd: 1.0 }, suffix: ['lin', 'pu', 'mori'] },
    quad: { name: 'Quadrúpede', base: { hp: 1.05, atk: 1.1, def: 1.0, spd: 0.95 }, suffix: ['dor', 'rax', 'fang'] },
    serpent: { name: 'Serpente', base: { hp: 0.95, atk: 1.05, def: 0.9, spd: 1.15 }, suffix: ['ssa', 'ryn', 'coil'] },
    biped: { name: 'Bípede', base: { hp: 1.0, atk: 1.15, def: 0.95, spd: 1.0 }, suffix: ['kar', 'tor', 'gon'] },
    avian: { name: 'Alado', base: { hp: 0.9, atk: 1.0, def: 0.85, spd: 1.3 }, suffix: ['wing', 'ptyx', 'ira'] },
    crystal: { name: 'Cristalino', base: { hp: 1.0, atk: 0.95, def: 1.3, spd: 0.8 }, suffix: ['lith', 'gem', 'quartz'] },
};
const TYPE_PREFIX = {
    ember: 'Pyr', tide: 'Aqu', bloom: 'Flor', volt: 'Zap', frost: 'Cryo', stone: 'Terr', gale: 'Zeph', umbra: 'Nox', lumen: 'Lux', venom: 'Tox',
};

export const RARITIES = [
    { id: 'common', name: 'Comum', mult: 1.0, color: '#a7b4c8', weight: 600 },
    { id: 'rare', name: 'Raro', mult: 1.18, color: '#4fb3ff', weight: 260 },
    { id: 'epic', name: 'Épico', mult: 1.4, color: '#b36bff', weight: 105 },
    { id: 'legendary', name: 'Lendário', mult: 1.7, color: '#ffb347', weight: 30 },
    { id: 'mythic', name: 'Mítico', mult: 2.1, color: '#ff4fa3', weight: 5 },
];
export const RARITY_INDEX = Object.fromEntries(RARITIES.map((r, i) => [r.id, i]));
export const PRISMATIC_RATE = 1 / 512;          // mutação "prismática" (o nosso shiny): +25% em tudo e brilho iridescente
export const MAX_LEVEL = 5000;

// Evolução: a criatura muda de forma (tamanho, chifres, espinhos, asas, halo) e de nome nos níveis 30 e 90.
export const EVO_LEVELS = [30, 90];
export const EVO_MULT = [1, 1.12, 1.28];
export function evoStage(g) { return g.level >= EVO_LEVELS[1] ? 2 : g.level >= EVO_LEVELS[0] ? 1 : 0; }
export function formName(body, type, stage) {
    if (!stage) return speciesName(body, type);
    const r = makeRng('form:' + body + ':' + type + ':' + stage), sx = BODY_INFO[body].suffix;
    return stage === 1 ? TYPE_PREFIX[type] + r.pick(['a', 'o', 'e', 'i']) + r.pick(sx) : TYPE_PREFIX[type] + r.pick(['ar', 'on', 'ex', 'yr']) + r.pick(sx) + r.pick(['', 'is', 'ion']);
}
export function speciesKey(g) { return g.body + ':' + g.types[0]; }
export function speciesName(body, type) {
    const r = makeRng('sp:' + body + ':' + type);
    return TYPE_PREFIX[type] + r.pick(BODY_INFO[body].suffix);
}
export const ALL_SPECIES = BODIES.flatMap(b => TYPES.map(t => b + ':' + t));

function rollRarity(rng, luck = 0) {
    const ws = RARITIES.map((r, i) => r.weight * (i === 0 ? 1 : 1 + luck * i));
    let x = rng() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ws.length; i++) { x -= ws[i]; if (x <= 0) return RARITIES[i].id; }
    return 'common';
}

let _uid = 0;
export function newId(rng) { return 'c' + Date.now().toString(36) + (++_uid).toString(36) + Math.floor(rng() * 1e6).toString(36); }

// Gera um genoma novo. opts: { type, body, rarity, level, luck, prismaticRate, seed }
export function createGenome(seed, opts = {}) {
    const rng = makeRng(seed);
    const type = opts.type || rng.pick(TYPES);
    const body = opts.body || rng.pick(BODIES);
    const second = rng.chance(0.35) ? rng.pick(TYPES.filter(t => t !== type)) : null;
    const rarity = opts.rarity || rollRarity(rng, opts.luck || 0);
    const prismatic = rng.chance(opts.prismaticRate ?? PRISMATIC_RATE);
    const hue = (TYPE_INFO[type].hue + rng.range(-18, 18) + 360) % 360;
    const hue2 = second ? TYPE_INFO[second].hue : (hue + rng.pick([30, 150, 180, 210])) % 360;
    const g = {
        id: opts.id || newId(rng),
        seed: typeof seed === 'string' ? seed : String(seed),
        species: body + ':' + type,
        name: speciesName(body, type),
        nick: null,
        types: second ? [type, second] : [type],
        body, rarity, prismatic,
        gen: opts.gen || 0,
        level: opts.level || 1, xp: 0,
        pot: { hp: rng.int(0, 31), atk: rng.int(0, 31), def: rng.int(0, 31), spd: rng.int(0, 31) },
        look: {
            size: rng.range(0.85, 1.2),
            legs: body === 'quad' ? 4 : body === 'biped' ? 2 : body === 'avian' ? 2 : body === 'crystal' ? rng.int(0, 3) : body === 'orb' ? rng.pick([0, 0, 2, 4]) : 0,
            tail: rng.int(0, 4), wings: body === 'avian' ? 2 : rng.chance(0.15) ? 2 : 0,
            horns: rng.int(0, 3), eyes: rng.pick([1, 2, 2, 2, 3]), crest: rng.chance(0.4),
            hue, hue2, sat: rng.range(0.55, 0.9), light: rng.range(0.45, 0.6),
            pattern: rng.pick(['solid', 'spots', 'stripes', 'gradient', 'rings']),
            glow: rng.range(0.15, 0.6), stretch: rng.range(0.85, 1.25), spikes: rng.int(0, 5),
        },
    };
    if (opts.potMin) for (const k in g.pot) g.pot[k] = Math.max(g.pot[k], opts.potMin);
    return g;
}

export function rarityMult(g) { return RARITIES[RARITY_INDEX[g.rarity]].mult * (g.prismatic ? 1.25 : 1); }

// Atributos no nível atual. Crescimento polinomial + leve exponencial, para números de idle crescerem sem explodir.
export function statsOf(g, mods = {}) {
    const base = BODY_INFO[g.body].base, rm = rarityMult(g), L = g.level;
    const grow = (5 + L) * Math.pow(1.012, L) / 6;
    const s = (k, b) => (b * (1 + g.pot[k] / 62) * rm * grow);
    const atkM = (mods.atk || 1), hpM = (mods.hp || 1), defM = (mods.def || 1), spdM = (mods.spd || 1);
    const evo = EVO_MULT[evoStage(g)];
    return {
        hp: Math.round(s('hp', 320 * base.hp) * hpM * evo),
        atk: Math.round(s('atk', 50 * base.atk) * atkM * evo),
        def: Math.round(s('def', 50 * base.def) * defM * evo),
        spd: Math.round((50 * base.spd * (1 + g.pot.spd / 62) * (g.prismatic ? 1.1 : 1) + Math.min(L, 200) * 0.15) * spdM),
    };
}
export function power(g, mods) { const s = statsOf(g, mods); return Math.round(s.hp / 3 + s.atk + s.def * 0.8 + s.spd * 0.6); }

export function movesOf(g) {
    const out = [];
    MOVE_TEMPLATES.forEach((m, i) => {
        const type = i === 1 && g.types[1] ? g.types[1] : g.types[0];
        out.push({ ...m, type, name: MOVE_NAMES[type][i] });
    });
    return out;
}

export function xpToNext(level) { return Math.floor(20 * Math.pow(level, 1.55) + 30); }
export function addXp(g, amount) {
    let ups = 0; const evo0 = evoStage(g);
    g.xp += amount;
    while (g.level < MAX_LEVEL && g.xp >= xpToNext(g.level)) { g.xp -= xpToNext(g.level); g.level++; ups++; }
    if (g.level >= MAX_LEVEL) g.xp = 0;
    if (evoStage(g) > evo0) g.evolved = evoStage(g);       // marca para o jogo anunciar a evolução
    return ups;
}

// Fusão genética: dois genomas viram um terceiro, herdando genes de cada um, com chance de mutação.
// A raridade sobe um degrau se os pais forem da mesma raridade (60%) ; o potencial herdado é o maior de cada par, mais uma variação.
export function fuse(a, b, seed) {
    const rng = makeRng(seed);
    const pick = (x, y) => (rng() < 0.5 ? x : y);
    const ra = RARITY_INDEX[a.rarity], rb = RARITY_INDEX[b.rarity];
    let ri = Math.max(ra, rb);
    if (ra === rb && ri < RARITIES.length - 1 && rng.chance(0.6)) ri++;
    const type = pick(a.types[0], b.types[0]);
    const other = [...a.types, ...b.types].filter(t => t !== type);
    const second = other.length && rng.chance(0.7) ? rng.pick(other) : null;
    const body = pick(a.body, b.body);
    const child = createGenome(seed, { type, body, rarity: RARITIES[ri].id, gen: Math.max(a.gen, b.gen) + 1, prismaticRate: (a.prismatic || b.prismatic) ? 0.12 : PRISMATIC_RATE * 4 });
    child.types = second ? [type, second] : [type];
    child.species = body + ':' + type;
    child.name = speciesName(body, type);
    for (const k of ['hp', 'atk', 'def', 'spd']) child.pot[k] = Math.min(31, Math.max(a.pot[k], b.pot[k]) + rng.int(-2, 4));
    const la = a.look, lb = b.look;
    for (const k of Object.keys(child.look)) child.look[k] = rng.chance(0.12) ? child.look[k] : pick(la[k], lb[k]);   // 12% de mutação por gene visual
    child.level = Math.max(1, Math.floor((a.level + b.level) / 4));
    child.mutated = rng.chance(0.1);
    if (child.mutated) { child.look.glow = Math.min(1, child.look.glow + 0.3); child.look.spikes = Math.min(7, child.look.spikes + 2); const k = rng.pick(['hp', 'atk', 'def', 'spd']); child.pot[k] = 31; }
    return child;
}

export function displayName(g) { return g.nick || formName(g.body, g.types[0], evoStage(g)); }
