// ============================================================
// F12 · Mundo de Ação 3D · simulação pura (sem DOM, sem Three.js). Contrato: docs/action/CONTRATO.md.
// O jogador controla o Pokémon ativo em tempo real num mapa de quadrados; os golpes acertam TODOS os inimigos dentro da área real do golpe
// (moveFxProfile / moveFxCovers de js/fx/move-fx.js). O GameCore continua sendo a autoridade de dano (_computeDamage), EXP/ouro
// (_processVictoryRewards), captura (exploreCapture) e evolução. Unidades: 1 = um quadrado; x leste, z sul; tempo em segundos.
// Sem alocação por passo nos laços quentes: entidades em pool, grade espacial uniforme, eventos de um pool, vetores reaproveitados.
// ============================================================
const ACTION_CORE = {
    cell: 2,                                   // lado da célula da grade espacial (>= soma dos maiores raios, 1,8)
    radius: { minion: 0.4, elite: 0.6, boss: 0.9, player: 0.4 },
    invMass: { minion: 1, elite: 0.5, boss: 0.17, player: 0.1 },      // separação: quanto cada corpo cede (maior = cede mais)
    separation: 0.6,                           // fração da sobreposição corrigida por passo
    speedRange: { player: [0.85, 1.15], enemy: [0.9, 1.1] }, speedHalf: 150,   // fator de velocidade pelo atributo speed: lo + (hi-lo) * s/(s+speedHalf)
    decelMul: 1.4,                             // frear é mais rápido que acelerar
    moveMul: { windup: [0.35, 0], attack: [0.5, 0.2] },               // [jogador, inimigo] enquanto prepara / recupera o golpe
    knockDamp: 10,                             // amortecimento do empurrão (1/s)
    knock: { strike: 5, slash: 5, nova: 4, def: 3 }, knockTier: { minion: 1, elite: 0.5, boss: 0.15 }, knockPlayer: 0.5,
    stun: { strike: 0.12, slash: 0.12, bolt: 0.25, fall: 0.2, nova: 0.15, def: 0.08 }, stunTier: { minion: 1, elite: 0.5, boss: 0 },
    hurtT: 0.12, hurtIframes: 0.2,             // jogador ferido: pose 'hurt' e invulnerabilidade curta
    enemyBasic: 1.5,                           // recarga do golpe 0 do inimigo
    swapCd: 1, swapIframes: 0.5, downIframes: 1.2,
    comboWindow: 3, skillBuffer: 0.25, captureCd: 0.6,
    capture: { throw: 0.6, shake: 0.6, end: 0.2 },      // voo da bola, cada balançada e a pausa final (s)
    // alcance de lançamento dos golpes de círculo NO ALVO (o alvo precisa estar a esta distância de quem ataca)
    launch: { strike: 1.7, orb: 6.5, bolt: 7, storm: 6, fall: 7, nova: 6, def: 6 },
    eventCap: 4096,
};

// Alcance útil do golpe: círculo no alvo = alcance de lançamento do formato; círculo em quem ataca = raio; linha e cone = comprimento. Puro.
function actionCastReach(profile) {
    const a = profile && profile.area;
    if (!a) return 1.5;
    if (a.kind === 'circle') return a.at === 'self' ? a.r : (ACTION_CORE.launch[profile.shape] || ACTION_CORE.launch.def);
    return a.len;
}
// Fator de velocidade pelo atributo speed (limitado)
function actionSpeedFactor(speed, who) {
    const r = ACTION_CORE.speedRange[who] || ACTION_CORE.speedRange.enemy, s = Math.max(0, Number(speed) || 0);
    return r[0] + (r[1] - r[0]) * s / (s + ACTION_CORE.speedHalf);
}

const _actionProfiles = new Map();
function actionProfileFor(name, type, power) {
    const key = name + '|' + type + '|' + power;
    let p = _actionProfiles.get(key);
    if (!p) { p = moveFxProfile(name, type, power); _actionProfiles.set(key, p); }
    return p;
}

class ActionWorld {
    constructor(game, mapDef, opts = {}) {
        this.game = game; this.map = mapDef; this.opts = opts;
        this.rng = opts.rng || (() => game.rng());
        this.think = opts.think || ActionWorld.defaultThink;
        this.director = opts.director || null;
        this.pilot = opts.pilot || null;
        this.auto = !!opts.auto;
        this.quality = opts.quality || 'medium';
        this.limit = (ACTION_BALANCE.limit && ACTION_BALANCE.limit[this.quality]) || ACTION_BALANCE.limit.medium;
        this.t = 0; this.over = false; this.kills = 0; this.combo = 0; this.comboT = 0; this.credit = 0;
        this.swapCd = 0; this.potionCd = 0; this.captureCd = 0; this.ballId = opts.ballId || null;
        this.enemies = []; this._free = []; this._nextId = 1; this._stepping = false;
        this.input = { mx: 0, mz: 0, dash: false, skill: -1, capture: false, potion: false }; this._skillT = 0;
        // eventos (pool)
        this._pool = []; this._qn = 0; this._drain = []; this._dropped = 0;
        // mapa: grade de bloqueio
        this.w = mapDef.width || (mapDef.rows[0] ? mapDef.rows[0].length : 0); this.h = mapDef.height || mapDef.rows.length;
        this._blk = new Uint8Array(this.w * this.h);
        for (let z = 0; z < this.h; z++) for (let x = 0; x < this.w; x++) this._blk[z * this.w + x] = worldCellBlocked(mapDef, x, z) ? 1 : 0;
        // grade espacial
        this._gw = Math.max(1, Math.ceil(this.w / ACTION_CORE.cell)); this._gh = Math.max(1, Math.ceil(this.h / ACTION_CORE.cell));
        this._gHead = new Int32Array(this._gw * this._gh); this._gNext = new Int32Array(Math.max(64, this.limit + 8)); this._gDirty = true;
        // buffers e objetos reaproveitados
        this._nbuf = []; this._tbuf = []; this._from = { x: 0, z: 0 }; this._to = { x: 0, z: 0 }; this._pt = { x: 0, z: 0 };
        this._critP = null; this._critE = null; this._creditWild = null;
        this._snap = null;
        // jogador
        this.player = this._newEntity('player'); this.player.id = 0;
        const gs = game.gameState, keep = opts.keep || {};
        this.party = gs.party.map((uid, i) => {
            const inst = game._partyInstance(i), stats = game.calculateBattleStats(i);
            if (!inst || !stats) return null;
            const k = keep[uid] || {};
            return { idx: i, uid, speciesId: inst.speciesId, level: inst.level, types: POKEMON_DATA[inst.speciesId].types, stats, maxHp: stats.hp,
                hp: Math.max(0, Math.round(stats.hp * (Number.isFinite(k.hp) ? k.hp : 1))), status: k.status || null, name: getInstanceDisplayName(inst), shiny: !!inst.shiny };
        }).filter(Boolean);
        let am = this.party.find(m => m.idx === gs.activePokemonIndex && m.hp > 0) || this.party.find(m => m.hp > 0);
        this.active = null;
        const sp = opts.start || this._spawnPoint();
        this.player.x = sp.x; this.player.z = sp.z;
        if (am) this._activate(am); else { this.over = true; this.player.alive = false; this.player.state = 'dead'; }
        this.limit = Math.max(1, this.limit);
    }

