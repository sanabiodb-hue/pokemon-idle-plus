// ============================================================
// Mundo visual · encontros nos mapas de caça (Fase 7.6). LÓGICA pura: sem DOM, sem Canvas, sem quadros de animação.
//   - O estado do encontro é EM MEMÓRIA (não vai para o save) e guarda só o que é do mundo: mapa, ponto, espécie, sequência,
//     tempo de chegada. Sessão de caça, batalha, recompensas e contadores continuam sendo do GameCore (nada é duplicado).
//   - Um encontro é pedido por uma AÇÃO EXPLÍCITA do jogador (request) e exige uma caçada em andamento (isHuntRunning).
//     Abrir/visualizar um mapa nunca cria encontro nem batalha.
//   - O ponto sai de um sorteio determinístico: PRNG semeado por (mapa, id da sessão de caça, nº do encontro), sem repetir o ponto
//     anterior quando existe outro candidato. A espécie é a do mapa (map.speciesId).
//   - Chegada: o tempo de percurso (distância em L / velocidade, as mesmas fórmulas do núcleo de movimento) vira UM timer do relógio
//     do jogo; ao vencer, o encontro fica "arrived". Não há teleporte nem caminhada animada (a navegação automática é da F7.7).
//   - Batalha: só pela entrada oficial startBattle() (guarda central da F7.0 intacta). O controlador se instala em game.encounterHook
//     apenas enquanto há encontro ativo; startBattle() o consulta no ponto em que escolheria o inimigo (depois da guarda).
//   - Pausa congela (ETA restante e ponto preservados) e a retomada continua uma única vez; parar a caçada, iniciar a simulação
//     offline, entrar na Torre ou sair do mapa cancelam um encontro que ainda não começou. Uma batalha já em curso nunca é
//     abortada: termina pelas regras normais do jogo.
//   - O Fast Driver e a simulação offline continuam por rota, sem encontros (o encontro é cancelado ao começar o offline).
// ============================================================
const WORLD_ENCOUNTER_STATES = ['idle', 'approaching', 'arrived', 'battling', 'resolved', 'cancelled'];
const WORLD_ENCOUNTER_ACTIVE = ['approaching', 'arrived', 'battling'];
const WORLD_ENCOUNTER_VERSION = 1;

// Índices dos pontos candidatos realmente usáveis (dentro do mapa e em terreno andável), na ordem original dos dados
function worldEncounterCandidates(map) {
    const out = [];
    if (!map || !Array.isArray(map.encounterPoints)) return out;
    map.encounterPoints.forEach((p, i) => {
        if (p && Number.isInteger(p.x) && Number.isInteger(p.y) && !worldCellBlocked(map, p.x, p.y)) out.push(i);
    });
    return out;
}

// Ponto do próximo encontro. Puro e determinístico: (mapa, id da sessão, sequência, último índice) → índice. Sem tentativas
// repetidas: sorteia uma vez num conjunto já filtrado (sem o último, se houver outro). Um único candidato é reaproveitado.
function worldPickEncounterPoint(map, sessionId, sequence, lastIndex) {
    const valid = worldEncounterCandidates(map);
    if (valid.length === 0) return null;
    const pool = valid.length > 1 ? valid.filter(i => i !== lastIndex) : valid;
    const rnd = worldRng(worldStringSeed(`enc:v${WORLD_ENCOUNTER_VERSION}:${map.id}:${sessionId}:${sequence}`));
    return pool[Math.floor(rnd() * pool.length)];
}

// Posição (px do mundo) de partida do percurso: o ponto anterior, ou o ponto inicial do mapa
function worldEncounterOrigin(map, lastIndex) {
    const last = lastIndex !== null && lastIndex !== undefined && map.encounterPoints ? map.encounterPoints[lastIndex] : null;
    if (last) return worldCellCenter(map, last.x, last.y);
    const ts = WORLD_TILE_SIZE;
    return { x: map.spawn.x * ts + ts / 2, y: map.spawn.y * ts + ts - 3 };
}

