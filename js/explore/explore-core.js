// ============================================================
// F10 · Modo Explorar (núcleo, sem DOM nem Canvas): você anda pelo mapa, o mato alto tem encontros e a batalha é por turnos
// (LUTAR / BOLSA / POKÉMON / FUGIR), como nos jogos principais. Reaproveita o que o jogo já tem:
//   - colisão e movimento: worldMoveBy / WORLD_LEGEND (world-engine.js), a mesma fonte de verdade das cidades;
//   - inimigo: generateWildPokemon(rota) (tabela natural da rota, nível, IVs, shiny, pesos de lendários);
//   - atributos: calculateBattleStats / calculateStats; dano: _computeDamage (fórmula oficial, mesmo RNG do jogo);
//   - golpes: SKILL_DATA por tipo (os mesmos nomes e poderes das técnicas); captura: bolas do inventário (BALL_TYPES,
//     consumeBall, captureChance da F9.5) e _applyCapture; vitória: _processVictoryRewards (XP, ouro, Pokédex, eventos).
// Enquanto você explora, as batalhas automáticas ficam seguras (_battleBlockReason → 'explore') e voltam ao sair.
// A sessão de exploração é só da memória (como a área exibida do Mapa): nada novo vai para o save.
// ============================================================
let EXPLORE_ENABLED = true;

const EXPLORE = {
    grassRate: 0.1,           // chance de encontro por passo (1 tile) no mato alto
    groundRate: 0.05,         // por passo em biomas sem grama (caverna, vulcão, neve, terras sombrias): todo chão tem encontros, como cavernas
    tackle: { name: 'Investida', type: 'normal', power: 40 },
    hpCatchBonus: 0.8,        // captura: até +80% com o alvo quase sem vida (cheio = chance base da bola, igual ao idle)
    statusCatchBonus: 1.5,    // alvo com status (queimado, envenenado, paralisado)
    catchMin: 0.03, catchMax: 0.98,
    statusChance: 0.1,        // golpe de fogo/elétrico/veneno tem 10% de causar status
    skillLevelEvery: 25,      // nível da técnica pelo nível do Pokémon quando ele não tem técnica liberada: 1 + nível/25 (até MAX_SKILL_LEVEL)
};
const EXPLORE_STATUS = { burn: { name: 'queimado', tag: 'QUE' }, poison: { name: 'envenenado', tag: 'ENV' }, paralysis: { name: 'paralisado', tag: 'PAR' } };
const EXPLORE_TYPE_STATUS = { fire: 'burn', electric: 'paralysis', poison: 'poison' };

// PP pelo poder (golpes fortes têm menos usos)
function explorePp(power) { return power <= 45 ? 35 : power <= 65 ? 25 : power <= 85 ? 15 : power <= 105 ? 10 : 5; }
function exploreAccuracy(power) { return power >= 100 ? 0.85 : power >= 90 ? 0.9 : 1; }

function exploreSkillLevelFor(level) { return Math.max(1, Math.min(MAX_SKILL_LEVEL, 1 + Math.floor((Number(level) || 1) / EXPLORE.skillLevelEvery))); }

// Até 4 golpes: Investida + a técnica de cada tipo no nível atual + a técnica anterior do primeiro tipo + a técnica Normal do nível. Pura.
function exploreMoveset(speciesId, skillLevel) {
    const data = POKEMON_DATA[speciesId], types = (data && data.types) || ['normal'];
    const L = Math.max(1, Math.min(MAX_SKILL_LEVEL, skillLevel | 0 || 1)), out = [];
    const add = (m) => { if (m && out.length < 4 && !out.some(o => o.name === m.name)) out.push({ name: m.name, type: m.type, power: m.power, pp: explorePp(m.power), maxPp: explorePp(m.power), acc: exploreAccuracy(m.power) }); };
    add(EXPLORE.tackle);
    for (const t of types) { const list = SKILL_DATA[t]; if (list && list[L - 1]) add({ ...list[L - 1], type: t }); }
    if (L > 1 && SKILL_DATA[types[0]] && SKILL_DATA[types[0]][L - 2]) add({ ...SKILL_DATA[types[0]][L - 2], type: types[0] });
    if (!types.includes('normal') && SKILL_DATA.normal && SKILL_DATA.normal[L - 1]) add({ ...SKILL_DATA.normal[L - 1], type: 'normal' });   // golpe Normal do mesmo nível (completa o menu)
    return out;
}