    // ---------------- entidades ----------------
    _newEntity(kind) {
        return { id: 0, kind, alive: false, speciesId: 0, shiny: false, level: 1, types: null, stats: null, maxHp: 1, hp: 1,
            x: 0, z: 0, vx: 0, vz: 0, face: 0, radius: 0.4, state: 'idle', stateT: 0, tier: 'minion', arch: null, wild: null, partyIndex: -1, inst: null,
            moves: [], want: { mx: 0, mz: 0, cast: -1, aimX: NaN, aimZ: NaN }, knockX: 0, knockZ: 0, stun: 0, iframes: 0, status: null, seed: 0,
            speedMul: 1, invMass: 1, castIdx: -1, castT: 0, castDur: 0, castTx: 0, castTz: 0, recT: 0, hurtT: 0, dashT: 0, dashVx: 0, dashVz: 0, dashCd: 0,
            guard: 0, windupMul: 1, mass: 0, capT: -1, capShakes: 0, capCaught: false, capBall: null, capStage: 0, hurt: false };
    }
    _setMoves(e, list) {
        for (let i = 0; i < list.length; i++) {
            const src = list[i], prof = actionProfileFor(src.name, src.type, src.power);
            let m = e.moves[i];
            if (!m) m = e.moves[i] = { name: '', type: '', power: 0, cd: 0, cdMax: 0, profile: null, tl: null };
            m.name = src.name; m.type = src.type; m.power = src.power; m.profile = prof; m.tl = [src.type];
            m.cdMax = (e.kind === 'player' ? (i === 0 ? ACTION_BALANCE.basicInterval : actionSkillCooldown(src.power)) : (i === 0 ? ACTION_CORE.enemyBasic : actionSkillCooldown(src.power)));
        }
        e.moves.length = list.length;
    }
    _spawnPoint() {
        const sp = this.map.spawn;
        if (sp && !this._blockedAt(Math.floor(sp.x), Math.floor(sp.y))) return { x: sp.x + 0.5, z: sp.y + 0.5 };
        for (let z = 0; z < this.h; z++) for (let x = 0; x < this.w; x++) if (!this._blk[z * this.w + x]) return { x: x + 0.5, z: z + 0.5 };
        return { x: 1.5, z: 1.5 };
    }
    _activate(m) {
        const p = this.player, g = this.game, inst = g._partyInstance(m.idx);
        this.active = m;
        p.alive = true; p.speciesId = m.speciesId; p.shiny = m.shiny; p.level = m.level; p.types = m.types; p.stats = m.stats; p.maxHp = m.maxHp; p.hp = m.hp;
        p.partyIndex = m.idx; p.inst = inst; p.radius = ACTION_CORE.radius.player; p.status = m.status;
        this._setMoves(p, this._movesFor(inst));
        for (const mv of p.moves) mv.cd = 0;
        p.state = 'idle'; p.stateT = 0; p.castIdx = -1; p.recT = 0; p.dashT = 0; p.stun = 0; p.hurtT = 0;
    }
    _movesFor(inst) {
        const skill = this.game.getSkillForInstance(inst);
        return exploreMoveset(inst.speciesId, skill ? skill.skillLevel : exploreSkillLevelFor(inst.level));
    }
    _syncActive() { const m = this.active; if (m && this.player.alive) { m.hp = Math.max(0, this.player.hp); } else if (m && this.player.hp <= 0) m.hp = 0; }
    // Vida entre Pokémon no formato do Explorar: { [uid]: { hp: fração, status, pp } }
    keep() {
        this._syncActive();
        const out = {};
        for (const m of this.party) out[m.uid] = { hp: m.hp / m.maxHp, status: m.status || null, pp: {} };
        return out;
    }

    // ---------------- entrada ----------------
    setInput(inp) {
        if (!inp) return;
        const i = this.input;
        if (Number.isFinite(inp.mx)) i.mx = inp.mx;
        if (Number.isFinite(inp.mz)) i.mz = inp.mz;
        if (inp.dash) i.dash = true;
        if (inp.capture) i.capture = true;
        if (inp.potion) i.potion = true;
        if (Number.isInteger(inp.skill) && inp.skill >= 0) { i.skill = inp.skill; this._skillT = ACTION_CORE.skillBuffer; }
    }