class WorldEncounters {
    constructor(game) {
        this.game = game;
        this.current = null;            // último encontro (ativo ou terminal); some só quando um novo é pedido
        this.lastPointIndex = null;     // ponto do último encontro resolvido/cancelado (evita repetição imediata)
        this.sequence = 0;              // nº do próximo encontro dentro da sessão de caça + mapa
        this._sessionId = null;
        this._mapId = null;
        this._unsubs = [];
        this._timer = null;
        this._timerSince = 0;
        this._supplied = null;          // inimigo entregue a startBattle (para reconhecer a batalha certa)
        this._listeners = new Set();
    }

    isActive() { return !!this.current && WORLD_ENCOUNTER_ACTIVE.includes(this.current.state); }

    // Observadores de mudança (a view só desenha a partir disto). Devolve a função de cancelamento.
    onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
    _changed() { for (const fn of [...this._listeners]) { try { fn(this.current); } catch (e) { /* o observador não pode quebrar a lógica */ } } }

    // ---------- pedido explícito do jogador ----------
    request(speciesId) {
        const g = this.game;
        const fail = (code, message) => ({ ok: false, code, message });
        if (this.isActive()) return fail('already_active', 'Já existe um encontro em andamento neste mapa.');
        if (g._isOfflineSimulating) return fail('offline', 'Aguarde o cálculo offline terminar.');
        if (g._towerMode) return fail('tower_mode', 'Saia da Torre de Desafio para procurar Pokémon.');
        const session = g.getHuntSession();
        if (!session || session.state !== 'running') return fail('no_running_hunt', 'Inicie a caçada na aba Caça para procurar Pokémon neste mapa.');
        let map = null;
        try { map = Number.isInteger(speciesId) ? worldHuntMap(speciesId) : null; } catch (e) { map = null; }
        if (!map) return fail('invalid_species', 'Não foi possível abrir o mapa dessa espécie.');
        if (this._sessionId !== session.id || this._mapId !== map.id) {           // nova sessão ou novo mapa: a sequência recomeça (e continua determinística)
            this._sessionId = session.id; this._mapId = map.id; this.sequence = 0; this.lastPointIndex = null;
        }
        const pointIndex = worldPickEncounterPoint(map, session.id, this.sequence, this.lastPointIndex);
        if (pointIndex === null) return fail('no_points', 'Este mapa não tem ponto de encontro válido.');
        const point = map.encounterPoints[pointIndex];
        const target = worldCellCenter(map, point.x, point.y);
        const etaMs = Math.ceil(worldTravelTimeMs(worldPathLength(worldEncounterOrigin(map, this.lastPointIndex), [target])));
        this.current = {
            id: `${map.id}#${this.sequence}`, sequence: this.sequence, mapId: map.id, speciesId: map.speciesId, pointIndex,
            point: { x: point.x, y: point.y }, state: 'approaching', etaMs, remainingMs: etaMs, outcome: null, reason: null,
        };
        this.sequence++;
        this._supplied = null;
        this._attach();
        this._arm();
        this._changed();
        return { ok: true, encounter: this.current };
    }

    // ---------- chamado por startBattle() (depois da guarda central) para escolher o inimigo ----------
    takeArrivedEnemy() {
        const c = this.current, g = this.game;
        if (!c || c.state !== 'arrived') return null;
        if (g._isOfflineSimulating) { this.cancel('offline'); return null; }
        if (g._towerMode) { this.cancel('tower_mode'); return null; }
        const session = g.getHuntSession();
        if (!session || session.state !== 'running') return null;               // pausada: espera a retomada
        try {
            const route = g.getRoute(g.gameState.currentRoute);
            const levelRange = route && Array.isArray(route.levelRange) ? route.levelRange : [5, 5];
            const enemy = g.generateWildPokemon({ pokemon: [{ id: c.speciesId, weight: 1, levelRange }] });   // mesmo gerador do jogo: nível, IVs, shiny...
            if (!enemy) { this.cancel('generation_failed'); return null; }
            this._supplied = enemy;
            return enemy;
        } catch (e) {
            this.cancel('generation_failed');
            return null;
        }
    }

