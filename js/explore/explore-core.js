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
function exploreStepEncounter(map, prev, next, rng, rateMult = 1) {
    const steps = Math.floor(next.distance / WORLD_TILE_SIZE) - Math.floor(prev.distance / WORLD_TILE_SIZE);
    if (steps <= 0) return null;
    const kind = exploreEncounterCell(map, Math.floor(next.x / WORLD_TILE_SIZE), Math.floor(next.y / WORLD_TILE_SIZE));
    if (!kind) return null;
    const rate = (kind === 'grass' ? EXPLORE.grassRate : EXPLORE.groundRate) * rateMult;
    for (let i = 0; i < steps; i++) if (rng() < rate) return kind;
    return null;
}

// Chance de captura manual. Com vida cheia vale a mesma chance da bola no idle (captureChance da F9.5); quanto menos vida, maior.
function exploreCaptureChance(rate, ball, hpFrac, hasStatus, bonus = 0) {
    if (!ball) return 0;
    if (ball.id === 'masterball') return 1;
    const f = Math.max(0, Math.min(1, Number.isFinite(hpFrac) ? hpFrac : 1));
    const c = captureChance(rate, ball) * (1 + EXPLORE.hpCatchBonus * (1 - f)) * (hasStatus ? EXPLORE.statusCatchBonus : 1) * (1 + Math.max(0, bonus || 0));
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
        this.trainer = opts.trainer || null;            // F10.2: { cls, name, team: [wild…], klass } — a batalha vai até o último Pokémon dele
        this.foeIndex = 0;
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
        this.foe = this._makeFoe(wild);
        this.participants = new Set(this.active >= 0 ? [this.active] : []);
    }
    _makeFoe(wild) {
        const ws = this.game.calculateStats(wild);
        return { wild, speciesId: wild.id, level: wild.level, types: POKEMON_DATA[wild.id].types, stats: ws, maxHp: ws.hp, hp: ws.hp, moves: exploreMoveset(wild.id, exploreSkillLevelFor(wild.level)), status: null, name: POKEMON_DATA[wild.id].name, shiny: !!wild.isShiny };
    }
    foesLeft() { return this.trainer ? this.trainer.team.length - this.foeIndex - (this.foe.hp > 0 ? 0 : 1) : (this.foe.hp > 0 ? 1 : 0); }
    me() { return this.party[this.active]; }
    canFight() { return this.active >= 0; }
    // Estado para guardar entre batalhas (vida, PP e status por indivíduo)
    keep() { const out = {}; for (const u of this.party) out[u.uid] = { hp: u.hp / u.maxHp, status: u.status, pp: Object.fromEntries(u.moves.map(m => [m.name, m.pp])) }; return out; }

    _name(u) { return u === this.foe ? (this.trainer ? `${u.name} de ${this.trainer.name}` : `${u.name} selvagem`) : u.name; }
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
        if (this.foe.hp <= 0 && !this.over) {
            out.push({ t: 'faint', side: 'foe', msg: `${this._name(this.foe)} desmaiou!` });
            if (this.trainer && this.foeIndex < this.trainer.team.length - 1) {          // o treinador manda o próximo
                out.push({ t: 'xp', wild: this.foe.wild });
                this.foeIndex++; this.foe = this._makeFoe(this.trainer.team[this.foeIndex]);
                out.push({ t: 'foeSwitch', msg: `${this.trainer.cls} ${this.trainer.name} enviou ${this.foe.name}!` });
                return;
            }
            this.over = 'win'; return;
        }
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
            if (this.trainer) { out.push({ t: 'text', msg: 'Não dá para fugir de uma batalha contra treinador!' }); return out; }
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
            if (this.trainer) { out.push({ t: 'text', msg: 'O treinador bloqueou a bola! Não dá para capturar o Pokémon de outra pessoa.' }); return out; }
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