// Mapas com grama alta (letra 'w'): encontros só nela. Sem grama (biomas de caverna etc.): todo chão andável que não é caminho.
const _exploreGrassCache = new Map();
function exploreMapHasGrass(map) {
    if (!map) return false;
    if (_exploreGrassCache.has(map.id)) return _exploreGrassCache.get(map.id);
    const has = map.rows.some(r => r.indexOf('w') >= 0);
    _exploreGrassCache.set(map.id, has);
    return has;
}
// 'grass' | 'ground' | null: tipo de terreno de encontro na célula. Cidades nunca têm encontros.
function exploreEncounterCell(map, cx, cy) {
    if (!map || map.type === 'city') return null;
    const ch = worldCharAt(map, cx, cy), def = ch === null ? null : WORLD_LEGEND[ch];
    if (!def || def.walkable !== true) return null;
    if (ch === 'w') return 'grass';
    if (!exploreMapHasGrass(map) && def.kind === 'ground') return 'ground';
    return null;
}
// Sorteio de encontro ao completar um passo (tile). `prev`/`next`: estados do motor (distance em px). rng: () => [0,1).
function exploreStepEncounter(map, prev, next, rng) {
    const steps = Math.floor(next.distance / WORLD_TILE_SIZE) - Math.floor(prev.distance / WORLD_TILE_SIZE);
    if (steps <= 0) return null;
    const kind = exploreEncounterCell(map, Math.floor(next.x / WORLD_TILE_SIZE), Math.floor(next.y / WORLD_TILE_SIZE));
    if (!kind) return null;
    const rate = kind === 'grass' ? EXPLORE.grassRate : EXPLORE.groundRate;
    for (let i = 0; i < steps; i++) if (rng() < rate) return kind;
    return null;
}

// Chance de captura manual. Com vida cheia vale a mesma chance da bola no idle (captureChance da F9.5); quanto menos vida, maior.
function exploreCaptureChance(rate, ball, hpFrac, hasStatus) {
    if (!ball) return 0;
    if (ball.id === 'masterball') return 1;
    const f = Math.max(0, Math.min(1, Number.isFinite(hpFrac) ? hpFrac : 1));
    const c = captureChance(rate, ball) * (1 + EXPLORE.hpCatchBonus * (1 - f)) * (hasStatus ? EXPLORE.statusCatchBonus : 1);
    return Math.max(EXPLORE.catchMin, Math.min(EXPLORE.catchMax, c));
}
// Três balançadas independentes: P(capturar) = chance exatamente. Devolve o nº de balançadas que passaram (3 = capturado).
function exploreShakes(chance, rng) {
    if (chance >= 1) return 3;
    const p = Math.cbrt(Math.max(0, chance));
    let n = 0;
    while (n < 3 && rng() < p) n++;
    return n;
}
// Fuga (fórmula da 3ª geração): (velocidade × 128 / velocidade do selvagem + 30 × tentativas) / 256
function exploreRunChance(playerSpeed, wildSpeed, attempts) {
    return Math.min(1, ((playerSpeed * 128) / Math.max(1, wildSpeed) + 30 * Math.max(0, attempts)) / 256);
}

// ---------------- batalha por turnos ----------------
// party: [{ idx, uid, inst, speciesId, level, types, stats, maxHp, hp, moves, status, name, shiny }]; foe: idem com `wild`.
// act(ação) devolve passos { t, ... , msg } para a interface animar em ordem. O resultado final fica em `over`:
// 'win' | 'caught' | 'run' | 'lose'.
class ExploreBattle {
    constructor(game, wild, opts = {}) {
        this.game = game; this.wild = wild; this.turn = 0; this.over = null; this.runs = 0; this.caught = null;
        const st = game.gameState, keep = opts.keep || {};
        this.party = st.party.map((uid, i) => {
            const inst = game._partyInstance(i), stats = game.calculateBattleStats(i);
            if (!inst || !stats) return null;
            const k = keep[uid] || {};
            const skill = game.getSkillForInstance(inst);
            const moves = exploreMoveset(inst.speciesId, skill ? skill.skillLevel : exploreSkillLevelFor(inst.level));
            if (k.pp) for (const m of moves) if (Number.isFinite(k.pp[m.name])) m.pp = Math.max(0, Math.min(m.maxPp, k.pp[m.name]));
            const maxHp = stats.hp, hp = Math.max(0, Math.round(maxHp * (Number.isFinite(k.hp) ? k.hp : 1)));
            return { idx: i, uid, inst, speciesId: inst.speciesId, level: inst.level, types: POKEMON_DATA[inst.speciesId].types, stats, maxHp, hp, moves, status: k.status || null, name: getInstanceDisplayName(inst), shiny: !!inst.shiny };
        }).filter(Boolean);
        const wantActive = this.party.findIndex(u => u.idx === st.activePokemonIndex && u.hp > 0);
        this.active = wantActive >= 0 ? wantActive : this.party.findIndex(u => u.hp > 0);
        const ws = game.calculateStats(wild);
        this.foe = { wild, speciesId: wild.id, level: wild.level, types: POKEMON_DATA[wild.id].types, stats: ws, maxHp: ws.hp, hp: ws.hp, moves: exploreMoveset(wild.id, exploreSkillLevelFor(wild.level)), status: null, name: POKEMON_DATA[wild.id].name, shiny: !!wild.isShiny };
        this.participants = new Set(this.active >= 0 ? [this.active] : []);
    }
    me() { return this.party[this.active]; }
    canFight() { return this.active >= 0; }
    // Estado para guardar entre batalhas (vida, PP e status por indivíduo)
    keep() { const out = {}; for (const u of this.party) out[u.uid] = { hp: u.hp / u.maxHp, status: u.status, pp: Object.fromEntries(u.moves.map(m => [m.name, m.pp])) }; return out; }

