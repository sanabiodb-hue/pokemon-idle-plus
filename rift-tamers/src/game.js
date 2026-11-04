// Estado e regras do jogo: estágios idle, recompensas, captura, Santuário, melhorias, fusão, expedição roguelike,
// prestígio (Colapso da Fenda), progresso offline por simulação real e save. Sem DOM e sem Three.js: testável no Node.
import { makeRng, hashStr } from './rng.js';
import { TYPES, TYPE_INFO, RELICS, TIDES } from './data.js';
import { createGenome, statsOf, power, addXp, fuse, RARITIES, RARITY_INDEX, ALL_SPECIES, speciesKey, BODIES, MAX_LEVEL } from './genome.js';
import { createBattle, simulate } from './battle.js';

export const SAVE_KEY = 'riftTamers.save.v1';
export const SAVE_VERSION = 1;
export const ZONE_LEN = 25;
export const ZONES = [
    { type: 'bloom', name: 'Bosque Bioluminescente' }, { type: 'tide', name: 'Atol Suspenso' }, { type: 'ember', name: 'Caldeira Flutuante' },
    { type: 'volt', name: 'Mesa dos Relâmpagos' }, { type: 'stone', name: 'Cânion Gravitacional' }, { type: 'frost', name: 'Agulhas de Gelo' },
    { type: 'gale', name: 'Arquipélago dos Ventos' }, { type: 'venom', name: 'Pântano Neon' }, { type: 'lumen', name: 'Santuário da Aurora' },
    { type: 'umbra', name: 'Coração da Fenda' },
];
export const ENEMY_GROWTH = 1.028;
export const BATTLE_OVERHEAD = 1.5;          // segundos entre lutas (entrada, captura), usados também na simulação offline
export const BASE_OFFLINE_HOURS = 8;
export const TIDE_PERIOD_MS = 10 * 60 * 1000;
export const COLLAPSE_MIN_STAGE = 40;
export const EXPEDITION_UNLOCK = 15;
export const EXPEDITION_FLOORS = 10;
export const KEY_PERIOD_S = 3600, MAX_KEYS = 3;

export const UPGRADES = [
    { id: 'train', name: 'Treino de Combate', desc: '+12% de ataque da equipe por nível', base: 25, growth: 1.19, max: 999 },
    { id: 'vital', name: 'Vitalidade', desc: '+12% de vida da equipe por nível', base: 20, growth: 1.19, max: 999 },
    { id: 'haste', name: 'Sinapse Rápida', desc: '+2% de velocidade por nível', base: 80, growth: 1.32, max: 30 },
    { id: 'orbs', name: 'Forja de Orbes', desc: '+1 orbe a cada 60 s por nível', base: 40, growth: 1.38, max: 25 },
    { id: 'habitat', name: 'Habitat do Santuário', desc: '+30% de produção do Santuário e +6 vagas por nível', base: 60, growth: 1.3, max: 60 },
    { id: 'lure', name: 'Isca de Fenda', desc: '+6% de sorte de raridade por nível', base: 150, growth: 1.42, max: 25 },
    { id: 'slot', name: 'Elo de Sincronia', desc: '+1 vaga na equipe (até 5)', base: 3000, growth: 40, max: 2 },
];
export const PERK_DEFS = [
    { id: 'might', name: 'Poder Ancestral', desc: '+20% de ataque e vida por nível', base: 1, growth: 1.32, max: 60 },
    { id: 'greed', name: 'Ganância Cósmica', desc: '+25% de Essência por nível', base: 1, growth: 1.3, max: 60 },
    { id: 'warp', name: 'Salto Dimensional', desc: 'Após o Colapso, começa 10 estágios à frente por nível', base: 3, growth: 1.6, max: 12 },
    { id: 'dream', name: 'Sonho Profundo', desc: '+2 h no limite offline por nível', base: 2, growth: 1.5, max: 8 },
    { id: 'luck', name: 'Estrela Guia', desc: '+10% de sorte de raridade e +25% de chance prismática por nível', base: 4, growth: 1.55, max: 10 },
    { id: 'relic', name: 'Olhar do Arqueólogo', desc: '+1 opção de relíquia na expedição por nível', base: 6, growth: 2.2, max: 2 },
    { id: 'autosync', name: 'Mente Coletiva', desc: 'Dispara a Sincronia sozinha quando o medidor enche', base: 5, growth: 1, max: 1 },
    { id: 'catcher', name: 'Mãos de Domador', desc: '+20% de chance de captura por nível', base: 2, growth: 1.45, max: 10 },
];