// ---------------- F10.2 · treinadores e itens das rotas (puros e determinísticos pelo id do mapa) ----------------
const EXPLORE_TRAINER_CLASSES = [
    { cls: 'Caçador de Insetos', types: ['bug', 'grass'], colors: { jacket: '#5fbf57', cap: '#e8d24a', pants: '#3a4a2a' }, intro: 'Ei! Meus insetos estão prontos!', lose: 'Meus insetos… voltem!' },
    { cls: 'Garota do Campo', types: ['normal', 'fairy', 'grass'], colors: { jacket: '#ff8ac8', cap: '#ffffff', pants: '#6a4a8a' }, intro: 'Você parece forte. Vamos ver!', lose: 'Puxa, você é bom mesmo!' },
    { cls: 'Montanhista', types: ['rock', 'ground', 'fighting'], colors: { jacket: '#b5793a', cap: '#6b4a2e', pants: '#3a3a46' }, intro: 'As montanhas me ensinaram a lutar!', lose: 'Fui soterrado…' },
    { cls: 'Pescador', types: ['water', 'ice'], colors: { jacket: '#3f78e2', cap: '#e8e8e8', pants: '#2a3a5a' }, intro: 'Pesquei um adversário!', lose: 'Esse escapou da rede…' },
    { cls: 'Jovem Treinador', types: [], colors: { jacket: '#e94560', cap: '#2f6fd6', pants: '#2a2a46' }, intro: 'Nossos olhos se cruzaram! Batalha!', lose: 'Perdi! Você é demais!' },
    { cls: 'Mística', types: ['psychic', 'ghost', 'dark'], colors: { jacket: '#7e5cff', cap: '#2a1a4a', pants: '#1a1a2a' }, intro: 'Eu previ este encontro…', lose: 'Isso eu não previ.' },
];
const EXPLORE_TRAINER_NAMES = ['Léo', 'Bia', 'Davi', 'Nina', 'Caio', 'Lara', 'Rafa', 'Mel', 'Igor', 'Luna', 'Theo', 'Íris', 'Bruno', 'Clara', 'Enzo', 'Sofia'];
const EXPLORE_SIGHT = 4;            // tiles de visão em linha reta do treinador
const EXPLORE_DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

const _exploreWalk = (map, x, y) => !worldCellBlocked(map, x, y);
// Posições de treinadores: chão andável (não mato alto), com pelo menos 3 tiles livres à frente, longe do início e entre si.
// Devolve [{ id, x, y, dir, cls, name, seed }]. Puro: o mesmo mapa dá sempre os mesmos treinadores.
function exploreTrainerSpots(map, count) {
    if (map && Array.isArray(map.trainers)) return map.trainers.map(t => {              // F10.5: treinadores fixos (ginásio)
        const base = EXPLORE_TRAINER_CLASSES.find(k => k.cls === t.cls) || EXPLORE_TRAINER_CLASSES[2];
        const klass = t.leader ? { ...base, cls: t.cls, intro: t.intro || base.intro, lose: t.lose || base.lose, colors: { jacket: '#8a5a2a', cap: '#3a2a1a', pants: '#2a2a30' } } : base;
        return { ...t, klass, seed: worldStringSeed(t.id) };
    });
    if (!map || map.type === 'city') return [];
    const rnd = worldRng(worldStringSeed('trainers:v1:' + map.id)), out = [], start = map.spawn || { x: 0, y: 0 };
    const cand = [];
    for (let y = 1; y < map.height - 1; y++) for (let x = 1; x < map.width - 1; x++) {
        if (!_exploreWalk(map, x, y) || map.rows[y][x] === 'w') continue;
        let best = null, bestRun = 0;
        for (const dir of ['down', 'left', 'right', 'up']) {
            const [dx, dy] = EXPLORE_DIRS[dir]; let run = 0;
            while (run < EXPLORE_SIGHT && _exploreWalk(map, x + dx * (run + 1), y + dy * (run + 1))) run++;
            if (run > bestRun) { bestRun = run; best = dir; }
        }
        if (bestRun >= 3 && Math.abs(x - start.x) + Math.abs(y - start.y) > 7) cand.push({ x, y, dir: best });
    }
    for (let tries = 0; out.length < count && cand.length && tries < 400; tries++) {
        const c = cand[Math.floor(rnd() * cand.length)];
        if (out.some(o => Math.abs(o.x - c.x) + Math.abs(o.y - c.y) < 9)) continue;
        const k = EXPLORE_TRAINER_CLASSES[Math.floor(rnd() * EXPLORE_TRAINER_CLASSES.length)];
        out.push({ id: `${map.id}#t${out.length}`, x: c.x, y: c.y, dir: c.dir, cls: k.cls, klass: k, name: EXPLORE_TRAINER_NAMES[Math.floor(rnd() * EXPLORE_TRAINER_NAMES.length)], seed: Math.floor(rnd() * 1e9) });
    }
    return out;
}
// Quantos treinadores um mapa tem (pela área): 2 a 4
function exploreTrainerCount(map) { return map && map.type !== 'city' ? Math.max(2, Math.min(4, Math.round(map.width * map.height / 1200))) : 0; }