    // ---------------- eventos (pool) ----------------
    _ev(t) {
        if (this._qn >= ACTION_CORE.eventCap) { this._dropped++; this._qn = ACTION_CORE.eventCap - 1; }
        let e = this._pool[this._qn];
        if (!e) e = this._pool[this._qn] = { t: '', id: 0, by: 0, dmg: 0, crit: false, eff: 1, kx: 0, kz: 0, x: 0, z: 0, tx: 0, tz: 0, move: 0, tier: '', exp: 0, gold: 0,
            growth: null, from: 0, to: 0, stage: '', ball: '', n: 0, kind: '', count: 0, partyIndex: 0, amount: 0 };
        this._qn++;
        e.t = t; e.id = 0; e.by = 0; e.dmg = 0; e.crit = false; e.eff = 1; e.kx = 0; e.kz = 0; e.x = 0; e.z = 0; e.tx = 0; e.tz = 0; e.move = 0; e.tier = '';
        e.exp = 0; e['gold'] = 0; e.growth = null; e.from = 0; e.to = 0; e.stage = ''; e.ball = ''; e.n = 0; e.kind = ''; e.count = 0; e.partyIndex = 0; e.amount = 0;
        return e;
    }
    // Devolve e esvazia a fila. O vetor e os objetos são reaproveitados: não guarde a referência.
    drainEvents() {
        const d = this._drain; d.length = 0;
        for (let i = 0; i < this._qn; i++) d.push(this._pool[i]);
        this._qn = 0;
        return d;
    }