    _name(u) { return u === this.foe ? `${u.name} selvagem` : u.name; }
    _useMove(att, def, move, out) {
        const g = this.game, isPlayer = att !== this.foe;
        move.pp = Math.max(0, move.pp - 1);
        out.push({ t: 'text', msg: `${this._name(att)} usou ${move.name}!` });
        if (att.status === 'paralysis' && g.rng() < 0.25) { out.push({ t: 'text', msg: `${this._name(att)} está paralisado! Não consegue se mover!` }); return; }
        if (g.rng() >= move.acc) { out.push({ t: 'miss', side: isPlayer ? 'me' : 'foe', msg: `O ataque de ${this._name(att)} errou!` }); return; }
        const crit = g._getCritParams(isPlayer);
        const atkStat = att.status === 'burn' ? Math.max(1, Math.floor(att.stats.attack / 2)) : att.stats.attack;
        const r = g._computeDamage(att.level, atkStat, def.stats.defense, [move.type], def.types, move.power, crit.rate, crit.multiplier);
        def.hp = Math.max(0, def.hp - r.damage);
        out.push({ t: 'hit', side: isPlayer ? 'me' : 'foe', dmg: r.damage, eff: r.typeEffectiveness, crit: r.criticalHit, mtype: move.type, power: move.power, hp: def.hp, maxHp: def.maxHp });
        if (r.criticalHit) out.push({ t: 'text', msg: 'Um golpe crítico!' });
        if (r.effectivenessText) out.push({ t: 'text', msg: r.effectivenessText });
        const s = EXPLORE_TYPE_STATUS[move.type];
        if (s && def.hp > 0 && !def.status && !def.types.includes(move.type) && g.rng() < EXPLORE.statusChance) {
            def.status = s;
            out.push({ t: 'status', side: isPlayer ? 'foe' : 'me', status: s, msg: `${this._name(def)} ficou ${EXPLORE_STATUS[s].name}!` });
        }
    }
    _foeMove() {
        const g = this.game, ms = this.foe.moves.filter(m => m.pp > 0);
        if (!ms.length) return { ...EXPLORE.tackle, pp: 1, maxPp: 1, acc: 1 };
        const me = this.me();
        const w = ms.map(m => 1 + (getBestTypeEffectiveness([m.type], me.types).multiplier - 1) * 0.6 + m.power / 200);
        let x = g.rng() * w.reduce((a, b) => a + b, 0);
        for (let i = 0; i < ms.length; i++) { x -= w[i]; if (x <= 0) return ms[i]; }
        return ms[ms.length - 1];
    }
    _endTurn(out) {
        for (const u of [this.me(), this.foe]) {
            if (!u || u.hp <= 0 || !(u.status === 'burn' || u.status === 'poison')) continue;
            const d = Math.max(1, Math.floor(u.maxHp / (u.status === 'burn' ? 16 : 8)));
            u.hp = Math.max(0, u.hp - d);
            out.push({ t: 'dot', side: u === this.foe ? 'foe' : 'me', dmg: d, hp: u.hp, maxHp: u.maxHp, msg: `${this._name(u)} sofre com ${u.status === 'burn' ? 'a queimadura' : 'o veneno'}!` });
        }
    }
    _checkFaints(out) {
        if (this.foe.hp <= 0 && !this.over) { out.push({ t: 'faint', side: 'foe', msg: `${this._name(this.foe)} desmaiou!` }); this.over = 'win'; return; }
        const me = this.me();
        if (me && me.hp <= 0) {
            out.push({ t: 'faint', side: 'me', msg: `${me.name} desmaiou!` });
            const next = this.party.findIndex(u => u.hp > 0);
            if (next < 0) { this.over = 'lose'; out.push({ t: 'text', msg: 'Você não tem mais Pokémon em condições de lutar! Você correu para o Centro Pokémon…' }); }
            else { this.active = next; this.participants.add(next); out.push({ t: 'switch', idx: next, msg: `Vai, ${this.me().name}!` }); }
        }
    }
    _foeTurn(out) {
        if (this.over) return;
        const me = this.me();
        this._useMove(this.foe, me, this._foeMove(), out);
        this._checkFaints(out);
        if (!this.over) { this._endTurn(out); this._checkFaints(out); }
    }