// O treinador vê o jogador? Linha reta na direção dele, até EXPLORE_SIGHT tiles, parada no primeiro bloqueio. Devolve a distância ou null.
function exploreTrainerSees(cmap, t, px, py) {
    const [dx, dy] = EXPLORE_DIRS[t.dir] || [0, 1];
    for (let d = 1; d <= EXPLORE_SIGHT; d++) {
        const x = t.x + dx * d, y = t.y + dy * d;
        if (x === px && y === py) return d;
        if (worldCellBlocked(cmap, x, y)) return null;
    }
    return null;
}
// Cópia do mapa só para colisão: treinadores viram obstáculo (letra de pedra), o desenho continua usando o mapa original
function exploreCollisionMap(map, cells) {
    if (!cells || !cells.length) return map;
    const rows = map.rows.map(r => r.split(''));
    for (const c of cells) if (rows[c.y] && rows[c.y][c.x] !== undefined) rows[c.y][c.x] = 'r';
    return { ...map, rows: rows.map(r => r.join('')) };
}
// Equipe do treinador: 1 a 3 Pokémon da tabela natural da rota (preferindo os tipos da classe), nível no topo da faixa da rota.
// Usa o gerador do jogo (createWildPokemon, sem shiny) e marca cada um como de treinador (não pode ser capturado).
function exploreTrainerTeam(game, route, t) {
    const rnd = worldRng(t.seed >>> 0), list = ((route && route.pokemon) || []).filter(p => POKEMON_DATA[p.id] && !(typeof isRestrictedSpecies === 'function' && isRestrictedSpecies(p.id)));
    if (!list.length) return [];
    const pref = list.filter(p => POKEMON_DATA[p.id].types.some(ty => t.klass.types.includes(ty)));
    const pool = pref.length ? pref : list, n = 1 + Math.floor(rnd() * 3), top = (route.levelRange && route.levelRange[1]) || 5;
    const team = [];
    for (let i = 0; i < n; i++) {
        const sp = pool[Math.floor(rnd() * pool.length)], lv = Math.max(2, top + Math.floor(rnd() * 3) - (n - 1 - i));
        const w = game.createWildPokemon(sp.id, lv, 0);
        if (w) { w._trainer = true; team.push(w); }
    }
    return team;
}
// Prêmio em ouro (como nos jogos: proporcional ao nível do último Pokémon e ao tamanho da equipe)
function exploreTrainerPrize(team) { if (!team.length) return 0; const top = Math.max(...team.map(w => w.level)); return Math.max(10, Math.round(top * 12 * (1 + 0.25 * (team.length - 1)))); }

// Itens no chão: tiles andáveis fora do caminho e do mato, longe do início. Devolve [{ id, x, y, item: { kind, id?, qty } }].
const EXPLORE_ITEM_TABLE = [[{ kind: 'ball', id: 'pokeball', qty: 3 }, 40], [{ kind: 'potion', qty: 2 }, 25], [{ kind: 'ball', id: 'greatball', qty: 2 }, 15], [{ kind: 'ball', id: 'ultraball', qty: 1 }, 5], [{ kind: 'gold', qty: 1 }, 15]];
function exploreItemSpots(map, count) {
    if (!map || map.type === 'city') return [];
    const rnd = worldRng(worldStringSeed('items:v1:' + map.id)), start = map.spawn || { x: 0, y: 0 }, out = [], cand = [];
    for (let y = 1; y < map.height - 1; y++) for (let x = 1; x < map.width - 1; x++) {
        const ch = map.rows[y][x], def = WORLD_LEGEND[ch];
        if (!def || def.walkable !== true || def.kind === 'path' || ch === 'w') continue;
        if (Math.abs(x - start.x) + Math.abs(y - start.y) > 6) cand.push({ x, y });
    }
    const total = EXPLORE_ITEM_TABLE.reduce((a, e) => a + e[1], 0);
    for (let tries = 0; out.length < count && cand.length && tries < 300; tries++) {
        const c = cand[Math.floor(rnd() * cand.length)];
        if (out.some(o => Math.abs(o.x - c.x) + Math.abs(o.y - c.y) < 6)) continue;
        let r = rnd() * total, item = EXPLORE_ITEM_TABLE[0][0];
        for (const [it, w] of EXPLORE_ITEM_TABLE) { r -= w; if (r < 0) { item = it; break; } }
        out.push({ id: `${map.id}#i${out.length}`, x: c.x, y: c.y, item: { ...item } });
    }
    return out;
}
function exploreItemCount(map) { return map && map.type !== 'city' ? Math.max(3, Math.min(6, Math.round(map.width * map.height / 900))) : 0; }