export const fmt = (n) => {
    if (!Number.isFinite(n)) return '∞';
    const a = Math.abs(n);
    if (a < 1000) return String(Math.floor(n));
    const u = ['K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
    let i = -1, x = a;
    while (x >= 1000 && i < u.length - 1) { x /= 1000; i++; }
    return (n < 0 ? '-' : '') + (x < 10 ? x.toFixed(2) : x < 100 ? x.toFixed(1) : Math.floor(x)) + u[i];
};
export const upgradeCost = (def, lvl) => Math.ceil(def.base * Math.pow(def.growth, lvl));

export function newState(seed = 'rift-' + Date.now()) {
    const now = Date.now();
    return {
        v: SAVE_VERSION, seed, created: now, lastTick: now, lastSave: now,
        essence: 0, dna: 0, shards: 0, orbs: 15, keys: 1, keyTimer: 0, orbTimer: 0,
        stage: 1, maxStage: 1, maxStageEver: 1, farmUntil: 0, pushTimer: 0, autoPush: true,
        creatures: [], team: [], upgrades: {}, perks: {}, dex: {}, rng: hashStr(seed),
        stats: { battles: 0, wins: 0, captures: 0, prismatics: 0, fusions: 0, collapses: 0, bestFloor: 0, playSeconds: 0, offlineSeconds: 0 },
        expedition: null, capturePolicy: 'smart', starterChosen: false, log: [],
        settings: { quality: 'high', autoSync: true, sound: false },
    };
}

export class Game {
    constructor(state) {
        this.s = state || newState();
        this.listeners = new Set();
        this._battleSeq = 0;
    }
    on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(type, data) { for (const fn of this.listeners) fn(type, data); }
    rng() { const r = makeRng(this.s.rng); this.s.rng = (this.s.rng + 0x9E3779B9 + Math.floor(r() * 1e9)) >>> 0; return r; }
    log(msg, kind = 'info') { this.s.log.unshift({ at: Date.now(), msg, kind }); if (this.s.log.length > 60) this.s.log.length = 60; this.emit('log', { msg, kind }); }

    // ---------- consultas ----------
    up(id) { return this.s.upgrades[id] || 0; }
    perk(id) { return this.s.perks[id] || 0; }
    byId(id) { return this.s.creatures.find(c => c.id === id); }
    teamGenomes() { return this.s.team.map(id => this.byId(id)).filter(Boolean); }
    teamSize() { return 3 + this.up('slot'); }
    zoneOf(stage) { return ZONES[Math.floor((stage - 1) / ZONE_LEN) % ZONES.length]; }
    zoneTier(stage) { return Math.floor((stage - 1) / (ZONE_LEN * ZONES.length)); }
    isBoss(stage) { return stage % 10 === 0; }
    tide(now = Date.now()) { return TIDES[Math.floor(now / TIDE_PERIOD_MS) % TIDES.length]; }
    tideRemaining(now = Date.now()) { return TIDE_PERIOD_MS - (now % TIDE_PERIOD_MS); }
    dexCount() { return Object.values(this.s.dex).filter(d => d.caught).length; }
    dexBonus() { const caught = Object.values(this.s.dex); return 1 + caught.filter(d => d.caught).length * 0.02 + caught.filter(d => d.prismatic).length * 0.03; }
    sanctuaryCap() { return 40 + this.up('habitat') * 6; }
    luck() { return this.up('lure') * 0.06 + this.perk('luck') * 0.1 + Math.min(1.5, this.s.stage / 400); }
    prismaticRate() { return (1 / 512) * (1 + this.perk('luck') * 0.25); }

    playerMods() {
        const dex = this.dexBonus(), might = 1 + this.perk('might') * 0.2;
        return { dmg: (1 + this.up('train') * 0.12) * dex * might, hp: (1 + this.up('vital') * 0.12) * dex * might, spd: 1 + this.up('haste') * 0.02, def: 1, crit: 0, energy: 0 };
    }
    teamPower() { const m = this.playerMods(); return this.teamGenomes().reduce((a, g) => a + power(g, { atk: m.dmg, hp: m.hp, spd: m.spd }), 0); }

    enemyLevel(stage) { return Math.max(1, Math.floor(stage * 1.05 + Math.pow(stage / 30, 1.7) * 6)); }
    essencePerWin(stage) { return Math.ceil((4 + stage * 0.6) * Math.pow(1.075, stage) * (1 + this.perk('greed') * 0.25) * (this.isBoss(stage) ? 4 : 1)); }
    xpPerWin(stage) { return Math.ceil(10 * Math.pow(this.enemyLevel(stage), 1.45) * (this.isBoss(stage) ? 3 : 1)); }

    enemiesFor(stage, seedSalt = '') {
        const zone = this.zoneOf(stage), tier = this.zoneTier(stage), lvl = this.enemyLevel(stage), boss = this.isBoss(stage);
        const r = makeRng(this.s.seed + ':st:' + stage + seedSalt);
        const tide = this.tide().type;
        const n = stage < 3 ? stage : 3;
        const out = [];
        for (let i = 0; i < n; i++) {
            const type = r() < 0.62 ? zone.type : r() < 0.4 ? tide : r.pick(TYPES);
            const isBoss = boss && i === 0;
            const g = createGenome(this.s.seed + ':e:' + stage + ':' + i + ':' + seedSalt, {
                type, level: lvl + (isBoss ? 3 : 0), luck: 0.2 + tier * 0.5 + stage / 300,
                rarity: isBoss ? RARITIES[Math.min(4, 2 + Math.floor(r() * 2) + (tier > 0 ? 1 : 0))].id : undefined,
                prismaticRate: this.prismaticRate(),
            });
            g.level = Math.min(9999, lvl + (isBoss ? 3 : 0));
            if (isBoss) g.boss = true;
            out.push(g);
        }
        return out;
    }
    // a Fenda endurece: além do nível, os inimigos ganham um multiplicador exponencial por estágio (cria as "paredes" do idle)
    enemyScale(stage) { return Math.pow(ENEMY_GROWTH, stage - 1); }
    enemyMods(stage) { const b = this.isBoss(stage), k = this.enemyScale(stage); return { hp: k * (b ? 2.2 : 1), dmg: k, spd: 1, def: 1, crit: 0, energy: 0 }; }

    // ---------- início ----------
    starterOptions() {
        return ['bloom', 'tide', 'ember'].map((t, i) => createGenome(this.s.seed + ':starter:' + i, { type: t, rarity: 'rare', level: 5, body: ['quad', 'serpent', 'biped'][i], prismaticRate: 0 }));
    }
    chooseStarter(i) {
        if (this.s.starterChosen) return null;
        const opts = this.starterOptions();
        const g = opts[i]; g.level = 5;
        const r = makeRng(this.s.seed + ':buddies');
        const buddies = [0, 1].map(k => { const b = createGenome(this.s.seed + ':buddy:' + k, { type: r.pick(TYPES.filter(t => t !== g.types[0])), rarity: 'common', level: 3, prismaticRate: 0 }); b.level = 3; return b; });
        for (const c of [g, ...buddies]) this.addCreature(c, true);
        this.s.team = [g.id, ...buddies.map(b => b.id)];
        this.s.starterChosen = true;
        this.log(`${g.name} escolheu você. A Fenda se abriu.`, 'good');
        this.emit('team');
        return g;
    }
    addCreature(g, silent = false) {
        this.s.creatures.push(g);
        const k = speciesKey(g);
        const d = this.s.dex[k] || (this.s.dex[k] = { seen: true, caught: false, prismatic: false });
        const isNew = !d.caught;
        d.caught = true; if (g.prismatic) d.prismatic = true;
        if (!silent) this.emit('capture', { g, isNew });
        this._trimSanctuary();
        return isNew;
    }
    markSeen(g) { const k = speciesKey(g); if (!this.s.dex[k]) this.s.dex[k] = { seen: true, caught: false, prismatic: false }; }

    // Santuário cheio: as criaturas mais fracas fora da equipe e sem trava viram DNA.
    _trimSanctuary() {
        const cap = this.sanctuaryCap() + this.s.team.length;
        if (this.s.creatures.length <= cap) return;
        const candidates = this.s.creatures.filter(c => !this.s.team.includes(c.id) && !c.locked).sort((a, b) => power(a) - power(b));
        while (this.s.creatures.length > cap && candidates.length) this.release(candidates.shift().id, true);
    }
    dnaValue(g) { return Math.ceil((2 + g.level * 0.5) * (1 + RARITY_INDEX[g.rarity] * 1.5) * (g.prismatic ? 10 : 1)); }
    release(id, auto = false) {
        if (this.s.team.includes(id)) return 0;
        const i = this.s.creatures.findIndex(c => c.id === id);
        if (i < 0) return 0;
        const g = this.s.creatures[i];
        if (g.locked && auto) return 0;
        this.s.creatures.splice(i, 1);
        const v = this.dnaValue(g);
        this.s.dna += v;
        if (!auto) this.emit('team');
        return v;
    }
    setTeam(ids) {
        const uniq = [...new Set(ids)].filter(id => this.byId(id)).slice(0, this.teamSize());
        if (!uniq.length) return false;
        this.s.team = uniq; this.emit('team'); return true;
    }
    toggleTeam(id) {
        const t = this.s.team;
        if (t.includes(id)) { if (t.length > 1) t.splice(t.indexOf(id), 1); }
        else if (t.length < this.teamSize()) t.push(id);
        else return false;
        this.emit('team'); return true;
    }

    // ---------- batalha de estágio ----------
    makeStageBattle(now = Date.now()) {
        const stage = this.s.stage;
        const enemies = this.enemiesFor(stage);
        for (const e of enemies) this.markSeen(e);
        const seed = (this.s.rng ^ (++this._battleSeq * 2654435761)) >>> 0;
        this.s.rng = (this.s.rng + 0x51ED27) >>> 0;
        return { stage, enemies, battle: createBattle(this.teamGenomes(), enemies, { seed, tide: this.tide(now).type, modsA: this.playerMods(), modsB: this.enemyMods(stage) }) };
    }
    // Aplica o resultado de uma luta de estágio (online ou offline). Devolve o resumo das recompensas.
    resolveStage(stage, enemies, result, opts = {}) {
        const s = this.s, out = { result, stage, essence: 0, xp: 0, captured: [], levelUps: 0 };
        s.stats.battles++;
        if (result === 'A') {
            s.stats.wins++;
            out.essence = this.essencePerWin(stage); s.essence += out.essence;
            out.xp = this.xpPerWin(stage);
            const team = this.teamGenomes(), share = Math.ceil(out.xp / Math.max(1, team.length));
            for (const g of team) out.levelUps += addXp(g, share);
            if (this.isBoss(stage)) { s.orbs += 3; if (s.keys < MAX_KEYS && stage % 50 === 0) s.keys++; }
            out.captured = this._tryCaptures(enemies, opts.silent);
            if (s.farmUntil > 0) {
                s.pushTimer += 1;
                if (s.pushTimer >= 6) { s.farmUntil = 0; s.pushTimer = 0; }
            } else if (s.autoPush) {
                s.stage = stage + 1;
            }
            if (s.stage > s.maxStage) s.maxStage = s.stage;
            if (s.maxStage > s.maxStageEver) s.maxStageEver = s.maxStage;
        } else {
            // derrota: recua um estágio e treina ali (6 vitórias) antes de tentar de novo
            s.stage = Math.max(1, stage - 1); s.farmUntil = 1; s.pushTimer = 0;
        }
        if (!opts.silent) this.emit('stage', out);
        return out;
    }
    captureChance(g) {
        const rar = [1, 0.62, 0.38, 0.2, 0.1][RARITY_INDEX[g.rarity]];
        let c = 0.22 * rar * (1 + this.perk('catcher') * 0.2) * (g.boss ? 0.5 : 1);
        if (g.prismatic) c = Math.max(c, 0.6);
        return Math.min(0.95, c);
    }
    _wantCapture(g) {
        const p = this.s.capturePolicy;
        if (p === 'none') return false;
        if (g.prismatic || g.boss) return true;
        const d = this.s.dex[speciesKey(g)];
        if (!d || !d.caught) return true;
        if (p === 'all') return true;
        // "smart": também quer raridade ≥ rara ou potencial total alto
        const potSum = g.pot.hp + g.pot.atk + g.pot.def + g.pot.spd;
        return RARITY_INDEX[g.rarity] >= 1 || potSum >= 100;
    }
    _tryCaptures(enemies, silent) {
        const got = [], r = this.rng();
        for (const e of enemies) {
            if (this.s.orbs <= 0) break;
            if (!this._wantCapture(e)) continue;
            this.s.orbs--;
            if (r() < this.captureChance(e)) {
                const g = JSON.parse(JSON.stringify(e));
                delete g.boss;
                g.id = 'c' + (this.s.rng >>> 0).toString(36) + Math.floor(r() * 1e9).toString(36);
                g.level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(e.level * 0.8))); g.xp = 0;
                this.s.stats.captures++;
                if (g.prismatic) this.s.stats.prismatics++;
                const isNew = this.addCreature(g, silent);
                got.push({ g, isNew });
                if (!silent) this.log(`${g.prismatic ? '✦ PRISMÁTICO! ' : ''}${g.name} (${RARITIES[RARITY_INDEX[g.rarity]].name}) capturado${isNew ? ' — nova espécie no Genodex!' : ''}`, g.prismatic ? 'prism' : isNew ? 'good' : 'info');
            }
        }
        return got;
    }

    // ---------- tempo ----------
    // Produção contínua (online e offline): orbes, chaves e o Santuário.
    sanctuaryRate() {
        const n = this.s.creatures.length - this.s.team.length;
        if (n <= 0) return { essence: 0, dna: 0 };
        const base = this.essencePerWin(Math.max(1, this.s.maxStage - 5)) / 60;
        const mult = (1 + this.up('habitat') * 0.3) * Math.sqrt(n);
        return { essence: base * 0.35 * mult, dna: 0.02 * mult };
    }
    passiveTick(dt) {
        const s = this.s;
        s.stats.playSeconds += dt;
        const r = this.sanctuaryRate();
        s.essence += r.essence * dt; s.dna += r.dna * dt;
        const orbsLvl = this.up('orbs');
        if (orbsLvl > 0) { s.orbTimer += dt * orbsLvl; while (s.orbTimer >= 60) { s.orbTimer -= 60; s.orbs++; } }
        else s.orbTimer = 0;
        if (s.keys < MAX_KEYS) { s.keyTimer += dt; while (s.keyTimer >= KEY_PERIOD_S && s.keys < MAX_KEYS) { s.keyTimer -= KEY_PERIOD_S; s.keys++; } }
        else s.keyTimer = 0;
    }
    offlineCapSeconds() { return (BASE_OFFLINE_HOURS + this.perk('dream') * 2) * 3600; }

    // Progresso offline: roda as MESMAS lutas do jogo (simulação real, sem render) até gastar o tempo.
    // Acima de maxBattles, o resto é extrapolado pela taxa média das últimas lutas (sem avançar estágio).
    runOffline(seconds, maxBattles = 3000) {
        const s = this.s, before = { essence: s.essence, dna: s.dna, stage: s.stage, captures: s.stats.captures, orbs: s.orbs, prism: s.stats.prismatics };
        const levelsBefore = this.teamGenomes().reduce((a, g) => a + g.level, 0);
        let t = 0, battles = 0, wins = 0;
        const total = Math.min(seconds, this.offlineCapSeconds());
        const recent = [];
        if (!s.starterChosen || !s.team.length) { this.passiveTick(total); return this._offlineSummary(before, levelsBefore, total, 0, 0); }
        while (t < total && battles < maxBattles) {
            const { stage, enemies, battle } = this.makeStageBattle(s.lastTick + t * 1000);
            let guard = 0;
            while (!battle.result && guard++ < 200) stepFast(battle);
            const dt = battle.t + BATTLE_OVERHEAD;
            const ess0 = s.essence;
            this.resolveStage(stage, enemies, battle.result, { silent: true });
            this.passiveTick(dt);
            recent.push({ dt, ess: s.essence - ess0 }); if (recent.length > 50) recent.shift();
            t += dt; battles++; if (battle.result === 'A') wins++;
        }
        if (t < total && recent.length) {
            const rt = recent.reduce((a, b) => a + b.dt, 0), re = recent.reduce((a, b) => a + b.ess, 0);
            const rest = total - t;
            s.essence += (re / rt) * rest * 0.8;
            this.passiveTick(rest);
            t = total;
        }
        s.stats.offlineSeconds += total;
        return this._offlineSummary(before, levelsBefore, total, battles, wins);
    }
    _offlineSummary(before, levelsBefore, seconds, battles, wins) {
        const s = this.s;
        return {
            seconds, battles, wins, essence: s.essence - before.essence, dna: s.dna - before.dna, stageFrom: before.stage, stageTo: s.stage,
            captures: s.stats.captures - before.captures, prismatics: s.stats.prismatics - before.prism,
            levels: this.teamGenomes().reduce((a, g) => a + g.level, 0) - levelsBefore,
        };
    }

    // ---------- melhorias e perks ----------
    buyUpgrade(id) {
        const def = UPGRADES.find(u => u.id === id); if (!def) return false;
        const lvl = this.up(id); if (lvl >= def.max) return false;
        const cost = upgradeCost(def, lvl); if (this.s.essence < cost) return false;
        this.s.essence -= cost; this.s.upgrades[id] = lvl + 1;
        this.emit('upgrade', { id }); return true;
    }
    buyPerk(id) {
        const def = PERK_DEFS.find(u => u.id === id); if (!def) return false;
        const lvl = this.perk(id); if (lvl >= def.max) return false;
        const cost = upgradeCost(def, lvl); if (this.s.shards < cost) return false;
        this.s.shards -= cost; this.s.perks[id] = lvl + 1;
        this.emit('perk', { id }); return true;
    }
    orbPrice() { return Math.ceil(5 * Math.pow(1.05, Math.min(this.s.maxStage, 400))); }
    buyOrbs(n) { const c = this.orbPrice() * n; if (this.s.essence < c) return false; this.s.essence -= c; this.s.orbs += n; this.emit('orbs'); return true; }

    // ---------- fusão ----------
    fusionCost(a, b) { return Math.ceil(15 * (1 + RARITY_INDEX[a.rarity] + RARITY_INDEX[b.rarity]) * (1 + Math.max(a.gen, b.gen) * 0.5)); }
    fusePreview(aId, bId) {
        const a = this.byId(aId), b = this.byId(bId);
        if (!a || !b || a === b) return null;
        const ra = RARITY_INDEX[a.rarity], rb = RARITY_INDEX[b.rarity];
        return { cost: this.fusionCost(a, b), minRarity: RARITIES[Math.max(ra, rb)].name, upChance: ra === rb && Math.max(ra, rb) < 4 ? 0.6 : 0, types: [...new Set([...a.types, ...b.types])], prismChance: (a.prismatic || b.prismatic) ? 0.12 : this.prismaticRate() * 4 };
    }
    fuse(aId, bId) {
        const a = this.byId(aId), b = this.byId(bId);
        if (!a || !b || a === b) return null;
        const cost = this.fusionCost(a, b);
        if (this.s.dna < cost) return null;
        this.s.dna -= cost;
        const child = fuse(a, b, this.s.seed + ':fuse:' + this.s.stats.fusions + ':' + a.id + b.id);
        child.id = 'f' + Date.now().toString(36) + this.s.stats.fusions.toString(36);
        const wasTeam = this.s.team.includes(aId) || this.s.team.includes(bId);
        this.s.team = this.s.team.filter(id => id !== aId && id !== bId);
        this.s.creatures = this.s.creatures.filter(c => c.id !== aId && c.id !== bId);
        this.s.stats.fusions++;
        if (child.prismatic) this.s.stats.prismatics++;
        this.addCreature(child, true);
        if (wasTeam || !this.s.team.length) this.s.team.push(child.id);
        this.log(`Fusão concluída: ${child.name} (${RARITIES[RARITY_INDEX[child.rarity]].name}${child.prismatic ? ', PRISMÁTICO' : ''}${child.mutated ? ', mutação' : ''}) — geração ${child.gen}`, child.prismatic ? 'prism' : 'good');
        this.emit('fusion', { g: child }); this.emit('team');
        return child;
    }

    // ---------- expedição roguelike ----------
    canExpedition() { return this.s.maxStageEver >= EXPEDITION_UNLOCK && this.s.keys > 0 && !this.s.expedition && this.s.team.length > 0; }
    startExpedition() {
        if (!this.canExpedition()) return null;
        this.s.keys--;
        const team = this.teamGenomes();
        const avg = Math.round(team.reduce((a, g) => a + g.level, 0) / team.length);
        this.s.expedition = { floor: 1, avg, relics: {}, hp: {}, choices: null, seed: this.s.seed + ':exp:' + this.s.stats.battles, team: team.map(g => g.id), rewards: { essence: 0, dna: 0 } };
        this.emit('expedition'); return this.s.expedition;
    }
    expeditionEnemies() {
        const ex = this.s.expedition; if (!ex) return [];
        const r = makeRng(ex.seed + ':f' + ex.floor), boss = ex.floor % 5 === 0;
        const n = boss ? 3 : Math.min(3, 2 + Math.floor(ex.floor / 3));
        return Array.from({ length: n }, (_, i) => {
            const g = createGenome(ex.seed + ':fe:' + ex.floor + ':' + i, { type: r.pick(TYPES), luck: 0.1 + ex.floor * 0.08, level: 1, prismaticRate: this.prismaticRate() * 2, rarity: boss && i === 0 ? (ex.floor === 10 ? (r() < 0.25 ? 'mythic' : 'legendary') : 'epic') : undefined });
            g.level = Math.max(1, Math.round(ex.avg * (0.7 + ex.floor * 0.03)) + (boss && i === 0 ? 4 : 0));
            if (boss && i === 0) g.boss = true;
            return g;
        });
    }
    relicStacks(id) { return (this.s.expedition && this.s.expedition.relics[id]) || 0; }
    expeditionMods() {
        const m = this.playerMods(), st = (id) => this.relicStacks(id);
        m.dmg *= 1 + st('fang') * 0.08; m.hp *= 1 + st('shell') * 0.1; m.spd *= 1 + st('wing') * 0.08;
        m.crit += st('lens') * 0.06; m.energy += Math.floor(st('core') / 2);
        return m;
    }
    makeExpeditionBattle() {
        const ex = this.s.expedition; if (!ex || ex.choices) return null;
        const team = ex.team.map(id => this.byId(id)).filter(Boolean);
        const enemies = this.expeditionEnemies();
        const battle = createBattle(team, enemies, { seed: hashStr(ex.seed + ':b' + ex.floor), tide: this.tide().type, modsA: this.expeditionMods(), modsB: { hp: ex.floor % 5 === 0 ? 1.4 : 1 } });
        // a vida persiste entre andares
        for (const u of battle.units) if (u.side === 'A' && ex.hp[u.id] !== undefined) { u.hp = Math.max(0, Math.round(u.maxHp * ex.hp[u.id])); if (u.hp <= 0) u.alive = false; }
        return { enemies, battle };
    }
    resolveExpedition(battle) {
        const ex = this.s.expedition; if (!ex) return null;
        const res = { result: battle.result, floor: ex.floor };
        for (const u of battle.units) if (u.side === 'A') ex.hp[u.id] = u.alive ? u.hp / u.maxHp : 0;
        if (battle.result !== 'A') return this.endExpedition(false);
        const reward = Math.ceil(this.essencePerWin(Math.max(1, this.s.maxStage)) * (1 + ex.floor * 0.5) * (1 + this.relicStacks('gold') * 0.15));
        ex.rewards.essence += reward; ex.rewards.dna += 5 * ex.floor;
        const regen = 0.25 + this.relicStacks('heart') * 0.06 + (ex.floor % 3 === 0 ? 1 : 0);     // descanso: 25% por andar e cura total a cada 3
        for (const id in ex.hp) ex.hp[id] = Math.min(1, (ex.hp[id] > 0 ? ex.hp[id] : (ex.floor % 3 === 0 ? 0.5 : 0)) + (ex.hp[id] > 0 ? regen : 0));     // nos descansos, quem caiu volta com 50%
        if (ex.floor >= EXPEDITION_FLOORS) return this.endExpedition(true);
        const r = makeRng(ex.seed + ':relic:' + ex.floor);
        const pool = [...RELICS], n = 3 + this.perk('relic');
        ex.choices = [];
        while (ex.choices.length < n && pool.length) ex.choices.push(pool.splice(Math.floor(r() * pool.length), 1)[0].id);
        this.emit('expedition'); return res;
    }
    pickRelic(id) {
        const ex = this.s.expedition; if (!ex || !ex.choices || !ex.choices.includes(id)) return false;
        ex.relics[id] = (ex.relics[id] || 0) + 1; ex.choices = null; ex.floor++;
        if (id === 'orb') this.s.orbs += 2;
        this.emit('expedition'); return true;
    }
    endExpedition(victory) {
        const ex = this.s.expedition; if (!ex) return null;
        const reached = victory ? EXPEDITION_FLOORS : ex.floor - 1;
        this.s.essence += ex.rewards.essence; this.s.dna += ex.rewards.dna;
        this.s.stats.bestFloor = Math.max(this.s.stats.bestFloor, reached);
        let egg = null;
        if (reached >= 3) {
            const rarity = reached >= 10 ? (makeRng(ex.seed + 'egg')() < 0.35 ? 'mythic' : 'legendary') : reached >= 6 ? 'epic' : 'rare';
            egg = createGenome(ex.seed + ':egg', { rarity, level: Math.max(1, Math.round(ex.avg * 0.7)), potMin: reached >= 10 ? 20 : 10, prismaticRate: this.prismaticRate() * 8 });
            egg.level = Math.max(1, Math.round(ex.avg * 0.7));
            this.addCreature(egg, true);
            if (egg.prismatic) this.s.stats.prismatics++;
        }
        const out = { victory, reached, essence: ex.rewards.essence, dna: ex.rewards.dna, egg };
        this.s.expedition = null;
        this.log(victory ? `Expedição completa! ${egg ? egg.name + ' eclodiu do Ovo da Fenda.' : ''}` : `Expedição encerrada no andar ${reached + 1}.${egg ? ' Recompensa: ' + egg.name : ''}`, victory ? 'good' : 'info');
        this.emit('expeditionEnd', out); this.emit('team');
        return out;
    }

    // ---------- prestígio ----------
    collapseReward() {
        const m = this.s.maxStage;
        if (m < COLLAPSE_MIN_STAGE) return 0;
        return Math.floor(Math.pow((m - 20) / 10, 1.85));
    }
    collapse() {
        const gain = this.collapseReward();
        if (gain <= 0) return 0;
        const s = this.s;
        s.shards += gain; s.stats.collapses++;
        s.essence = 0; s.upgrades = { slot: s.upgrades.slot || 0 };
        s.stage = 1 + this.perk('warp') * 10; s.maxStage = s.stage; s.farmUntil = 0; s.pushTimer = 0;
        s.orbs = Math.max(s.orbs, 15);
        for (const g of s.creatures) { g.level = 1; g.xp = 0; }
        for (const g of this.teamGenomes()) g.level = 1 + this.perk('warp') * 8;
        s.expedition = null;
        this.log(`Colapso da Fenda! +${gain} Estilhaços. O ciclo recomeça mais forte.`, 'prism');
        this.emit('collapse', { gain }); this.emit('team');
        return gain;
    }

    // ---------- save ----------
    serialize() { this.s.lastSave = Date.now(); return JSON.stringify(this.s); }
    static deserialize(json) {
        const raw = typeof json === 'string' ? JSON.parse(json) : json;
        if (!raw || typeof raw !== 'object' || raw.v !== SAVE_VERSION || !Array.isArray(raw.creatures)) throw new Error('save inválido');
        const s = Object.assign(newState(raw.seed), raw);
        s.stats = Object.assign(newState().stats, raw.stats || {});
        s.settings = Object.assign(newState().settings, raw.settings || {});
        s.team = (s.team || []).filter(id => s.creatures.some(c => c.id === id));
        for (const k of ['essence', 'dna', 'shards', 'orbs', 'keys', 'stage', 'maxStage']) if (!Number.isFinite(s[k]) || s[k] < 0) s[k] = newState()[k];
        return new Game(s);
    }
    exportSave() { const j = this.serialize(); return typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(j))) : Buffer.from(j, 'utf8').toString('base64'); }
    static importSave(b64) { const j = typeof atob === 'function' ? decodeURIComponent(escape(atob(b64.trim()))) : Buffer.from(b64.trim(), 'base64').toString('utf8'); return Game.deserialize(j); }
}

// Avanço rápido de uma batalha sem render (1 s por chamada), com Sincronia automática se o perk estiver ativo.
import { step, triggerSync } from './battle.js';
export function stepFast(battle, autoSync = false) { if (autoSync) triggerSync(battle); return step(battle, 1); }
export { simulate, TYPE_INFO, ALL_SPECIES, BODIES, statsOf, power };