    // ação: { type: 'move', i } | { type: 'ball', id } | { type: 'potion' } | { type: 'switch', i } | { type: 'run' }
    act(action) {
        const out = [], g = this.game;
        if (this.over || !this.canFight()) return out;
        const me = this.me();
        if (action.type === 'move') {
            const move = me.moves[action.i];
            if (!move) return out;
            if (move.pp <= 0) { out.push({ t: 'text', msg: 'Não há PP para esse golpe!' }); return out; }
            this.turn++;
            const foeMove = this._foeMove();
            const sp = (u) => u.stats.speed * (u.status === 'paralysis' ? 0.5 : 1);
            const meFirst = sp(me) > sp(this.foe) || (sp(me) === sp(this.foe) && g.rng() < 0.5);
            const order = meFirst ? [[me, this.foe, move], [this.foe, me, foeMove]] : [[this.foe, me, foeMove], [me, this.foe, move]];
            for (const [a, d, m] of order) {
                if (this.over || a.hp <= 0 || d.hp <= 0) break;
                if (a !== this.foe && a !== this.me()) break;        // o meu caiu e outro entrou: o golpe dele não sai
                this._useMove(a, d, m, out);
                this._checkFaints(out);
            }
            if (!this.over) { this._endTurn(out); this._checkFaints(out); }
            return out;
        }
        if (action.type === 'run') {
            this.turn++; this.runs++;
            if (g.rng() < exploreRunChance(me.stats.speed, this.foe.stats.speed, this.runs - 1)) { out.push({ t: 'text', msg: 'Você fugiu em segurança!' }); this.over = 'run'; return out; }
            out.push({ t: 'text', msg: 'Não deu para fugir!' });
            this._foeTurn(out); return out;
        }
        if (action.type === 'switch') {
            const to = this.party[action.i];
            if (!to || to.hp <= 0 || action.i === this.active) return out;
            this.turn++;
            out.push({ t: 'recall', msg: `${me.name}, volte!` });
            this.active = action.i; this.participants.add(action.i);
            out.push({ t: 'switch', idx: action.i, msg: `Vai, ${to.name}!` });
            this._foeTurn(out); return out;
        }
        if (action.type === 'potion') {
            const inv = g.ensureInventory();
            if (inv.potions <= 0) { out.push({ t: 'text', msg: 'Você não tem Poções!' }); return out; }
            if (me.hp >= me.maxHp) { out.push({ t: 'text', msg: `${me.name} já está com a vida cheia.` }); return out; }
            this.turn++;
            const before = me.hp;
            me.hp = Math.min(me.maxHp, me.hp + potionHealAmount(me.maxHp, g.getPotionHealPercent()));
            inv.potions--;
            g._emit('heal', { potion: true, reason: 'explore', amount: me.hp - before, hpBefore: before, hpAfter: me.hp, maxHp: me.maxHp, revived: false, potionsLeft: inv.potions, price: g.getPotionPrice() });
            out.push({ t: 'heal', side: 'me', hp: me.hp, maxHp: me.maxHp, msg: `${me.name} recuperou ${me.hp - before} de PS!` });
            this._foeTurn(out); return out;
        }
        if (action.type === 'ball') {
            const ball = getBallType(action.id);
            if (!ball || g.getBallCount(ball.id) <= 0) { out.push({ t: 'text', msg: 'Você não tem essa bola!' }); return out; }
            this.turn++;
            const r = g.exploreCapture(this.wild, ball.id, this.foe.hp / this.foe.maxHp, !!this.foe.status);
            out.push({ t: 'throw', ball: ball.id, msg: `Você lançou uma ${ball.name}!` });
            for (let i = 0; i < Math.min(3, r.shakes); i++) out.push({ t: 'shake', n: i + 1 });
            if (r.caught) { out.push({ t: 'caught', ball: ball.id, msg: `Peguei! ${this.foe.name} foi capturado!` }); this.over = 'caught'; this.caught = r; return out; }
            out.push({ t: 'breakfree', msg: ['Ah, não! O Pokémon escapou!', 'Ah! Parecia que ia dar!', 'Argh! Quase!'][Math.min(2, r.shakes)] });
            this._foeTurn(out); return out;
        }
        return out;
    }
}