// ---------------- F10.6 · Pokémon selvagens visíveis (como em Let's Go) ----------------
// Andam só pelas células de encontro (mato alto, ou o chão dos biomas sem grama). Encostar num deles começa a batalha com ele.
// Com eles no mapa, o sorteio aleatório por passo cai para EXPLORE.roamerRandomMult da chance normal.
EXPLORE.roamerRandomMult = 0.5;
EXPLORE.roamerRespawnMs = 8000;
function exploreEncounterCells(map) {
    const out = [];
    if (!map) return out;
    for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (exploreEncounterCell(map, x, y)) out.push([x, y]);
    return out;
}
function exploreRoamerCount(map) { const n = exploreEncounterCells(map).length; return n ? Math.max(2, Math.min(7, Math.round(n / 35))) : 0; }
// Célula para um selvagem nascer: de encontro, livre e longe do jogador (>= 4 tiles). rng: () => [0,1). Devolve [x, y] ou null.
function exploreRoamerSpawnCell(map, cells, player, taken, rng) {
    const free = cells.filter(([x, y]) => Math.abs(x - player.x) + Math.abs(y - player.y) >= 4 && !taken.some(t => t[0] === x && t[1] === y));
    return free.length ? free[Math.floor(rng() * free.length)] : null;
}
// Próximo passo: uma célula vizinha que também seja de encontro (ou fica parado). Puro.
function exploreRoamerStep(map, x, y, rng) {
    const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => exploreEncounterCell(map, nx, ny));
    if (!opts.length || rng() < 0.35) return [x, y];
    return opts[Math.floor(rng() * opts.length)];
}