    // ---------- cancelamento ----------
    // Cancela um encontro que ainda não começou. Uma batalha em curso não é abortada (só deixa de ser acompanhada).
    cancel(reason) {
        const c = this.current;
        if (!c || !WORLD_ENCOUNTER_ACTIVE.includes(c.state)) return false;
        const g = this.game;
        const battle = g.currentBattle;
        const inBattle = !!(this._supplied && battle && battle.wild === this._supplied);
        this._clearTimer();
        if (!inBattle && this._supplied && g.gameState && g.gameState.currentEnemy === this._supplied) g.gameState.currentEnemy = null;   // inimigo entregue mas sem batalha: não deixa pendente
        c.state = 'cancelled';
        c.reason = reason || 'cancelled';
        c.outcome = 'cancelled';
        this.lastPointIndex = c.pointIndex;
        this._supplied = null;
        this._detach();
        this._changed();
        return true;
    }

    // A view avisa quando o jogador troca a área exibida
    onAreaChanged(areaId) {
        const c = this.current;
        if (c && (c.state === 'approaching' || c.state === 'arrived') && c.mapId !== areaId) this.cancel('left_map');
    }

    // ---------- internos ----------
    _attach() {
        this._detach();
        const bus = this.game.bus, g = this.game;
        g.encounterHook = this;
        this._unsubs = [
            bus.on('battle_started', (e) => this._onBattleStarted(e)),
            bus.on('battle_completed', (e) => this._onBattleCompleted(e)),
            bus.on('hunt_paused', (e) => this._guard(e, () => this._onPaused())),
            bus.on('hunt_resumed', (e) => this._guard(e, () => this._onResumed())),
            bus.on('hunt_stopped', (e) => this._guard(e, () => this.cancel('hunt_stopped'))),
        ];
    }

    _detach() {
        for (const off of this._unsubs) off();
        this._unsubs = [];
        if (this.game.encounterHook === this) this.game.encounterHook = null;
    }

    // Eventos vindos da simulação offline cancelam o encontro (o offline é por rota, sem encontros)
    _guard(e, fn) {
        if ((e && e.offline) || this.game._isOfflineSimulating) { this.cancel('offline'); return; }
        fn();
    }

    _arm() {
        this._clearTimer();
        this._timerSince = this.game.now();
        this._timer = this.game.clock.setTimer(() => this._onTimer(), Math.max(0, this.current.remainingMs));
    }

    _clearTimer() {
        if (this._timer !== null) { this.game.clock.clearTimer(this._timer); this._timer = null; }
    }

    _freeze() {
        if (this._timer === null) return;
        const elapsed = Math.max(0, this.game.now() - this._timerSince);
        this.current.remainingMs = Math.max(0, this.current.remainingMs - elapsed);
        this._clearTimer();
    }

    _onPaused() {
        if (this.current && this.current.state === 'approaching') { this._freeze(); this._changed(); }
    }

    _onResumed() {
        const c = this.current;
        if (c && c.state === 'approaching' && this._timer === null) this._arm();   // 'arrived' usa a próxima oportunidade de batalha (ATTACK da retomada)
    }

    _onTimer() {
        this._timer = null;
        const c = this.current, g = this.game;
        if (!c || c.state !== 'approaching') return;
        if (g._isOfflineSimulating) { this.cancel('offline'); return; }
        if (g._towerMode) { this.cancel('tower_mode'); return; }
        c.remainingMs = 0;
        c.state = 'arrived';
        this._changed();
        if (g.isHuntRunning()) g.startBattle();     // entrada oficial: se a guarda recusar, o encadeamento do jogo oferece a vez depois
    }

    _onBattleStarted(e) {
        if (e && e.offline) { this.cancel('offline'); return; }
        const c = this.current, g = this.game;
        if (c && c.state === 'arrived' && this._supplied && g.currentBattle && g.currentBattle.wild === this._supplied) {
            c.state = 'battling';
            this._changed();
        }
    }

    _onBattleCompleted(e) {
        if (e && e.offline) { this.cancel('offline'); return; }
        const c = this.current;
        if (!c || c.state !== 'battling') return;              // só a batalha do encontro; o resultado/recompensas já foram contados pelo jogo
        c.state = 'resolved';
        c.outcome = e && e.result === 'defeat' ? 'defeat' : 'victory';
        this.lastPointIndex = c.pointIndex;
        this._supplied = null;
        this._clearTimer();
        this._detach();
        this._changed();
    }
}