// ---------------- GameCore ----------------
function installExplore(GameCoreClass) {
    Object.assign(GameCoreClass.prototype, {
        isExploring() { return !!this._exploreMode; },
        // Por que não dá para explorar agora (null = pode)
        exploreBlockReason() {
            if (!EXPLORE_ENABLED) return 'disabled';
            if (!this.gameState || !Array.isArray(this.gameState.party) || this.gameState.party.length === 0) return 'no_team';
            if (this._isOfflineSimulating) return 'offline';
            if (this._towerMode) return 'tower';
            const s = this.getHuntSession();
            if (s && (s.state === 'running' || s.state === 'paused')) return 'hunt_active';
            return null;
        },
        // Entra no modo: a batalha automática em curso para (o inimigo e a vida ficam guardados e ela continua ao sair)
        exploreEnter() {
            const reason = this.exploreBlockReason();
            if (reason) return { ok: false, code: reason };
            if (this._exploreMode) return { ok: true };
            this._exploreMode = true;
            this._stopBattleTimer();
            if (this._nextBattleTimeout) { clearTimeout(this._nextBattleTimeout); this._nextBattleTimeout = null; this._nextBattleScheduledAt = null; }
            this._emit('explore_started', {});
            return { ok: true };
        },
        exploreLeave() {
            if (!this._exploreMode) return false;
            this._exploreMode = false;
            this._emit('explore_ended', {});
            this.startBattle();
            return true;
        },
        // Pokémon selvagem da rota (gerador oficial). `route` = objeto de REGIONS (padrão: rota atual)
        exploreWild(route) {
            const r = route || this.getRoute(this.gameState.currentRoute);
            const wild = r ? this.generateWildPokemon(r) : null;
            if (wild && !this.gameState.pokedex[wild.id]) this.gameState.pokedex[wild.id] = 'seen';
            return wild;
        },
        // Vitória (ou captura) na batalha manual: mesmo acerto do idle (XP no ativo, metade na equipe, ouro, Pokédex, eventos),
        // sem a captura automática (o selvagem já está resolvido: desmaiado ou capturado à mão).
        exploreVictory(wild, partyIndex, maxHp, hp) {
            const st = this.gameState;
            if (Number.isInteger(partyIndex) && partyIndex >= 0 && partyIndex < st.party.length) st.activePokemonIndex = partyIndex;
            wild._captureResolved = true;
            const r = this._processVictoryRewards(wild, st.team[st.activePokemonIndex], maxHp, hp);
            this.save();
            return r;
        },
        // Uma tentativa de captura manual com a bola escolhida: gasta 1 bola, três balançadas (um sorteio cada) e, se pegar, _applyCapture.
        exploreCapture(wild, ballId, hpFrac, hasStatus) {
            const ball = getBallType(ballId);
            if (!ball || this.getBallCount(ball.id) <= 0 || wild._captureResolved) return { ok: false, caught: false, shakes: 0 };
            this.consumeBall(ball.id, 1);
            const chance = exploreCaptureChance(speciesCatchRate(POKEMON_DATA[wild.id]), ball, hpFrac, hasStatus);
            const shakes = exploreShakes(chance, () => this.rng());
            if (shakes < 3) {
                this._emit('capture_failed', { id: wild.id, ball: ball.id, chance, left: this.getBallCount(ball.id), shiny: !!wild.isShiny, reason: 'explore' });
                return { ok: true, caught: false, shakes, chance, ball };
            }
            wild._captureResolved = true;
            const q = calculatePokemonQuality({ ivs: wild.ivs, shiny: !!wild.isShiny });
            const outcome = this._applyCapture(wild);
            this._emit('pokemon_captured', { id: wild.id, uid: outcome.uid, firstCatch: outcome.firstCatch, newIndividual: !!outcome.uid, shiny: !!outcome.shiny, grade: q ? q.grade : null, quality: q ? q.percentage : null, reason: 'explore', ball: ball.id });
            this.save();
            return { ok: true, caught: true, shakes, chance, ball, outcome };
        },
    });
}
installExplore(GameCore);