// ---------------- F10.5 · Cidade de Viridian e o primeiro Ginásio (mapas só do modo Explorar) ----------------
// Mesmo formato dos mapas do mundo (ASCII + WORLD_LEGEND, sem letras novas). `gym` marca a área do prédio (desenhada pela cena 3D);
// `exits` = células que levam a outro mapa; `trainers` = treinadores fixos (o ginásio não sorteia posições).
const EXPLORE_MAPS = {
    explore_viridian: {
        id: 'explore_viridian', type: 'city', name: 'Cidade de Viridian', width: 28, height: 22,
        spawn: { x: 13, y: 19, dir: 'up' },
        gym: { x: 3, y: 3, w: 7, h: 4, door: { x: 6, y: 6 } },
        interactions: [{ id: 'pokemon_center', type: 'heal', label: 'Centro Pokémon', cell: { x: 20, y: 5 } }, { id: 'gym', type: 'gym', label: 'Ginásio de Viridian', cell: { x: 6, y: 7 } }],
        exits: [{ y: 21, x0: 12, x1: 14, to: 'kanto_route1', at: { x: 16, y: 1, dir: 'down' } }],
        rows: [
            'TTTTTTTTTTTTTTTTTTTTTTTTTTTT', 'TTTTTTTTTTTTTTTTTTTTTTTTTTTT', 'TT........................TT', 'TT.OOOOOOO.........ABC....TT',
            'TT.OOOOOOO.........DGF....TT', 'TT.OOOOOOO..........q.....TT', 'TT.OOOOOOO.........qqq....TT', 'TT.qqqqqqqqqqqqqqqqqqqqqq.TT',
            'TT.qqlqqqqqqqqqqqqqqqqlqq.TT', 'TT.qqqqqqqqqqqqqqqqqqqqqq.TT', 'TT.qqqqqhqqqqqqqqqhqqqqqq.TT', 'TT.qqqqqqqqqqqqqqqqqqqqqq.TT',
            'TTbqqqqqqqlqqqqqqlqqqqqqqbTT', 'TT.qqqqqqqqqqqqqqqqqqqqqq.TT', 'TT..........ppp...........TT', 'TT.========.ppp.=========.TT',
            'TT..y.......ppp.........f.TT', 'TT.f...b....ppp.z.y.f.....TT', 'TT...f...y..ppp......y....TT', 'TT....f.....ppp....b..f...TT',
            'TTTTTTTTTTTTpppTTTTTTTTTTTTT', 'TTTTTTTTTTTTpppTTTTTTTTTTTTT',
        ],
    },
    explore_gym_rock: {
        id: 'explore_gym_rock', type: 'city', name: 'Ginásio de Viridian', width: 13, height: 16, indoor: true,
        spawn: { x: 6, y: 14, dir: 'up' },
        exits: [{ y: 15, x0: 5, x1: 7, to: 'explore_viridian', at: { x: 6, y: 8, dir: 'down' } }],
        trainers: [
            { id: 'explore_gym_rock#t0', x: 2, y: 9, dir: 'right', cls: 'Montanhista', name: 'Rui', team: [74, 27], levelMult: 0.9 },
            { id: 'explore_gym_rock#t1', x: 10, y: 6, dir: 'left', cls: 'Montanhista', name: 'Vera', team: [27, 74, 95], levelMult: 0.95 },
            { id: 'explore_gym_rock#t2', x: 6, y: 2, dir: 'down', cls: 'Líder de Ginásio', name: 'Petra', team: [74, 111, 95], levelMult: 1.08, leader: true, badge: 'rocha',
                intro: 'Eu sou Petra, Líder do Ginásio de Viridian! Minha defesa é dura como pedra. Mostre do que você é capaz!', lose: 'Incrível… sua força rachou a minha rocha. Você merece a Insígnia Rocha!' },
        ],
        rows: ['OOOOOOOOOOOOO', 'OXqqqqqqqqqXO', 'OqqqqqqqqqqqO', 'OqRRqqqqqRRqO', 'OqqqqqqqqqqqO', 'OqqqqqqqqqqqO', 'OqqqqqqqqqqqO', 'OqRRqqqqqRRqO',
            'OqqqqqqqqqqqO', 'OqqqqqqqqqqqO', 'OqqqqqqqqqqqO', 'OqRqRqqqRqRqO', 'OqqqqqqqqqqqO', 'OXqqqqqqqqqXO', 'OqqqqqqqqqqqO', 'OOOOOqqqOOOOO'],
    },
};
// Insígnias do modo Explorar (independentes das insígnias regionais do idle). O efeito só vale no Explorar.
const EXPLORE_BADGES = {
    rocha: { id: 'rocha', name: 'Insígnia Rocha', color: '#b5793a', effect: '+10% de chance de captura no modo Explorar', catchBonus: 0.1 },
};
function exploreMapById(id) { return Object.prototype.hasOwnProperty.call(EXPLORE_MAPS, id) ? EXPLORE_MAPS[id] : getWorldMap(id); }
// Equipe de treinador fixo (ginásio): espécies declaradas, nível pela média da sua equipe × levelMult (o ginásio acompanha o seu progresso)
function exploreFixedTeam(game, t) {
    const party = game.gameState.party.map((_, i) => game._partyInstance(i)).filter(Boolean);
    const avg = party.length ? party.reduce((a, p) => a + p.level, 0) / party.length : 5;
    const base = Math.max(8, Math.round(avg * (t.levelMult || 1)));
    return t.team.map((id, i) => { const w = game.createWildPokemon(id, Math.max(2, Math.min(MAX_POKEMON_LEVEL, base - (t.team.length - 1 - i))), 0); if (w) w._trainer = true; return w; }).filter(Boolean);
}

// ---------------- F10.4 · progresso salvo (campo aditivo opcional `explore` no save) ----------------
// { defeated: [ids de treinador], taken: [ids de item], badges: [ids de EXPLORE_BADGES], at: { map, x, y, dir } }. Só é gravado quando há algo; saves sem ele ficam idênticos.
const EXPLORE_SAVE_MAX = 2000;
const _EXPLORE_ID_RE = /^[a-z0-9_]{1,40}#[ti]\d{1,2}$/;
const _EXPLORE_MAP_RE = /^[a-z0-9_]{1,40}$/;
function sanitizeExploreState(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const list = (a, kind) => Array.isArray(a) ? [...new Set(a.filter(x => typeof x === 'string' && _EXPLORE_ID_RE.test(x) && x.includes('#' + kind)))].slice(0, EXPLORE_SAVE_MAX) : [];
    const out = {}, d = list(raw.defeated, 't'), t = list(raw.taken, 'i');
    if (d.length) out.defeated = d;
    if (t.length) out.taken = t;
    const b = Array.isArray(raw.badges) ? [...new Set(raw.badges.filter(x => typeof x === 'string' && typeof EXPLORE_BADGES !== 'undefined' && Object.prototype.hasOwnProperty.call(EXPLORE_BADGES, x)))] : [];
    if (b.length) out.badges = b;
    const at = raw.at;
    if (at && typeof at === 'object' && typeof at.map === 'string' && _EXPLORE_MAP_RE.test(at.map) && Number.isFinite(at.x) && Number.isFinite(at.y) && at.x >= 0 && at.y >= 0 && at.x <= 1e5 && at.y <= 1e5)
        out.at = { map: at.map, x: Math.round(at.x), y: Math.round(at.y), dir: ['up', 'down', 'left', 'right'].includes(at.dir) ? at.dir : 'down' };
    return Object.keys(out).length ? out : null;
}