    // ---------------- mapa e colisão ----------------
    _blockedAt(cx, cz) { return cx < 0 || cz < 0 || cx >= this.w || cz >= this.h || this._blk[cz * this.w + cx] === 1; }
    // O círculo (x, z, r) encosta numa célula bloqueada?
    _blocked(x, z, r) {
        const cx0 = Math.floor(x - r), cx1 = Math.floor(x + r), cz0 = Math.floor(z - r), cz1 = Math.floor(z + r), r2 = r * r;
        for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
            if (!this._blockedAt(cx, cz)) continue;
            const nx = x < cx ? cx : x > cx + 1 ? cx + 1 : x, nz = z < cz ? cz : z > cz + 1 ? cz + 1 : z, dx = x - nx, dz = z - nz;
            if (dx * dx + dz * dz < r2) return true;
        }
        return false;
    }
    // Desloca o corpo testando o eixo x e o eixo z separadamente (desliza na parede), em sub-passos para não atravessar. Devolve true se bateu.
    _slide(e, dx, dz) {
        const m = Math.max(Math.abs(dx), Math.abs(dz));
        if (m < 1e-9) return false;
        const n = Math.ceil(m / 0.25), sx = dx / n, sz = dz / n; let hit = false;
        for (let i = 0; i < n; i++) {
            if (sx !== 0) { const nx = e.x + sx; if (!this._blocked(nx, e.z, e.radius)) e.x = nx; else { hit = true; e.vx = 0; e.knockX = 0; } }
            if (sz !== 0) { const nz = e.z + sz; if (!this._blocked(e.x, nz, e.radius)) e.z = nz; else { hit = true; e.vz = 0; e.knockZ = 0; } }
        }
        return hit;
    }

    // ---------------- grade espacial ----------------
    _cellOf(v, n) { const c = Math.floor(v / ACTION_CORE.cell); return c < 0 ? 0 : c >= n ? n - 1 : c; }
    _rebuildGrid() {
        const en = this.enemies, n = en.length;
        if (this._gNext.length < n) this._gNext = new Int32Array(n * 2);
        this._gHead.fill(-1);
        for (let i = 0; i < n; i++) {
            const e = en[i];
            if (!e.alive) { this._gNext[i] = -1; continue; }
            const c = this._cellOf(e.z, this._gh) * this._gw + this._cellOf(e.x, this._gw);
            this._gNext[i] = this._gHead[c]; this._gHead[c] = i;
        }
        this._gDirty = false;
    }
    // Inimigos vivos com o centro num raio r de (x, z). Preenche e devolve `out`.
    near(x, z, r, out) {
        out.length = 0;
        if (this._gDirty) this._rebuildGrid();
        const x0 = this._cellOf(x - r, this._gw), x1 = this._cellOf(x + r, this._gw), z0 = this._cellOf(z - r, this._gh), z1 = this._cellOf(z + r, this._gh), r2 = r * r, en = this.enemies;
        for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
            for (let i = this._gHead[cz * this._gw + cx]; i >= 0; i = this._gNext[i]) {
                const e = en[i];
                if (!e.alive) continue;
                const dx = e.x - x, dz = e.z - z;
                if (dx * dx + dz * dz <= r2) out.push(e);
            }
        }
        return out;
    }

    // ---------------- inimigos ----------------
    // spec = { wild, tier, arch, radius?, speedMul? }. Devolve a entidade ou null (limite, célula bloqueada ou selvagem inválido).
    spawnEnemy(spec, x, z) {
        if (this.over || this.enemies.length >= this.limit || !spec || !spec.wild || !POKEMON_DATA[spec.wild.id]) return null;
        const tier = ACTION_BALANCE.hpMul[spec.tier] ? spec.tier : 'minion', radius = spec.radius || ACTION_CORE.radius[tier];
        if (this._blocked(x, z, radius)) return null;
        const g = this.game, wild = spec.wild, e = this._free.pop() || this._newEntity('enemy');
        const st = g.calculateStats(wild);
        e.id = this._nextId++; e.kind = 'enemy'; e.alive = true; e.speciesId = wild.id; e.shiny = !!wild.isShiny; e.level = wild.level;
        e.types = POKEMON_DATA[wild.id].types; e.stats = st; e.maxHp = actionEnemyHp(st.hp, tier); e.hp = e.maxHp;
        e.x = x; e.z = z; e.vx = 0; e.vz = 0; e.face = 0; e.radius = radius; e.state = 'idle'; e.stateT = 0; e.tier = tier; e.arch = spec.arch || null; e.wild = wild;
        e.partyIndex = -1; e.inst = null; e.knockX = 0; e.knockZ = 0; e.stun = 0; e.iframes = 0; e.status = null; e.seed = (this._nextId * 2654435761) >>> 0;
        e.speedMul = Number.isFinite(spec.speedMul) ? spec.speedMul : 1; e.invMass = ACTION_CORE.invMass[tier];
        e.castIdx = -1; e.castT = 0; e.recT = 0; e.hurtT = 0; e.dashT = 0; e.capT = -1; e.hurt = false; e.guard = 0; e.windupMul = 1; e.mass = 0;
        e.want.mx = 0; e.want.mz = 0; e.want.cast = -1; e.want.aimX = NaN; e.want.aimZ = NaN;
        this._setMoves(e, exploreMoveset(wild.id, exploreSkillLevelFor(wild.level)));
        for (let i = 0; i < e.moves.length; i++) e.moves[i].cd = this.rng() * 0.8;
        this.enemies.push(e); this._gDirty = true;
        this._ev('spawn').id = e.id;
        return e;
    }
    despawn(e) {
        if (!e || !e.alive || e.kind !== 'enemy') return;
        e.alive = false;
        if (!this._stepping) this._compact();
    }
    _compact() {
        const en = this.enemies;
        for (let i = en.length - 1; i >= 0; i--) {
            if (en[i].alive) continue;
            const dead = en[i]; en[i] = en[en.length - 1]; en.pop();
            dead.wild = null; this._free.push(dead);
        }
        this._gDirty = true;
    }

    // Padrão de IA: anda até o jogador e usa o golpe 0 quando estiver ao alcance
    static defaultThink(world, e) {
        const p = world.player, w = e.want, dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz);
        w.aimX = p.x; w.aimZ = p.z;
        const reach = e.moves.length ? actionCastReach(e.moves[0].profile) : 1.5;
        if (d <= reach * 0.85) { w.mx = 0; w.mz = 0; w.cast = 0; }
        else { w.mx = d > 1e-6 ? dx / d : 0; w.mz = d > 1e-6 ? dz / d : 0; w.cast = -1; }
    }

    // ---------------- passo ----------------
    step(dt) {
        if (this.over || !(dt > 0)) return;
        if (dt > 0.1) dt = 0.1;
        this._stepping = true; this.t += dt; this._critP = null; this._critE = null;
        if (this.director && this.director.update) this.director.update(dt);
        const p = this.player, en = this.enemies;
        // intenção do jogador
        const inp = this.input;
        if (this.auto && this.pilot) this.pilot(this, dt);
        else { p.want.mx = inp.mx; p.want.mz = inp.mz; p.want.cast = -1; }
        // intenção dos inimigos (cada um decide; o orçamento por passo é de quem implementa `think`)
        for (let i = 0; i < en.length; i++) { const e = en[i]; if (e.alive && e.state !== 'balled') this.think(this, e, dt); }
        this._timers(dt);
        this._playerActions(dt);
        this._enemyStarts();
        this._moveAll(dt);
        this._rebuildGrid();
        this._separate();
        this._advance(dt);
        this._captures(dt);
        inp.dash = false; inp.capture = false; inp.potion = false;
        this._stepping = false;
        this._compact();
        this._settleCredit();
        this._checkPlayer();
        this._updateStates();
    }

    _timers(dt) {
        const p = this.player, en = this.enemies;
        if (this.swapCd > 0) this.swapCd -= dt;
        if (this.potionCd > 0) this.potionCd -= dt;
        if (this.captureCd > 0) this.captureCd -= dt;
        if (this._skillT > 0) { this._skillT -= dt; if (this._skillT <= 0) this.input.skill = -1; }
        if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
        this._tickEntity(p, dt);
        for (let i = 0; i < en.length; i++) if (en[i].alive) this._tickEntity(en[i], dt);
    }
    _tickEntity(e, dt) {
        if (e.stun > 0) e.stun -= dt;
        if (e.iframes > 0) e.iframes -= dt;
        if (e.hurtT > 0) e.hurtT -= dt;
        if (e.dashCd > 0) e.dashCd -= dt;
        e.stateT += dt;
        for (let i = 0; i < e.moves.length; i++) { const m = e.moves[i]; if (m.cd > 0) { m.cd -= dt; if (m.cd < 0) m.cd = 0; } }
    }

    _canAct(e) { return e.alive && e.stun <= 0 && e.dashT <= 0 && e.castIdx < 0 && e.state !== 'balled' && e.state !== 'dead'; }

    // ---------------- ações do jogador ----------------
    _playerActions(dt) {
        const p = this.player, inp = this.input, w = p.want;
        if (!p.alive) return;
        if (inp.potion) this._usePotion();
        if (inp.capture) this._tryCapture();
        if (inp.dash && p.dashCd <= 0 && p.dashT <= 0 && p.stun <= 0) this._dash();
        if (!this._canAct(p)) return;
        // golpe pedido pelo piloto (w.cast) ou pela entrada (com buffer); o pedido à mão pode sair sem alvo (mira no rosto)
        let want = w.cast, manual = false;
        if (want < 0 && inp.skill >= 0) { want = inp.skill; manual = true; }
        if (want >= p.moves.length) { if (manual) { inp.skill = -1; this._skillT = 0; } want = -1; }
        if (want >= 0 && p.moves[want].cd <= 0 && this._playerCast(want, manual, !manual)) {
            if (manual) { inp.skill = -1; this._skillT = 0; }
            return;
        }
        if (p.moves.length && p.moves[0].cd <= 0) this._playerCast(0, false);
    }
    // Começa o golpe `idx` do jogador. force = mesmo sem inimigo ao alcance, mira na direção do rosto (golpe pedido à mão).
    // aim = usa w.aimX/aimZ (piloto automático) quando forem números finitos, sem procurar alvo
    _playerCast(idx, force, aim) {
        const p = this.player, mv = p.moves[idx], prof = mv.profile, reach = actionCastReach(prof), w = p.want;
        const useAim = aim && Number.isFinite(w.aimX) && Number.isFinite(w.aimZ);
        const t = useAim ? null : this._pickTarget(p, reach, w.mx, w.mz);
        let tx, tz;
        if (useAim) { tx = w.aimX; tz = w.aimZ; }
        else if (t) { tx = t.x; tz = t.z; }
        else if (force) {
            const a = prof.area, d = a.kind === 'circle' && a.at === 'self' ? 0 : Math.min(reach, 3);
            tx = p.x + Math.sin(p.face) * d; tz = p.z + Math.cos(p.face) * d;
        } else return false;
        this._beginCast(p, idx, tx, tz);
        return true;
    }
    // Inimigo mais próximo dentro do alcance (centro); com movimento, prefere o da frente.
    _pickTarget(from, reach, dirx, dirz) {
        const buf = this.near(from.x, from.z, reach, this._tbuf), moving = Math.hypot(dirx, dirz) > 0.1;
        let best = null, bs = 1e9;
        const ln = moving ? Math.hypot(dirx, dirz) : 1;
        for (let i = 0; i < buf.length; i++) {
            const e = buf[i];
            if (e.state === 'balled') continue;
            const dx = e.x - from.x, dz = e.z - from.z, d = Math.hypot(dx, dz);
            let s = d;
            if (moving && d > 1e-6) s -= 1.5 * Math.max(0, (dx * dirx + dz * dirz) / (d * ln));
            if (s < bs) { bs = s; best = e; }
        }
        return best;
    }
    _beginCast(e, idx, tx, tz) {
        const mv = e.moves[idx];
        e.castIdx = idx; e.castT = 0; e.castDur = mv.profile.hitAt * (e.windupMul || 1); e.castTx = tx;   // windupMul: o chefe anuncia golpes de área
        e.castTz = tz; e.state = 'windup'; e.stateT = 0;
        const dx = tx - e.x, dz = tz - e.z;
        if (dx * dx + dz * dz > 1e-6) e.face = Math.atan2(dx, dz);
        mv.cd = mv.cdMax;
        const ev = this._ev('cast'); ev.id = e.id; ev.move = idx; ev.x = e.x; ev.z = e.z; ev.tx = tx; ev.tz = tz;
    }
    _cancelCast(e) { e.castIdx = -1; e.castT = 0; e.recT = 0; if (e.state === 'windup' || e.state === 'attack') e.state = 'idle'; }

    _dash() {
        const p = this.player, w = p.want, cfg = ACTION_BALANCE.dash;
        let dx = w.mx, dz = w.mz, d = Math.hypot(dx, dz);
        if (d < 0.1) { dx = Math.sin(p.face); dz = Math.cos(p.face); d = 1; }
        dx /= d; dz /= d;
        this._cancelCast(p);
        p.dashT = cfg.time; p.dashVx = dx * cfg.dist / cfg.time; p.dashVz = dz * cfg.dist / cfg.time; p.dashCd = cfg.cd;
        p.iframes = Math.max(p.iframes, cfg.iframes); p.face = Math.atan2(dx, dz); p.state = 'move';
        this._ev('dash');
    }

    _usePotion() {
        const p = this.player, g = this.game;
        if (this.potionCd > 0 || !p.alive) return false;
        const inv = g.ensureInventory();
        if (!inv || inv.potions <= 0 || p.hp >= p.maxHp) return false;
        const before = p.hp;
        p.hp = Math.min(p.maxHp, p.hp + potionHealAmount(p.maxHp, g.getPotionHealPercent()));
        inv.potions--; this.potionCd = ACTION_BALANCE.potionCd; this._syncActive();
        g._emit('heal', { potion: true, reason: 'action', amount: p.hp - before, hpBefore: before, hpAfter: p.hp, maxHp: p.maxHp, revived: false, potionsLeft: inv.potions, price: g.getPotionPrice() });
        g.save();
        this._ev('heal').amount = p.hp - before;
        return true;
    }

    // ---------------- captura (não bloqueante) ----------------
    _ballType() {
        const g = this.game;
        if (this.ballId) return g.getBallCount(this.ballId) > 0 ? getBallType(this.ballId) : null;
        return chooseBall(g.getBalls(), false);
    }
    // Inimigo mais próximo com vida <= captureHpFrac dentro de captureRange
    _captureTarget() {
        const p = this.player, en = this.enemies, R2 = ACTION_BALANCE.captureRange * ACTION_BALANCE.captureRange;
        let best = null, bd = 1e9;
        for (let i = 0; i < en.length; i++) {
            const e = en[i];
            if (!e.alive || e.state === 'balled' || e.hp / e.maxHp > ACTION_BALANCE.captureHpFrac) continue;
            const dx = e.x - p.x, dz = e.z - p.z, d = dx * dx + dz * dz;
            if (d <= R2 && d < bd) { bd = d; best = e; }
        }
        return best;
    }
    _tryCapture() {
        if (this.captureCd > 0 || !this.player.alive) return false;
        const t = this._captureTarget(), ball = t && this._ballType();
        if (!t || !ball) return false;
        const r = this.game.exploreCapture(t.wild, ball.id, t.hp / t.maxHp, false);
        if (!r || !r.ok) return false;
        this.captureCd = ACTION_CORE.captureCd;
        this._cancelCast(t); t.state = 'balled'; t.stateT = 0; t.vx = 0; t.vz = 0; t.knockX = 0; t.knockZ = 0; t.want.cast = -1;
        t.capT = 0; t.capShakes = Math.min(3, r.shakes | 0); t.capCaught = !!r.caught; t.capBall = ball.id; t.capStage = 0;
        const ev = this._ev('capture'); ev.id = t.id; ev.stage = 'throw'; ev.ball = ball.id;
        return true;
    }
    _captures(dt) {
        const en = this.enemies, C = ACTION_CORE.capture;
        for (let i = 0; i < en.length; i++) {
            const e = en[i];
            if (!e.alive || e.capT < 0) continue;
            e.capT += dt;
            while (e.capStage < e.capShakes && e.capT >= C.throw + C.shake * e.capStage) {
                const ev = this._ev('capture'); ev.id = e.id; ev.stage = 'shake'; ev.ball = e.capBall; ev.n = e.capStage + 1; e.capStage++;
            }
            if (e.capT >= C.throw + C.shake * Math.max(1, e.capShakes) + C.end) {
                const ev = this._ev('capture'); ev.id = e.id; ev.ball = e.capBall;
                if (e.capCaught) { ev.stage = 'caught'; e.alive = false; }
                else { ev.stage = 'free'; e.state = 'idle'; e.stateT = 0; e.capT = -1; }
            }
        }
    }

    // ---------------- inimigos começam golpes ----------------
    _enemyStarts() {
        const p = this.player, en = this.enemies;
        if (!p.alive) return;
        for (let i = 0; i < en.length; i++) {
            const e = en[i], w = e.want;
            if (!e.alive || w.cast < 0 || w.cast >= e.moves.length || !this._canAct(e) || e.moves[w.cast].cd > 0) continue;
            this._beginCast(e, w.cast, Number.isFinite(w.aimX) ? w.aimX : p.x, Number.isFinite(w.aimZ) ? w.aimZ : p.z);
        }
    }

    // ---------------- movimento ----------------
    _moveAll(dt) {
        this._moveEntity(this.player, dt, true);
        const en = this.enemies;
        for (let i = 0; i < en.length; i++) if (en[i].alive) this._moveEntity(en[i], dt, false);
        this._gDirty = true;
    }
    _moveEntity(e, dt, isPlayer) {
        const w = e.want;
        if (!e.alive || e.state === 'balled') return;
        if (e.dashT > 0) {
            e.dashT -= dt;
            e.vx = e.dashVx; e.vz = e.dashVz;
            this._slide(e, e.vx * dt, e.vz * dt);
            if (e.dashT <= 0) { e.vx *= 0.4; e.vz *= 0.4; }
            return;
        }
        let mx = w.mx, mz = w.mz;
        if (e.stun > 0) { mx = 0; mz = 0; }
        const len = Math.hypot(mx, mz);
        if (len > 1) { mx /= len; mz /= len; }
        const base = isPlayer ? ACTION_BALANCE.playerSpeed * actionSpeedFactor(e.stats.speed, 'player') : ACTION_BALANCE.enemySpeed * e.speedMul * actionSpeedFactor(e.stats.speed, 'enemy');
        let mul = 1;
        if (e.state === 'windup') mul = ACTION_CORE.moveMul.windup[isPlayer ? 0 : 1]; else if (e.state === 'attack') mul = ACTION_CORE.moveMul.attack[isPlayer ? 0 : 1];
        const tvx = mx * base * mul, tvz = mz * base * mul;
        const dvx = tvx - e.vx, dvz = tvz - e.vz, dl = Math.hypot(dvx, dvz);
        if (dl > 1e-9) {
            const slowing = tvx * tvx + tvz * tvz < e.vx * e.vx + e.vz * e.vz;
            const maxd = ACTION_BALANCE.accel * (slowing ? ACTION_CORE.decelMul : 1) * dt;
            if (dl <= maxd) { e.vx = tvx; e.vz = tvz; } else { e.vx += dvx / dl * maxd; e.vz += dvz / dl * maxd; }
        }
        this._slide(e, (e.vx + e.knockX) * dt, (e.vz + e.knockZ) * dt);
        const k = Math.max(0, 1 - ACTION_CORE.knockDamp * dt);
        e.knockX *= k; e.knockZ *= k;
        if (e.knockX * e.knockX + e.knockZ * e.knockZ < 1e-4) { e.knockX = 0; e.knockZ = 0; }
        if (e.castIdx < 0 && len > 0.1 && mul > 0) e.face = Math.atan2(mx, mz);
    }

    // ---------------- separação entre corpos ----------------
    _separate() {
        const en = this.enemies, n = en.length, sep = ACTION_CORE.separation, gw = this._gw, gh = this._gh, p = this.player;
        for (let i = 0; i < n; i++) {
            const a = en[i];
            if (!a.alive) continue;
            const cx = this._cellOf(a.x, gw), cz = this._cellOf(a.z, gh);
            for (let oz = cz - 1; oz <= cz + 1; oz++) {
                if (oz < 0 || oz >= gh) continue;
                for (let ox = cx - 1; ox <= cx + 1; ox++) {
                    if (ox < 0 || ox >= gw) continue;
                    for (let j = this._gHead[oz * gw + ox]; j >= 0; j = this._gNext[j]) {
                        if (j <= i) continue;
                        const b = en[j];
                        if (!b.alive) continue;
                        this._pushApart(a, b, this._inv(a), this._inv(b), sep, i);
                    }
                }
            }
            if (p.alive) this._pushApart(a, p, this._inv(a), p.dashT > 0 ? 0 : ACTION_CORE.invMass.player, sep, i);
        }
    }
    // quanto o corpo cede na separação: balled não cede; `mass` (se houver) manda; senão o padrão do tier
    _inv(e) { return e.state === 'balled' ? 0 : e.mass > 0 ? 1 / e.mass : e.invMass; }
    _pushApart(a, b, ia, ib, sep, salt) {
        const dx = a.x - b.x, dz = a.z - b.z, min = a.radius + b.radius, d2 = dx * dx + dz * dz;
        if (d2 >= min * min || ia + ib <= 0) return;
        const d = Math.sqrt(d2);
        let nx, nz;
        if (d > 1e-6) { nx = dx / d; nz = dz / d; } else { nx = (salt & 1) ? 1 : -1; nz = 0; }
        const corr = (min - d) * sep, tot = ia + ib, ca = corr * ia / tot, cb = corr * ib / tot;
        if (ca > 0) this._slide(a, nx * ca, nz * ca);
        if (cb > 0) this._slide(b, -nx * cb, -nz * cb);
    }

    // ---------------- golpes: preparo, impacto, recuperação ----------------
    _advance(dt) {
        this._advanceCast(this.player, dt);
        const en = this.enemies;
        for (let i = 0; i < en.length; i++) if (en[i].alive) this._advanceCast(en[i], dt);
    }
    _advanceCast(e, dt) {
        if (e.castIdx < 0) return;
        if (e.state === 'windup') {
            e.castT += dt;
            if (e.castT >= e.castDur) {
                const mv = e.moves[e.castIdx], prof = mv.profile;
                this._impact(e, mv);
                e.state = 'attack'; e.stateT = 0; e.recT = Math.max(0.12, (prof.dur - prof.hitAt) * 0.5);
            }
        } else if (e.state === 'attack') {
            e.recT -= dt;
            if (e.recT <= 0) { e.castIdx = -1; e.state = 'idle'; e.stateT = 0; }
        } else e.castIdx = -1;
    }
    // O impacto: todo alvo cujo centro está dentro de moveFxCovers(perfil, de, para, ponto) leva dano. `de` = quem ataca, `para` = ponto mirado.
    _impact(att, mv) {
        const prof = mv.profile, a = prof.area, from = this._from, to = this._to, pt = this._pt;
        from.x = att.x; from.z = att.z; to.x = att.castTx; to.z = att.castTz;
        if (att.kind === 'enemy') {
            const p = this.player;
            if (!p.alive || p.iframes > 0) return;
            pt.x = p.x; pt.z = p.z;
            if (moveFxCovers(prof, from, to, pt)) this._hit(att, p, mv);
            return;
        }
        let cx, cz, R;
        if (a.kind === 'circle') { cx = a.at === 'self' ? from.x : to.x; cz = a.at === 'self' ? from.z : to.z; R = a.r; }
        else if (a.kind === 'line') { cx = from.x; cz = from.z; R = a.len + a.width / 2; }
        else { cx = from.x; cz = from.z; R = a.len; }
        const buf = this.near(cx, cz, R + 1, this._nbuf);
        for (let i = 0; i < buf.length; i++) {
            const e = buf[i];
            if (!e.alive || e.state === 'balled') continue;
            pt.x = e.x; pt.z = e.z;
            if (moveFxCovers(prof, from, to, pt)) this._hit(att, e, mv);
        }
    }
    _hit(att, def, mv) {
        const g = this.game, isPlayer = att.kind === 'player', prof = mv.profile, C = ACTION_CORE;
        let crit;
        if (isPlayer) crit = this._critP || (this._critP = g._getCritParams(true)); else crit = this._critE || (this._critE = g._getCritParams(false));
        const r = g._computeDamage(att.level, att.stats.attack, def.stats.defense, mv.tl, def.types, mv.power, crit.rate, crit.multiplier);
        const dmg = Math.max(1, Math.round(r.damage * (isPlayer ? ACTION_BALANCE.playerDamageMul : ACTION_BALANCE.enemyDamageMul) * (1 - (def.guard || 0))));   // guard: casulo endurece
        def.hp = Math.max(0, def.hp - dmg);
        // empurrão e atordoamento
        let dx = def.x - att.x, dz = def.z - att.z; const d = Math.hypot(dx, dz);
        if (d > 1e-6) { dx /= d; dz /= d; } else { dx = Math.sin(att.face); dz = Math.cos(att.face); }
        const sh = prof.shape, kb = (C.knock[sh] || C.knock.def) * (isPlayer ? C.knockTier[def.tier] : C.knockPlayer);
        def.knockX = dx * kb; def.knockZ = dz * kb;
        if (isPlayer) {
            const st = (C.stun[sh] || C.stun.def) * C.stunTier[def.tier];
            if (st > 0) { def.stun = Math.max(def.stun, st); if (def.state === 'windup') this._cancelCast(def); }
            def.hurtT = C.hurtT;
        } else { def.iframes = Math.max(def.iframes, C.hurtIframes); def.hurtT = C.hurtT; this._syncActive(); }
        const ev = this._ev('hit'); ev.id = def.id; ev.by = att.id; ev.dmg = dmg; ev.crit = !!r.criticalHit; ev.eff = r.typeEffectiveness; ev.kx = def.knockX; ev.kz = def.knockZ;
        if (def.hp <= 0 && def.kind === 'enemy') this._kill(def);
    }
    _kill(e) {
        e.alive = false; e.hp = 0;
        this.kills++; this.combo++; this.comboT = ACTION_CORE.comboWindow;
        const ev = this._ev('die'); ev.id = e.id; ev.x = e.x; ev.z = e.z; ev.tier = e.tier;
        this.credit += ACTION_BALANCE.rewardCredit[e.tier] || 0;
        this._creditWild = e.wild;
    }

    // ---------------- recompensa pelo banco de crédito ----------------
    _settleCredit() {
        while (this.credit >= 1 - 1e-9 && this._creditWild && this.active) {
            this.credit -= 1;
            this._victory(this._creditWild);
        }
        if (this.credit < 0) this.credit = 0;
    }
    _victory(wild) {
        const g = this.game, p = this.player, m = this.active;
        if (!g.actionVictory) return;
        this._syncActive();
        const beforeSp = m.speciesId, beforeLv = m.level;
        const r = g.actionVictory(wild, m.idx, p.maxHp, p.hp);
        const ev = this._ev('reward'); ev.exp = r.expGained | 0; ev['gold'] = r.goldGained | 0;
        this._refreshParty();
        if (m.speciesId !== beforeSp) { const e2 = this._ev('evolve'); e2.from = beforeSp; e2.to = m.speciesId; }
        if (m.level > beforeLv || m.speciesId !== beforeSp) { const e3 = this._ev('level'); e3.growth = r.growth || null; e3.partyIndex = m.idx; }
    }
    // Recalcula atributos e golpes da equipe depois de EXP: a vida máxima que cresceu entra na vida atual
    _refreshParty() {
        const g = this.game, p = this.player;
        for (const m of this.party) {
            const inst = g._partyInstance(m.idx), s = inst && g.calculateBattleStats(m.idx);
            if (!inst || !s) continue;
            const grow = s.hp - m.maxHp;
            m.level = inst.level; m.stats = s; m.maxHp = s.hp;
            if (inst.speciesId !== m.speciesId) { m.speciesId = inst.speciesId; m.types = POKEMON_DATA[inst.speciesId].types; m.name = getInstanceDisplayName(inst); }
            const live = m === this.active ? p.hp : m.hp;
            m.hp = live > 0 ? Math.max(1, Math.min(s.hp, live + Math.max(0, grow))) : 0;
            if (m === this.active) {
                p.level = m.level; p.stats = s; p.maxHp = s.hp; p.hp = m.hp; p.speciesId = m.speciesId; p.types = m.types; p.inst = inst;
                const old = p.moves.map(x => [x.name, x.cd]);
                this._setMoves(p, this._movesFor(inst));
                for (const mv of p.moves) { const o = old.find(x => x[0] === mv.name); if (o) mv.cd = o[1]; }
            }
        }
    }

    // ---------------- troca e derrota ----------------
    swapPlayer(partyIndex) {
        if (this.over || this.swapCd > 0) return false;
        const m = this.party.find(x => x.idx === partyIndex);
        if (!m || m === this.active || m.hp <= 0) return false;
        this._syncActive();
        this._activate(m);
        this.swapCd = ACTION_CORE.swapCd; this.player.iframes = Math.max(this.player.iframes, ACTION_CORE.swapIframes);
        this._ev('swap').partyIndex = m.idx;
        return true;
    }
    _checkPlayer() {
        const p = this.player;
        if (this.over || !p.alive || p.hp > 0) return;
        p.hp = 0; this._syncActive();
        this._ev('down');
        const next = this.party.find(m => m.hp > 0 && m !== this.active);
        if (next) {
            this._activate(next); p.iframes = ACTION_CORE.downIframes; this._ev('swap').partyIndex = next.idx;
        } else {
            this.over = true; p.alive = false; p.state = 'dead'; this._ev('wipe');
        }
    }

    // ---------------- estado de animação ----------------
    _updateStates() {
        const p = this.player, en = this.enemies;
        this._stateOf(p);
        for (let i = 0; i < en.length; i++) if (en[i].alive) this._stateOf(en[i]);
    }
    _stateOf(e) {
        if (e.state === 'balled' || e.state === 'dead' || e.state === 'windup' || e.state === 'attack') return;
        const s = e.hurtT > 0 ? 'hurt' : (e.vx * e.vx + e.vz * e.vz > 0.25 || e.dashT > 0) ? 'move' : 'idle';
        if (s !== e.state) { e.state = s; e.stateT = 0; }
    }

    // ---------------- HUD ----------------
    snapshot() {
        const g = this.game, p = this.player, m = this.active, s = this._snap || (this._snap = {
            player: { name: '', speciesId: 0, shiny: false, level: 1, hp: 0, maxHp: 1, expFrac: 0, types: null }, skills: [], dash: { cd: 0, cdMax: 0 },
            wave: { n: 0, kind: '', left: 0, total: 0, nextIn: 0 }, boss: null, auto: false, kills: 0, combo: 0, potions: 0, ball: { id: '', count: 0 }, captureReady: false, party: [], over: false });
        this._syncActive();
        const sp = s.player, inst = m && g._partyInstance(m.idx);
        sp.name = m ? m.name : ''; sp.speciesId = p.speciesId; sp.shiny = p.shiny; sp.level = p.level; sp.hp = Math.max(0, Math.round(p.hp)); sp.maxHp = p.maxHp; sp.types = p.types;
        sp.expFrac = inst ? exploreExpFrac(inst.speciesId, inst.level, inst.exp) : 0;
        const sk = s.skills;
        for (let i = 0; i < p.moves.length; i++) {
            const mv = p.moves[i]; let o = sk[i];
            if (!o) o = sk[i] = { name: '', type: '', cd: 0, cdMax: 0, shape: '', label: '' };
            o.name = mv.name; o.type = mv.type; o.cd = Math.max(0, mv.cd); o.cdMax = mv.cdMax; o.shape = mv.profile.shape; o.label = mv.profile.label;
        }
        sk.length = p.moves.length;
        s.dash.cd = Math.max(0, p.dashCd); s.dash.cdMax = ACTION_BALANCE.dash.cd;
        const ws = this.director && this.director.state;
        s.wave.n = (ws && ws.n) || 0; s.wave.kind = (ws && ws.kind) || ''; s.wave.left = (ws && ws.left) || 0; s.wave.total = (ws && ws.total) || 0; s.wave.nextIn = (ws && ws.nextIn) || 0;
        let boss = null;
        for (let i = 0; i < this.enemies.length; i++) { const e = this.enemies[i]; if (e.alive && e.tier === 'boss') { boss = e; break; } }
        if (boss) {
            if (!s.boss) s.boss = { name: '', speciesId: 0, hp: 0, maxHp: 1 };
            s.boss.name = POKEMON_DATA[boss.speciesId].name; s.boss.speciesId = boss.speciesId; s.boss.hp = boss.hp; s.boss.maxHp = boss.maxHp;
        } else s.boss = null;
        s.auto = !!this.auto; s.kills = this.kills; s.combo = this.combo;
        const inv = g.ensureInventory(), ball = this._ballType();
        s.potions = inv ? inv.potions : 0; s.ball.id = ball ? ball.id : ''; s.ball.count = ball ? g.getBallCount(ball.id) : 0;
        s.captureReady = !!(ball && this.captureCd <= 0 && this._captureTarget());
        const pa = s.party;
        for (let i = 0; i < this.party.length; i++) {
            const q = this.party[i]; let o = pa[i];
            if (!o) o = pa[i] = { partyIndex: 0, speciesId: 0, shiny: false, hp01: 0, alive: false, active: false };
            o.partyIndex = q.idx; o.speciesId = q.speciesId; o.shiny = q.shiny; o.hp01 = q.maxHp > 0 ? q.hp / q.maxHp : 0; o.alive = q.hp > 0; o.active = q === m;
        }
        pa.length = this.party.length;
        s.over = this.over;
        return s;
    }
}

