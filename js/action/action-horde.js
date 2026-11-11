// ============================================================
// F12 · Mundo de Ação 3D · inteligência e direção das hordas (funções puras, sem DOM, sem Three.js). Contrato: docs/action/CONTRATO.md.
//   ACTION_ARCHETYPES · actionArchetypeFor(speciesId) · actionInitEnemy(e) · actionEnemyThink(world, e, dt)
//   ActionDirector(world, mapDef, route) · actionAutoPilot(world, dt)
// Campos que a IA escreve na entidade e que o núcleo (ActionWorld) deve ler:
//   e.speedMul   multiplicador da velocidade de andar (ACTION_BALANCE.enemySpeed × speedMul)
//   e.guard      0..1 = fração do dano REDUZIDA (casulo endurecido): dano final = dano × (1 - e.guard)
//   e.windupMul  multiplicador do tempo de preparo do golpe (chefe: golpes de área anunciados)
//   e.mass       massa para empurrão/separação (tanque empurra)
//   e.want       { mx, mz, cast, aimX, aimZ } (aimX/aimZ = PONTO no chão onde mirar)
// Campos internos (prefixo `ai`): não dependem do núcleo. Tempo sempre em world.t (robusto ao rodízio de decisões).
// ============================================================
const ACTION_ARCHETYPES = {
    //            velocidade  vida extra  alcance preferido (min..max)  preparo(s)  recarga(s)  raio de agressão
    swarm:   Object.freeze({ id: 'swarm',   speedMul: 1.35, hpMul: 0.7,  prefMin: 0,   prefMax: 1.4, windup: 0.25, cd: 1.1, aggro: 40, mass: 0.6, pauses: true }),
    bruiser: Object.freeze({ id: 'bruiser', speedMul: 1.0,  hpMul: 1.3,  prefMin: 0,   prefMax: 1.6, windup: 0.45, cd: 2.2, aggro: 24, mass: 1.2, pauses: false, recover: 0.9 }),
    tank:    Object.freeze({ id: 'tank',    speedMul: 0.6,  hpMul: 2.2,  prefMin: 0,   prefMax: 1.8, windup: 0.6,  cd: 2.6, aggro: 28, mass: 3.0, pauses: false }),
    ranged:  Object.freeze({ id: 'ranged',  speedMul: 0.9,  hpMul: 0.8,  prefMin: 4.5, prefMax: 7.0, windup: 0.5,  cd: 2.4, aggro: 30, mass: 0.8, pauses: true }),
    cocoon:  Object.freeze({ id: 'cocoon',  speedMul: 0.15, hpMul: 1.6,  prefMin: 0,   prefMax: 1.5, windup: 0.5,  cd: 2.8, aggro: 12, mass: 1.5, pauses: false, harden: 0.65, hardenFor: 1.4, hardenCd: 3.0 }),
    support: Object.freeze({ id: 'support', speedMul: 0.9,  hpMul: 0.7,  prefMin: 5.5, prefMax: 8.5, windup: 0.55, cd: 3.0, aggro: 30, mass: 0.8, pauses: true }),
    flyer:   Object.freeze({ id: 'flyer',   speedMul: 1.5,  hpMul: 0.8,  prefMin: 3.5, prefMax: 5.5, windup: 0.3,  cd: 1.6, aggro: 34, mass: 0.5, pauses: false, diveEvery: 3.2, diveFor: 1.3 }),
    boss:    Object.freeze({ id: 'boss',    speedMul: 0.85, hpMul: 1.0,  prefMin: 0,   prefMax: 2.4, windup: 1.0,  cd: 2.4, aggro: 60, mass: 5.0, pauses: false, summonEvery: 18 }),
};
const ACTION_ARCHETYPE_IDS = ['swarm', 'bruiser', 'tank', 'ranged', 'cocoon', 'support', 'flyer', 'boss'];

// Espécies da Floresta de Viridian e arredores (tabela explícita). O resto vem da regra geral por tipo e atributos base.
const ACTION_ARCHETYPE_TABLE = {
    10: 'swarm',     // Caterpie: fraco e numeroso
    11: 'cocoon',    // Metapod: endurece
    12: 'support',   // Butterfree: pó de longe
    13: 'swarm',     // Weedle
    14: 'cocoon',    // Kakuna: endurece
    15: 'swarm',     // Beedrill: o enxame do anime
    16: 'flyer',     // Pidgey: orbita e dá rasantes
    19: 'swarm',     // Rattata
    25: 'ranged',    // Pikachu: descarga à distância
    46: 'tank',      // Paras: tanque lento com esporos (pesquisa: zona de controle)
    47: 'tank',      // Parasect
    123: 'flyer',    // Scyther: rápido, rasante
    127: 'bruiser',  // Pinsir: avança e bate forte
};