// ---------------- GameCore ----------------
function installExplore(GameCoreClass) {
    Object.assign(GameCoreClass.prototype, {
        isExploring() { return !!this._exploreMode; },
        // F10.4: progresso da exploração no save (treinadores vencidos, itens pegos, última posição)
        exploreProgress() {
            const gs = this.gameState;
            if (!gs.explore || typeof gs.explore !== 'object') gs.explore = {};
            if (!Array.isArray(gs.explore.defeated)) gs.explore.defeated = [];
            if (!Array.isArray(gs.explore.taken)) gs.explore.taken = [];
            return gs.explore;
        },
        exploreMark(kind, id) {
            const p = this.exploreProgress(), list = kind === 'defeated' ? p.defeated : kind === 'taken' ? p.taken : null;
            if (!list || typeof id !== 'string' || !_EXPLORE_ID_RE.test(id) || list.includes(id)) return false;
            if (list.length >= EXPLORE_SAVE_MAX) list.shift();
            list.push(id); this.save();
            return true;
        },
        exploreHasBadge(id) { const p = this.exploreProgress(); return Array.isArray(p.badges) && p.badges.includes(id); },
        exploreAwardBadge(id) {
            if (!Object.prototype.hasOwnProperty.call(EXPLORE_BADGES, id)) return false;
            const p = this.exploreProgress(); if (!Array.isArray(p.badges)) p.badges = [];
            if (p.badges.includes(id)) return false;
            p.badges.push(id); this._emit('explore_badge', { id }); this.save();
            return true;
        },
        exploreCatchBonus() { const p = this.exploreProgress(); return (p.badges || []).reduce((a, id) => a + ((EXPLORE_BADGES[id] && EXPLORE_BADGES[id].catchBonus) || 0), 0); },
        exploreSetPosition(at) {
            const p = this.exploreProgress(), clean = sanitizeExploreState({ at });
            if (clean && clean.at) p.at = clean.at; else delete p.at;
            this.save();
        },
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
        // F10.2: item achado no chão. Bolas e poções respeitam os limites do inventário; ouro passa pelo portão de dinheiro (motivo 'reward').
        exploreGiveItem(item, routeLevel) {
            if (!item) return { ok: false };
            if (item.kind === 'ball') { const r = this.addBalls(item.id, item.qty); return { ok: !!(r && r.ok), added: r && r.added || 0 }; }
            if (item.kind === 'potion') { const inv = this.ensureInventory(), room = Math.max(0, this.getPotionCapacity() - inv.potions), n = Math.min(room, item.qty); inv.potions += n; this.save(); return { ok: true, added: n }; }
            if (item.kind === 'gold') { const amount = Math.max(20, Math.round((routeLevel || 5) * 15)); const r = this.earnMoney(amount, 'reward', { source: 'explore_item' }); this.save(); return { ok: r.ok, added: r.amount || 0 }; }
            return { ok: false };
        },
        exploreTrainerReward(amount, trainerId) {
            if (!(amount > 0)) return { ok: false, amount: 0 };
            const r = this.earnMoney(Math.round(amount), 'reward', { source: 'explore_trainer', trainer: trainerId });
            this.save();
            return { ok: r.ok, amount: r.amount || 0 };
        },
        // Uma tentativa de captura manual com a bola escolhida: gasta 1 bola, três balançadas (um sorteio cada) e, se pegar, _applyCapture.
        exploreCapture(wild, ballId, hpFrac, hasStatus) {
            const ball = getBallType(ballId);
            if (!ball || this.getBallCount(ball.id) <= 0 || wild._captureResolved || wild._trainer) return { ok: false, caught: false, shakes: 0 };
            this.consumeBall(ball.id, 1);
            const chance = exploreCaptureChance(speciesCatchRate(POKEMON_DATA[wild.id]), ball, hpFrac, hasStatus, this.exploreCatchBonus());
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