// ---------------- GameCore ----------------
function installAction(GameCoreClass) {
    Object.assign(GameCoreClass.prototype, {
        isInAction() { return !!this._actionMode; },
        // Entra no Mundo de Ação. Reaproveita o bloqueio do Explorar (_exploreMode): a batalha automática fica segura e volta ao sair.
        actionEnter() {
            if (this._actionMode) return { ok: true };
            if (this._exploreMode) return { ok: false, code: 'explore_active' };
            const r = this.exploreEnter();
            if (r.ok) this._actionMode = true;
            return r;
        },
        actionLeave() {
            if (!this._actionMode) return false;
            this._actionMode = false;
            return this.exploreLeave();
        },
        // Vitória oficial (mesma regra do idle e do Explorar, sem captura automática). O salvamento é o debounced do GameCore (save() só pede; grava em ~2 s, no máximo 10 s).
        actionVictory(wild, partyIndex, maxHp, hp) {
            const st = this.gameState;
            if (Number.isInteger(partyIndex) && partyIndex >= 0 && partyIndex < st.party.length) st.activePokemonIndex = partyIndex;
            wild._captureResolved = true;
            const before = st.party.map((_, i) => this.exploreSnapshot(i));
            const r = this._processVictoryRewards(wild, st.team[st.activePokemonIndex], maxHp, hp);
            r.growth = { active: st.activePokemonIndex, before, after: st.party.map((_, i) => this.exploreSnapshot(i)) };
            this.save();
            return r;
        },
    });
}
if (typeof GameCore !== 'undefined') installAction(GameCore);