// Regra geral. Determinística: só olha tipos e atributos base.
function actionArchetypeFor(speciesId) {
    const id = speciesId | 0;
    if (Object.prototype.hasOwnProperty.call(ACTION_ARCHETYPE_TABLE, id)) return ACTION_ARCHETYPE_TABLE[id];
    const d = (typeof POKEMON_DATA !== 'undefined') ? POKEMON_DATA[id] : null;
    if (!d || !d.baseStats) return 'bruiser';
    const b = d.baseStats, types = d.types || [], has = (t) => types.indexOf(t) >= 0;
    const bst = b.hp + b.atk + b.def + b.spAtk + b.spDef + b.speed;
    if (bst <= 340 && b.speed <= 35 && b.atk <= 50) return 'cocoon';
    if (b.def >= 100 || (b.def >= 80 && b.speed <= 45)) return 'tank';
    if (has('flying')) return 'flyer';
    if (b.speed >= 65 && b.hp <= 60) return 'swarm';
    if (b.spAtk >= b.atk + 15 && b.spAtk >= 75) return 'ranged';
    if ((b.spDef >= 75 && b.atk < 65) || ((has('grass') || has('fairy') || has('poison') || has('psychic')) && b.atk < 60 && b.spAtk >= b.atk)) return 'support';
    if (b.atk >= 90) return 'bruiser';
    if (b.speed >= 75) return 'swarm';
    if (b.hp >= 90) return 'tank';
    if (b.hp <= 55 && bst <= 380) return 'swarm';
    return 'bruiser';
}

// ------------------------------------------------------------
// Utilidades sem alocação
// ------------------------------------------------------------
const _HORDE_ANG = [0, 0.7, 0.7, 1.4, 1.4, 2.1, 2.1];
const _HORDE_COS = _HORDE_ANG.map(Math.cos), _HORDE_SIN = _HORDE_ANG.map(Math.sin);
const _hordeNear = [], _hordeNear2 = [];
let _hordeSx = 0, _hordeSz = 0;       // saída de _hordeCenter

function _hordeSeed(e) {
    const s = Number(e.seed);
    if (!Number.isFinite(s)) return 0;
    return (s > 0 && s < 1 ? Math.floor(s * 4294967296) : Math.floor(s)) >>> 0;
}
function _hordeHash(a, b) {
    let h = (Math.imul(a ^ 0x9E3779B9, 0x85EBCA6B) ^ Math.imul(b + 0x7F4A7C15, 0xC2B2AE35)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D) >>> 0; h ^= h >>> 12; h = Math.imul(h, 0x297A2D39) >>> 0; h ^= h >>> 15;
    return h >>> 0;
}
function _hordeRnd(e) {        // mulberry32 sobre e.aiR (não consome world.rng)
    let t = (e.aiR = (e.aiR + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function _hordeBlocked(map, x, z) {
    if (!map) return false;
    return worldCellBlocked(map, Math.floor(x), Math.floor(z));
}
// Direção (dx,dz) com desvio de parede: tenta a direção e gira para o lado preferido e depois para o outro. Escreve em w.mx/w.mz.
function _hordeSteer(map, e, w, dx, dz, mag, side) {
    const l = Math.hypot(dx, dz);
    if (l < 1e-6) { w.mx = 0; w.mz = 0; return; }
    const ux = dx / l, uz = dz / l, r = (e.radius || 0.4) + 0.55, sg = side >= 0 ? 1 : -1;
    for (let k = 0; k < 7; k++) {
        const s = (k & 1) ? sg : -sg, c = _HORDE_COS[k], sn = _HORDE_SIN[k] * (k === 0 ? 0 : s);
        const rx = ux * c - uz * sn, rz = ux * sn + uz * c;
        if (!_hordeBlocked(map, e.x + rx * r, e.z + rz * r) && !_hordeBlocked(map, e.x + rx * r * 0.5, e.z + rz * r * 0.5)) { w.mx = rx * mag; w.mz = rz * mag; return; }
    }
    w.mx = 0; w.mz = 0;
}
// Alcance útil do golpe (regra do contrato): linha/cone = comprimento; círculo em si = raio; círculo no alvo = lançamento médio; corpo a corpo curto
function _hordeReach(profile) {
    if (!profile || !profile.area) return 1.5;
    const a = profile.area;
    if (a.kind === 'line' || a.kind === 'cone') return a.len * 0.9;
    if (a.at === 'self') return a.r * 0.8;
    return profile.melee ? 1.5 : 5.5;
}
// Melhor golpe pronto que alcança a distância. far: prefere o de maior alcance/área; senão o mais forte.
function _hordePick(e, dist, far, minReach) {
    const mv = e.moves; let best = -1, bs = -1;
    if (!mv) return -1;
    for (let i = 0; i < mv.length; i++) {
        const m = mv[i];
        if (!m || m.cd > 0) continue;
        const r = _hordeReach(m.profile) + 0.4;
        if (dist > r || r < (minReach || 0)) continue;
        const sc = far ? r : (m.power || 0) + i * 0.001;
        if (sc > bs) { bs = sc; best = i; }
    }
    return best;
}

// Prepara os campos de IA de uma entidade recém-nascida (idempotente por `e.wild`). Escala a vida pelo hpMul do arquétipo.
function actionInitEnemy(e, rng) {
    if (e.arch == null || !ACTION_ARCHETYPES[e.arch]) e.arch = e.tier === 'boss' ? 'boss' : actionArchetypeFor(e.speciesId);
    const A = ACTION_ARCHETYPES[e.arch];
    if (typeof e.seed !== 'number' || !Number.isFinite(e.seed)) e.seed = Math.floor(((rng ? rng() : 0.5)) * 4294967296);
    const s = _hordeSeed(e), u1 = _hordeHash(s, 1) / 4294967296, u2 = _hordeHash(s, 2) / 4294967296, u3 = _hordeHash(s, 3) / 4294967296;
    e.aiWild = e.wild; e.aiInit = 1;
    e.aiR = _hordeHash(s, 7);
    e.aiAng = u1 * Math.PI * 2; e.aiSide = u2 < 0.5 ? -1 : 1; e.aiRing = 2.5 + u3 * 3.5;
    e.aiVar = 0.9 + 0.2 * u3;                                   // variação individual de velocidade e de alcance
    e.speedBase = A.speedMul * e.aiVar; e.speedMul = e.speedBase;
    e.windupMul = A.windup / 0.35; e.mass = A.mass; e.guard = 0;
    e.aiMode = 0; e.aiUntil = 0; e.aiCastAt = 0; e.aiPauseUntil = 0; e.aiNextPause = 1 + u1 * 3; e.aiPhase = 0; e.aiSummonAt = 0; e.aiHardenAt = 0; e.aiGuardUntil = 0; e.aiDiveAt = 1 + u2 * 3;
    if (A.hpMul !== 1 && e.maxHp > 0) { e.maxHp = Math.max(1, Math.round(e.maxHp * A.hpMul)); e.hp = Math.max(1, Math.min(e.maxHp, Math.round((e.hp || e.maxHp) * A.hpMul))); }
    if (!e.want) e.want = { mx: 0, mz: 0, cast: -1, aimX: e.x, aimZ: e.z };
    return e;
}

function _hordeCenter(world, e, r) {       // centroide dos vizinhos (sem o próprio) → _hordeSx/_hordeSz; devolve quantos
    _hordeNear.length = 0;
    const list = world.near(e.x, e.z, r, _hordeNear);
    let n = 0, sx = 0, sz = 0;
    for (let i = 0; i < list.length; i++) { const o = list[i]; if (o === e || !o.alive) continue; sx += o.x; sz += o.z; n++; }
    if (n) { _hordeSx = sx / n; _hordeSz = sz / n; }
    return n;
}

function _hordeCast(e, w, A, t, dist, far, minReach) {
    if (t < e.aiCastAt) return false;
    const i = _hordePick(e, dist, far, minReach);
    if (i < 0) return false;
    w.cast = i;
    e.aiCastAt = t + A.cd * (0.8 + 0.4 * _hordeRnd(e));
    return true;
}

function _hordeSummon(world, e, count) {
    const g = world.game, route = e.aiRoute;
    for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2 + _hordeRnd(e), rad = 2.0 + e.radius;
        let x = e.x + Math.cos(a) * rad, z = e.z + Math.sin(a) * rad;
        if (_hordeBlocked(world.map, x, z)) { x = e.x + Math.cos(a) * 1.0; z = e.z + Math.sin(a) * 1.0; if (_hordeBlocked(world.map, x, z)) continue; }
        let wild = route && g && g.generateWildPokemon ? g.generateWildPokemon(route) : null;
        if (!wild && g && g.createWildPokemon) wild = g.createWildPokemon(e.speciesId, Math.max(1, (e.level || 5) - 3), 0);
        if (!wild) continue;
        const m = world.spawnEnemy({ wild, tier: 'minion', arch: actionArchetypeFor(wild.id) }, x, z);
        if (!m) break;             // limite cheio: o resto não nasce
        m.aiInit = 0; m.summoned = true; actionInitEnemy(m, world.rng);
    }
}

// ------------------------------------------------------------
// Decisão de um inimigo
// ------------------------------------------------------------
function actionEnemyThink(world, e, dt) {
    if (!e.aiInit || e.aiWild !== e.wild) actionInitEnemy(e, world.rng);
    const w = e.want || (e.want = { mx: 0, mz: 0, cast: -1, aimX: e.x, aimZ: e.z });
    const p = world.player, st = e.state;
    if (e.arch === 'cocoon') {       // o endurecer vale em qualquer estado: expira sozinho e reage a apanhar
        const C = ACTION_ARCHETYPES.cocoon, now = world.t;
        if (e.guard > 0 && now >= e.aiGuardUntil) e.guard = 0;
        if (e.guard === 0 && st === 'hurt' && now >= e.aiHardenAt) { e.guard = C.harden; e.aiGuardUntil = now + C.hardenFor; e.aiHardenAt = now + C.hardenFor + C.hardenCd; }
    }
    // orçamento: cada um decide a cada 3 passos (escalonado pelo id) e no máximo thinkPerStep por passo; nos outros passos mantém a intenção de andar
    const stepN = Math.round(world.t / ACTION_STEP);
    if (world._hzStep !== stepN) { world._hzStep = stepN; world._hzN = 0; }
    if (((stepN + (e.id | 0)) % 3) !== 0 || world._hzN >= ACTION_BALANCE.thinkPerStep) { w.cast = -1; return; }
    world._hzN++;
    w.cast = -1; w.mx = 0; w.mz = 0;
    if (!p || !p.alive || e.hp <= 0) return;
    if (st === 'windup' || st === 'attack' || st === 'dying' || st === 'dead' || st === 'balled' || st === 'hurt' || e.stun > 0) return;
    const A = ACTION_ARCHETYPES[e.arch], t = world.t, map = world.map;
    const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz), side = e.aiSide;
    w.aimX = p.x; w.aimZ = p.z;
    if (dist > A.aggro) return;
    // pequenas pausas por indivíduo (nunca durante o chefe ou o casulo)
    if (t < e.aiPauseUntil) return;
    if (A.pauses && t >= e.aiNextPause && dist > 2.5) { e.aiPauseUntil = t + 0.2 + 0.35 * _hordeRnd(e); e.aiNextPause = t + 2 + 4 * _hordeRnd(e); return; }
    const reach = A.prefMax * e.aiVar;

    switch (e.arch) {
        case 'swarm': {
            // aproxima por um ponto no anel em volta do jogador (ângulo da semente, gira devagar): cerca em vez de fila
            if (dist > 3.2) {
                const a = e.aiAng + side * t * 0.35, ring = Math.min(e.aiRing, dist * 0.6);
                _hordeSteer(map, e, w, p.x + Math.sin(a) * ring - e.x, p.z + Math.cos(a) * ring - e.z, 1, side);
            } else if (dist > 1.1) _hordeSteer(map, e, w, dx, dz, 1, side);
            _hordeCast(e, w, A, t, dist, false, 0);
            break;
        }
        case 'bruiser': {
            if (e.aiMode === 1) { if (t >= e.aiUntil) e.aiMode = 0; break; }       // pausa depois do golpe
            if (dist > reach * 0.8) _hordeSteer(map, e, w, dx, dz, dist > 5 ? 1 : 0.9, side);
            if (_hordeCast(e, w, A, t, dist, false, 0)) { e.aiMode = 1; e.aiUntil = t + A.recover + A.windup; }
            break;
        }
        case 'tank': {
            if (dist > reach * 0.8) _hordeSteer(map, e, w, dx, dz, 1, side);
            _hordeCast(e, w, A, t, dist, false, 0);
            break;
        }
        case 'ranged':
        case 'support': {
            const prefMin = A.prefMin * e.aiVar, prefMax = A.prefMax * e.aiVar;
            let far = 0;
            for (let i = 0; e.moves && i < e.moves.length; i++) far = Math.max(far, _hordeReach(e.moves[i].profile));
            const hi = Math.min(prefMax, Math.max(prefMin + 1, far * 0.8)), lo = Math.min(prefMin, hi - 1);
            if (e.arch === 'support') {
                const n = _hordeCenter(world, e, 7);
                if (dist < lo) _hordeSteer(map, e, w, -dx, -dz, 1, side);                       // jogador chegou perto: recua
                else if (n >= 2 && dist < hi + 3) {                                                // fica atrás do grupo (lado oposto ao jogador)
                    const cx = _hordeSx, cz = _hordeSz, ax = cx - p.x, az = cz - p.z, al = Math.hypot(ax, az) || 1;
                    const tx = cx + ax / al * 2.2 - e.x, tz = cz + az / al * 2.2 - e.z;
                    if (Math.hypot(tx, tz) > 1) _hordeSteer(map, e, w, tx, tz, 0.8, side);
                } else if (dist > hi) _hordeSteer(map, e, w, dx, dz, 0.9, side);
            } else {
                if (dist < lo) _hordeSteer(map, e, w, -dx, -dz, 1, side);                       // recua se o jogador chega perto
                else if (dist > hi) _hordeSteer(map, e, w, dx, dz, 0.9, side);
                else _hordeSteer(map, e, w, -dz * side, dx * side, 0.35, side);                  // circula devagar
            }
            _hordeCast(e, w, A, t, dist, true, 2.5);
            break;
        }
        case 'cocoon': {
            // endurece quando o jogador chega perto ou quando apanha; só revida de perto
            if (e.guard > 0 && t >= e.aiGuardUntil) e.guard = 0;
            if (e.guard === 0 && t >= e.aiHardenAt && (dist < 7 || st === 'hurt')) { e.guard = A.harden; e.aiGuardUntil = t + A.hardenFor; e.aiHardenAt = t + A.hardenFor + A.hardenCd; }
            if (e.guard > 0) break;                                                               // endurecido: parado
            if (dist > A.prefMax) _hordeSteer(map, e, w, dx, dz, 0.5, side);
            else _hordeCast(e, w, A, t, dist, false, 0);
            break;
        }
        case 'flyer': {
            if (e.aiMode === 1) {                                                                  // rasante
                if (t >= e.aiUntil || dist < 1.2) { e.aiMode = 0; e.speedMul = e.speedBase; e.aiDiveAt = t + A.diveEvery * (0.7 + 0.6 * _hordeRnd(e)); }
                else { _hordeSteer(map, e, w, dx, dz, 1, side); _hordeCast(e, w, A, t, dist, false, 0); break; }
            }
            if (t >= e.aiDiveAt) { e.aiMode = 1; e.aiUntil = t + A.diveFor; e.speedMul = e.speedBase * 1.8; _hordeSteer(map, e, w, dx, dz, 1, side); break; }
            // órbita: tangente + correção radial
            const R = A.prefMin + (e.aiRing - 2.5) * 0.4, k = Math.max(-1, Math.min(1, (dist - R) * 0.5)), il = dist > 1e-6 ? 1 / dist : 0;
            _hordeSteer(map, e, w, dx * il * k - dz * il * side, dz * il * k + dx * il * side, 1, side);
            break;
        }
        case 'boss': {
            const frac = e.maxHp > 0 ? e.hp / e.maxHp : 1, ph = frac > 0.66 ? 0 : frac > 0.33 ? 1 : 2;
            if (ph > e.aiPhase) { e.aiPhase = ph; e.speedMul = e.speedBase * (1 + 0.12 * ph); _hordeSummon(world, e, 2 + ph * 2); e.aiSummonAt = t + A.summonEvery; }
            else if (t >= e.aiSummonAt) { if (e.aiSummonAt > 0) _hordeSummon(world, e, 2 + ph); e.aiSummonAt = t + A.summonEvery - 3 * ph; }
            if (e.aiMode === 1) { if (t >= e.aiUntil) e.aiMode = 0; break; }
            if (dist > A.prefMax * 0.8) _hordeSteer(map, e, w, dx, dz, 1, side);
            // fase 1+: golpe de área (maior alcance) anunciado com preparo longo; fase 0: golpe forte de perto
            const area = ph >= 1 && dist > 2.4;
            e.windupMul = (area ? A.windup * 1.5 : A.windup) / 0.35;
            const saved = e.aiCastAt; if (area) e.aiCastAt = Math.min(e.aiCastAt, t);
            if (_hordeCast(e, w, A, t, dist, area, area ? 3 : 0)) { e.aiCastAt = t + A.cd * (1 - 0.2 * ph); e.aiMode = 1; e.aiUntil = t + (area ? 0.9 : 0.5); }
            else e.aiCastAt = saved;
            break;
        }
    }
}

// ------------------------------------------------------------
// Diretor de hordas
// ------------------------------------------------------------
function _hordeFree(map, x, z) {
    if (!map) return true;
    return !_hordeBlocked(map, x, z) && !_hordeBlocked(map, x + 0.5, z) && !_hordeBlocked(map, x - 0.5, z) && !_hordeBlocked(map, x, z + 0.5) && !_hordeBlocked(map, x, z - 0.5);
}

class ActionDirector {
    constructor(world, mapDef, route) {
        this.world = world; this.mapDef = mapDef || {}; this.route = route || null;
        this.zones = (mapDef && mapDef.zones) || [];
        if (world && !world.zonesRef) world.zonesRef = this.zones;
        this.state = { n: 0, kind: 'rest', left: 0, total: 0, nextIn: 1.5 };
        this.events = []; this.jobs = []; this.head = 0; this.elites = 0;
    }
    _emit(ev) {
        const w = this.world;
        if (w && typeof w.emit === 'function') w.emit(ev);
        else { this.events.push(ev); if (this.events.length > 64) this.events.shift(); }
    }
    _rng() { return this.world.rng(); }
    // ponto livre numa zona, longe do jogador: devolve true e escreve em out {x,z}
    _pickPoint(zone, minDist, out, tries) {
        const w = this.world, P = w.player, R = this._rng.bind(this);
        for (let i = 0; i < tries; i++) {
            const x = zone.x0 + R() * (zone.x1 - zone.x0 + 1), z = zone.y0 + R() * (zone.y1 - zone.y0 + 1);
            if (!_hordeFree(w.map, x, z)) continue;
            const d = P ? Math.hypot(x - P.x, z - P.z) : 1e9;
            if (d >= minDist) { out.x = x; out.z = z; return true; }
        }
        return false;
    }
    _pickCenter(zoneIdx, minDist) {
        const n = this.zones.length, out = { x: 0, z: 0 };
        if (!n) return null;
        const start = zoneIdx >= 0 ? zoneIdx : Math.floor(this._rng() * n);
        for (let k = 0; k < n; k++) {
            const z = this.zones[(start + k) % n];
            if (this._pickPoint(z, minDist + 1.5, out, 24)) return { x: out.x, z: out.z, zone: (start + k) % n };
            if (zoneIdx >= 0) break;
        }
        return null;
    }
    _bossZoneIdx() {
        const b = this.mapDef.boss; if (!b) return -1;
        for (let i = 0; i < this.zones.length; i++) if (this.zones[i].id === b.zone) return i;
        return typeof b.zone === 'number' && this.zones[b.zone] ? b.zone : this.zones.length - 1;
    }
    _startWave() {
        const w = this.world, B = ACTION_BALANCE.wave, st = this.state, md = this.mapDef;
        const n = ++st.n, wi = ((n - 1) % B.bossAt) + 1, cyc = Math.floor((n - 1) / B.bossAt);
        let kind = 'normal';
        if (wi === B.bossAt && md.boss) kind = 'boss';
        else if (wi % B.eliteEvery === 0 && md.elites && md.elites.length) kind = 'elite';
        const count = Math.min(B.max, B.base + B.growth * (n - 1));
        const minions = kind === 'boss' ? Math.round(count * 0.5) : count;
        const G = Math.max(2, Math.min(4, Math.round(minions / 6)));
        const groups = [];
        for (let g = 0; g < G; g++) groups.push({ x: 0, z: 0, zone: -1, ok: false, idx: g });
        this.jobs.length = 0; this.head = 0;
        const at0 = w.t;
        const push = (g, tier, id, level) => this.jobs.push({ group: groups[g], tier, id, level, at: at0 + g * 0.4 + this.jobs.length * 0.04 });
        if (kind === 'boss') push(0, 'boss', md.boss.id, Math.round(md.boss.level * (1 + 0.1 * cyc)));
        else if (kind === 'elite') {
            const ne = 1 + (cyc >= 2 ? 1 : 0);
            for (let i = 0; i < ne; i++) { const el = md.elites[this.elites++ % md.elites.length]; push(i % G, 'elite', el.id, Math.round(el.level * (1 + 0.1 * cyc))); }
        }
        for (let i = 0; i < minions; i++) push(i % G, 'minion', 0, 0);
        // posições dos grupos (o do chefe fica na zona dele)
        const bz = kind === 'boss' ? this._bossZoneIdx() : -1;
        for (let g = 0; g < G; g++) this._relocate(groups[g], g === 0 && bz >= 0 ? bz : -1);
        st.kind = kind; st.total = this.jobs.length; st.left = this.jobs.length; st.nextIn = 0;
        this._emit({ t: 'wave', n, kind, count: this.jobs.length });
    }
    _relocate(g, zoneIdx) {
        const c = this._pickCenter(zoneIdx, ACTION_BALANCE.spawnMinDist);
        if (c) { g.x = c.x; g.z = c.z; g.zone = c.zone; g.ok = true; } else g.ok = false;
        return g.ok;
    }
    _memberPos(g, out) {
        const w = this.world, P = w.player, md = ACTION_BALANCE.spawnMinDist, R = this._rng.bind(this), zn = this.zones[g.zone];
        for (let i = 0; i < 10; i++) {
            const a = R() * Math.PI * 2, r = i === 9 ? 0 : 0.5 + R() * 1.6, x = g.x + Math.cos(a) * r, z = g.z + Math.sin(a) * r;
            if (zn && (x < zn.x0 || x > zn.x1 + 1 || z < zn.y0 || z > zn.y1 + 1)) continue;      // o grupo fica dentro da zona
            if (!_hordeFree(w.map, x, z)) continue;
            if (P && Math.hypot(x - P.x, z - P.z) < md) continue;
            out.x = x; out.z = z; return true;
        }
        return false;
    }
    _spawnJob(job) {
        const w = this.world, g = job.group, pos = this._spawnPos || (this._spawnPos = { x: 0, z: 0 });
        if (!g.ok || (w.player && Math.hypot(g.x - w.player.x, g.z - w.player.z) < ACTION_BALANCE.spawnMinDist - 1)) {
            if (!this._relocate(g, job.tier === 'boss' ? this._bossZoneIdx() : -1)) return null;
        }
        if (!this._memberPos(g, pos)) { g.ok = false; return null; }
        const game = w.game;
        let wild = null, arch = null;
        if (job.tier === 'minion') { wild = game.generateWildPokemon(this.route); if (wild) arch = actionArchetypeFor(wild.id); }
        else { wild = game.createWildPokemon(job.id, job.level, 0); arch = job.tier === 'boss' ? 'boss' : actionArchetypeFor(job.id); }
        if (!wild) return false;               // sem espécie: descarta o job
        const e = w.spawnEnemy({ wild, tier: job.tier, arch }, pos.x, pos.z);
        if (!e) return null;
        e.arch = arch; e.waveN = this.state.n; e.waveOwner = this; e.aiInit = 0;
        if (job.tier === 'boss') e.aiRoute = this.route;
        actionInitEnemy(e, w.rng);
        return true;
    }
    update(dt) {
        const w = this.world, st = this.state;
        // escalonado: o que não coube no limite espera abrir espaço
        let spawned = 0;
        while (this.head < this.jobs.length && spawned < 4) {
            const job = this.jobs[this.head];
            if (w.t < job.at || w.enemies.length >= w.limit) break;
            const r = this._spawnJob(job);
            if (r === null) { job.at = w.t + 0.5; break; }
            this.head++; spawned++;
        }
        if (this.head >= this.jobs.length && this.jobs.length) { this.jobs.length = 0; this.head = 0; }
        let alive = 0;
        for (let i = 0; i < w.enemies.length; i++) { const e = w.enemies[i]; if (e.alive && e.waveOwner === this && e.waveN === st.n) alive++; }
        const pending = this.jobs.length - this.head;
        if (st.kind === 'rest') {
            st.nextIn -= dt;
            if (st.nextIn <= 0) this._startWave();
        } else {
            st.left = pending + alive;
            if (st.left === 0) { st.kind = 'rest'; st.nextIn = ACTION_BALANCE.wave.rest; }
        }
        if (st.kind === 'rest') st.left = 0;
    }
}

// ------------------------------------------------------------
// Piloto automático do jogador
// ------------------------------------------------------------
function _pilotState(world) {
    return world.pilotState || (world.pilotState = { timer: 0, potionAt: 0, captureAt: 0, dashAt: 0, lx: 0, lz: 0, stuckT: 0, detourUntil: 0, detourSign: 1, goal: null, path: null, pathI: 0, pathAt: -9, zoneI: -1, mx: 0, mz: 0, side: 1 });
}
function _pilotSteer(world, P, S, dx, dz, mag) {
    const w = P.want, dummy = S.tmp || (S.tmp = { mx: 0, mz: 0 });
    _hordeSteer(world.map, P, dummy, dx, dz, mag, S.side);
    w.mx = dummy.mx; w.mz = dummy.mz;
}
function _pilotGoalMove(world, P, S, gx, gz, mag) {       // anda até (gx,gz) por caminho de células; recalcula de vez em quando
    const t = world.t;
    if (!S.goal || S.goal.x !== gx || S.goal.z !== gz || t - S.pathAt > 1.5) {
        if (!S.goal) S.goal = { x: gx, z: gz };
        const moved = S.goal.x !== gx || S.goal.z !== gz;
        S.goal.x = gx; S.goal.z = gz; S.pathAt = t;
        S.path = typeof worldFindPath === 'function' && world.map ? worldFindPath(world.map, { x: Math.floor(P.x), y: Math.floor(P.z) }, { x: Math.floor(gx), y: Math.floor(gz) }) : null;
        S.pathI = 1;
        if (moved) S.stuckT = 0;
    }
    let tx = gx, tz = gz;
    if (S.path && S.path.length > 1) {
        while (S.pathI < S.path.length - 1 && Math.hypot(S.path[S.pathI].x + 0.5 - P.x, S.path[S.pathI].y + 0.5 - P.z) < 0.7) S.pathI++;
        const c = S.path[Math.min(S.pathI, S.path.length - 1)]; tx = c.x + 0.5; tz = c.y + 0.5;
    }
    _pilotSteer(world, P, S, tx - P.x, tz - P.z, mag);
}

function actionAutoPilot(world, dt) {
    const P = world.player;
    if (!P || !P.alive || world.over) return;
    const S = _pilotState(world), g = world.game, t = world.t, BAL = ACTION_BALANCE;
    const inp = world.input || (world.input = { mx: 0, mz: 0, dash: false, skill: -1, capture: false, potion: false });
    const w = P.want || (P.want = { mx: 0, mz: 0, cast: -1, aimX: P.x, aimZ: P.z });
    inp.dash = false; inp.capture = false; inp.potion = false;
    S.timer -= dt;
    if (S.timer > 0) { inp.mx = w.mx; inp.mz = w.mz; inp.skill = w.cast; return; }
    S.timer = 0.1;
    w.cast = -1;
    const hpFrac = P.maxHp > 0 ? P.hp / P.maxHp : 1;
    const policy = (g && typeof g.getAutomationPolicy === 'function') ? g.getAutomationPolicy() : (typeof defaultAutomationPolicy === 'function' ? defaultAutomationPolicy() : null);

    // poção segundo a política de cura
    if (policy && policy.heal.enabled && hpFrac * 100 < policy.heal.whenHpBelowPercent && t >= S.potionAt && g && typeof g.getPotions === 'function' && g.getPotions() > 0) {
        inp.potion = true; S.potionAt = t + BAL.potionCd;
    }
    // anti-travamento: andou pouco querendo andar → desvia de lado por um instante
    const moved = Math.hypot(P.x - S.lx, P.z - S.lz); S.lx = P.x; S.lz = P.z;
    if (Math.hypot(w.mx, w.mz) > 0.3 && moved < 0.06) S.stuckT += 0.1; else S.stuckT = 0;
    if (S.stuckT > 0.5) { S.stuckT = 0; S.detourUntil = t + 0.8; S.detourSign = -S.detourSign; S.side = S.detourSign; S.pathAt = -9; }

    _hordeNear2.length = 0;
    const list = world.near(P.x, P.z, 16, _hordeNear2), n = list.length;
    if (n === 0) {
        // sem inimigos por perto: vai ao inimigo mais próximo do mapa, ou passeia entre as zonas
        let best = null, bd = 1e9;
        for (let i = 0; i < world.enemies.length; i++) { const e = world.enemies[i]; if (!e.alive) continue; const d = Math.hypot(e.x - P.x, e.z - P.z); if (d < bd) { bd = d; best = e; } }
        if (best) _pilotGoalMove(world, P, S, best.x, best.z, 1);
        else {
            const zs = world.zonesRef || (world.map && world.map.zones) || null;
            if (zs && zs.length) {
                if (S.zoneI < 0 || (S.goal && Math.hypot(S.goal.x - P.x, S.goal.z - P.z) < 1.5)) S.zoneI = (S.zoneI + 1) % zs.length;
                const z = zs[S.zoneI];
                _pilotGoalMove(world, P, S, Math.floor((z.x0 + z.x1) / 2) + 0.5, Math.floor((z.y0 + z.y1) / 2) + 0.5, 0.9);
            } else { w.mx = 0; w.mz = 0; }
        }
        inp.mx = w.mx; inp.mz = w.mz; inp.skill = -1;
        return;
    }
    S.goal = null;

    // aglomeração: quantos colados e o centro deles
    let close = 0, cx = 0, cz = 0, nearest = null, nd = 1e9;
    for (let i = 0; i < n; i++) {
        const e = list[i], d = Math.hypot(e.x - P.x, e.z - P.z);
        if (d < 2.2) { close++; cx += e.x; cz += e.z; }
        if (d < nd) { nd = d; nearest = e; }
    }
    // captura segundo a política (o núcleo mira o inimigo com vida baixa mais próximo dentro do alcance)
    if (policy && g && t >= S.captureAt && typeof shouldCapture === 'function') {
        for (let i = 0; i < n; i++) {
            const e = list[i];
            if (e.tier === 'boss' || e.state === 'balled' || !(e.maxHp > 0) || e.hp / e.maxHp > BAL.captureHpFrac || Math.hypot(e.x - P.x, e.z - P.z) > BAL.captureRange) continue;
            const caught = g.gameState && g.gameState.caughtPokemon;
            const dec = shouldCapture({ policy, wild: { id: e.speciesId, ivs: e.wild && e.wild.ivs, shiny: !!e.shiny }, isNewSpecies: !(caught && caught[e.speciesId]) });
            S.captureAt = t + 1.2;
            if (dec && dec.capture) { inp.capture = true; break; }
        }
    }
    // esquiva: cercado ou com vida baixa e colado
    if ((close >= 3 || (hpFrac < 0.4 && close >= 1)) && t >= S.dashAt && !(P.dashCd > 0)) {
        inp.dash = true; S.dashAt = t + BAL.dash.cd + 0.2;
        _pilotSteer(world, P, S, P.x - cx / close, P.z - cz / close, 1);
        w.aimX = nearest.x; w.aimZ = nearest.z;
        inp.mx = w.mx; inp.mz = w.mz; inp.skill = -1;
        return;
    }
    // alvo: o grupo mais denso (chefe e elite pesam mais)
    let tgt = nearest, bs = -1e9;
    for (let i = 0; i < n; i++) {
        const e = list[i], d = Math.hypot(e.x - P.x, e.z - P.z);
        let dens = 0;
        for (let j = 0; j < n; j++) { const o = list[j]; if (Math.abs(o.x - e.x) < 3 && Math.abs(o.z - e.z) < 3 && Math.hypot(o.x - e.x, o.z - e.z) < 3) dens++; }
        const sc = dens + (e.tier === 'boss' ? 3 : e.tier === 'elite' ? 1 : 0) - d * 0.08;
        if (sc > bs) { bs = sc; tgt = e; }
    }
    const td = Math.hypot(tgt.x - P.x, tgt.z - P.z);
    // melhor golpe especial pronto: o que cobre mais inimigos agora
    let bi = -1, bc = 0, ideal = 1.2, bestPow = -1;
    const mv = P.moves;
    for (let k = 1; mv && k < mv.length; k++) {
        const m = mv[k];
        if (!m || m.cd > 0 || !m.profile) continue;
        const a = m.profile.area, launch = a.kind === 'circle' && a.at === 'target' ? 7 : 1e9;
        if (td > launch) continue;
        let cov = 0;
        for (let i = 0; i < n; i++) if (moveFxCovers(m.profile, P, tgt, list[i])) cov++;
        const need = n >= 3 ? 2 : 1;
        if (cov >= need && (cov > bc || (cov === bc && (m.power || 0) > bestPow))) { bc = cov; bi = k; bestPow = m.power || 0; }
    }
    if (bi >= 0) { w.cast = bi; w.aimX = tgt.x; w.aimZ = tgt.z; }
    else w.aimX = tgt.x, w.aimZ = tgt.z;
    // distância boa: do melhor golpe pronto (ou do básico)
    let ref = null;
    if (bi >= 0) ref = mv[bi].profile;
    else {
        let bp = -1;
        for (let k = 1; mv && k < mv.length; k++) if (mv[k] && mv[k].cd <= 0 && mv[k].profile && (mv[k].power || 0) > bp) { bp = mv[k].power || 0; ref = mv[k].profile; }
        if (!ref && mv && mv[0]) ref = mv[0].profile;
    }
    if (ref && ref.area) {
        const a = ref.area;
        ideal = a.kind === 'circle' ? (a.at === 'self' ? a.r * 0.5 : (ref.melee ? 1.2 : 4.5)) : (a.kind === 'line' ? a.len * 0.5 : a.len * 0.55);
    }
    const dx = tgt.x - P.x, dz = tgt.z - P.z;
    if (t < S.detourUntil) _pilotSteer(world, P, S, -dz * S.detourSign, dx * S.detourSign, 1);
    else if (close >= 2 && hpFrac < 0.6) _pilotSteer(world, P, S, P.x - cx / close, P.z - cz / close, 1);       // recua do aperto
    else if (td > ideal + 0.6) _pilotSteer(world, P, S, dx, dz, 1);
    else if (td < ideal - 1.2 && ideal > 2) _pilotSteer(world, P, S, -dx, -dz, 0.8);
    else _pilotSteer(world, P, S, -dz * S.side, dx * S.side, 0.4);                                                // circula
    inp.mx = w.mx; inp.mz = w.mz; inp.skill = w.cast;
}
