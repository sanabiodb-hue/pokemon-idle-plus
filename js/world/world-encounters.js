// ============================================================
// Mundo visual · ciclo de caça nos mapas de caça (Fases 7.6 e 7.7). LÓGICA pura: sem DOM, sem Canvas, sem quadros de animação.
//
//   Ciclo (WorldEncounters.cycle): sessão de caça ativa → escolhe o ponto → calcula o caminho → o personagem CAMINHA (progresso em px
//   ao longo do caminho) → chegada → batalha pela entrada oficial startBattle() → resultado → próximo ponto → caminha de novo.
//
//   - O estado do ciclo é EM MEMÓRIA, exceto `session.world` = { speciesId, seq, last, to, progressPx } na sessão de caça salva: o suficiente
//     para reconstruir o ciclo E a perna atual (o caminho e a posição são recalculados do mapa determinístico; `progressPx` é a distância
//     já percorrida na perna e `to` o destino, usado só para validar). Atualizado a cada salvamento (beforeSave) sem avançar o estado.
//     Sessão, batalha, recompensas e contadores são do GameCore.
//   - O ciclo começa por AÇÃO EXPLÍCITA (begin). Abrir/visualizar um mapa nunca cria encontro nem batalha.
//   - Modelo de deslocamento compartilhado (online = offline): o estado é o PROGRESSO em px de uma perna (leg). Online o progresso
//     avança pelo relógio do jogo (preguiçosamente, a cada leitura, mais um timer de despertar em min(1 s, tempo até chegar));
//     offline o Fast Driver gasta o tempo restante do percurso de uma vez (fastTravel). A chegada é sempre "progresso >= comprimento".
//   - Batalha: startBattle() consulta o gancho (game.encounterHook) onde escolheria o inimigo, depois da guarda central: chegou →
//     entrega a espécie do mapa; caminhando → SEGURA (nada de batalha de rota); nada se perde porque a perna fica "arrived" até a
//     entrega. Pausa congela; página escondida congela; offline continua o mesmo ciclo; parar a caçada, Torre ou sair do mapa
//     encerram o ciclo (uma batalha em curso nunca é abortada).
//   - Seleção de pontos: worldPickEncounterPoint (PRNG semeado por mapa + id da sessão + sequência; sem repetir o ponto anterior).
//   - Caminho: worldFindPath (BFS; vizinhos esquerda, direita, cima, baixo; ver world-engine.js).
// ============================================================
const WORLD_ENCOUNTER_STATES = ['idle', 'approaching', 'arrived', 'battling', 'resolved', 'cancelled'];
const WORLD_ENCOUNTER_ACTIVE = ['approaching', 'arrived', 'battling'];
const WORLD_ENCOUNTER_VERSION = 1;
const WORLD_HUNT_TICK_MS = 1000;      // despertar máximo do timer de progresso (a chegada acorda no instante exato, se vier antes)

// Índices dos pontos candidatos realmente usáveis (dentro do mapa e em terreno andável), na ordem original dos dados
function worldEncounterCandidates(map) {
    const out = [];
    if (!map || !Array.isArray(map.encounterPoints)) return out;
    map.encounterPoints.forEach((p, i) => {
        if (p && Number.isInteger(p.x) && Number.isInteger(p.y) && !worldCellBlocked(map, p.x, p.y)) out.push(i);
    });
    return out;
}

// Ponto do próximo encontro. Puro e determinístico: (mapa, id da sessão, sequência, índices a evitar) → índice. Sem tentativas
// repetidas: sorteia uma vez num conjunto já filtrado (sem o último, se houver outro). Um único candidato é reaproveitado.
function worldPickEncounterPoint(map, sessionId, sequence, lastIndex, skip) {
    let valid = worldEncounterCandidates(map);
    if (skip && skip.length) { const rest = valid.filter(i => !skip.includes(i)); if (rest.length) valid = rest; }
    if (valid.length === 0) return null;
    const pool = valid.length > 1 ? valid.filter(i => i !== lastIndex) : valid;
    const rnd = worldRng(worldStringSeed(`enc:v${WORLD_ENCOUNTER_VERSION}:${map.id}:${sessionId}:${sequence}`));
    return pool[Math.floor(rnd() * pool.length)];
}

// Posição (px do mundo) de partida do percurso: o pé do ponto anterior, ou o do ponto inicial do mapa
function worldEncounterOrigin(map, lastIndex) {
    const last = lastIndex !== null && lastIndex !== undefined && map.encounterPoints ? map.encounterPoints[lastIndex] : null;
    return worldCellFoot(last || map.spawn);
}

class WorldEncounters {
    constructor(game) {
        this.game = game;
        this.cycle = null;              // ciclo ativo: { speciesId, mapId, sessionId, seq, last, leg, pendingLeg, walkedBefore, delayMs }
        this.current = null;            // registro da perna atual/última (para a interface e os testes)
        this.lastResult = null;         // { id, outcome } da última batalha resolvida/cancelada
        this._unsubs = [];
        this._timer = null;
        this._hidden = false;           // página escondida: o avanço online fica congelado
        this._offline = false;          // simulação offline em curso: o Fast Driver conduz o ciclo
        this._supplied = null;          // inimigo entregue a startBattle (para reconhecer a batalha certa)
        this._listeners = new Set();
        this._paths = null;             // caminhos já calculados do mapa do ciclo (memo)
        this._restore();
    }

    isActive() { return !!this.cycle; }
    // Há perna em andamento (caminhando, chegada pendente ou batalha)?
    isEncounterActive() { return !!this.current && WORLD_ENCOUNTER_ACTIVE.includes(this.current.state); }

    // Observadores de mudança (a view só desenha a partir disto). Devolve a função de cancelamento.
    onChange(fn) { this._listeners.add(fn); return () => this._listeners.delete(fn); }
    _changed() { this._syncRecord(); if (this._offline) return; for (const fn of [...this._listeners]) { try { fn(this.current); } catch (e) { /* o observador não pode quebrar a lógica */ } } }

    // ---------- início explícito ----------
    // Escolhe o mapa da espécie e INICIA a sessão de caça (ou adota a que já está rodando). Nada acontece sem esta chamada.
    begin(speciesId) {
        const g = this.game;
        const fail = (code, message) => ({ ok: false, code, message });
        if (this.cycle) return fail('already_active', 'Já existe uma caçada ativa neste mapa.');
        if (g._isOfflineSimulating) return fail('offline', 'Aguarde o cálculo offline terminar.');
        if (g._towerMode) return fail('tower_mode', 'Saia da Torre de Desafio para caçar.');
        let map = null;
        try { map = Number.isInteger(speciesId) ? worldHuntMap(speciesId) : null; } catch (e) { map = null; }
        if (!map) return fail('invalid_species', 'Não foi possível abrir o mapa dessa espécie.');
        const session = g.getHuntSession();
        if (session && session.state === 'paused') return fail('hunt_paused', 'Retome a caçada pausada na aba Caça (ou pare-a) antes de começar outra.');
        const adopting = !!session && session.state === 'running';
        this.cycle = { speciesId, mapId: map.id, sessionId: adopting ? session.id : null, seq: 0, last: null, leg: null, pendingLeg: false, walkedBefore: 0, delayMs: 0 };
        this.current = null;
        this._supplied = null;
        this._attach();                                                        // o gancho segura as batalhas de rota ANTES de a sessão começar
        if (!adopting) {
            const r = g.dispatchAutomationAction({ type: 'START_HUNT' });     // entrada oficial da sessão (valida equipe, Torre, offline, política)
            if (!r.ok) { this._teardown(); return fail(r.code || 'start_failed', r.message || 'Não foi possível iniciar a caçada.'); }
        }
        this.cycle.sessionId = g.getHuntSession().id;
        if (!this._startLeg()) { const reason = 'no_path'; this._teardown(); return fail(reason, 'Este mapa não tem um caminho válido até os pontos de encontro.'); }
        return { ok: true, encounter: this.current };
    }

    // Compatibilidade com a F7.6: pedir um encontro = começar o ciclo neste mapa
    request(speciesId) { return this.begin(speciesId); }

    // ---------- pernas (selecionar ponto → caminho → caminhar) ----------
    _map() { try { return this.cycle ? worldHuntMap(this.cycle.speciesId) : null; } catch (e) { return null; } }

    // Caminho entre dois pontos já calculado e verificado (no máximo n x n por mapa; imutável): períodos offline longos repetem pernas sem refazer a busca
    _route(map, fromIdx, toIdx, origin, point) {
        if (!this._paths || this._paths.mapId !== map.id) this._paths = { mapId: map.id, byKey: new Map() };
        const key = `${fromIdx === null ? 's' : fromIdx}:${toIdx}`;
        if (!this._paths.byKey.has(key)) {
            const cells = worldFindPath(map, origin, point);
            const waypoints = cells ? worldPathWaypoints(cells) : null;
            this._paths.byKey.set(key, cells && worldVerifyPath(map, waypoints) ? { cells, waypoints } : null);
        }
        return this._paths.byKey.get(key);
    }

    // saved: registro `session.world` ao reconstruir depois de carregar (valida e retoma o progresso da perna), senão undefined
    _startLeg(saved) {
        const c = this.cycle, g = this.game, map = this._map(), session = g.getHuntSession();
        if (!c || !map || !session) return false;
        const origin = (c.last !== null && map.encounterPoints[c.last]) || map.spawn;
        const skip = [];
        for (let attempt = 0; attempt < map.encounterPoints.length; attempt++) {
            const idx = worldPickEncounterPoint(map, session.id, c.seq, c.last, skip);
            if (idx === null) return false;
            const point = map.encounterPoints[idx];
            const route = this._route(map, c.last, idx, origin, point);
            const cells = route && route.cells, waypoints = route && route.waypoints;
            if (route) {
                const sequence = c.seq;
                c.seq = sequence + 1;
                c.leg = { sequence, pointIndex: idx, point: { x: point.x, y: point.y }, cells, waypoints, lengthPx: worldPolylineLength(waypoints), progressPx: 0, lastAt: g.now(), dir: 'down', state: 'approaching' };
                this.current = {
                    id: `${map.id}#${sequence}`, sequence, mapId: map.id, speciesId: c.speciesId, pointIndex: idx, point: { x: point.x, y: point.y },
                    state: 'approaching', lengthPx: c.leg.lengthPx, etaMs: Math.ceil(c.leg.lengthPx / WORLD_MOVEMENT.walkSpeed * 1000), remainingMs: 0, progressPx: 0, outcome: null, reason: null,
                };
                c.pendingLeg = false;
                this._restoreProgress(saved);
                this._persist(session);                                            // o suficiente para reconstruir o ciclo e a perna
                this._arm();
                this._changed();
                return true;
            }
            skip.push(idx);                                                    // destino inalcançável: tenta o próximo candidato (sem travar a sessão)
            c.seq++;
        }
        return false;
    }

    // Retoma o progresso salvo SÓ se descreve esta mesma perna (mesma sequência e mesmo destino recalculado) e é um número válido; senão começa do zero
    _restoreProgress(saved) {
        const c = this.cycle, leg = c.leg, g = this.game;
        if (!saved || !leg) return;
        const ok = saved.seq === leg.sequence && saved.to === leg.pointIndex && Number.isFinite(saved.progressPx) && saved.progressPx > 0;
        if (!ok) return;
        leg.progressPx = Math.min(saved.progressPx, leg.lengthPx);
        if (leg.progressPx >= leg.lengthPx) {
            leg.state = 'arrived';                                                 // já tinha chegado: a entrega do inimigo continua de onde parou
            this.current.state = 'arrived';
            const enemy = g.gameState && g.gameState.currentEnemy;
            if (enemy && enemy.id === c.speciesId) this._supplied = enemy;         // batalha que estava em curso e volta pelo save: não abre outra para a mesma perna
        }
    }

    // Escreve em `session.world` o que reconstrói o ciclo (nunca matrizes nem o caminho). Não avança nada: só projeta o progresso até agora
    _persist(session, projectNow) {
        const c = this.cycle, leg = c && c.leg;
        if (!c || !session) return;
        if (!leg || leg.state === 'resolved') { session.world = { speciesId: c.speciesId, seq: c.seq, last: c.last }; return; }
        let progress = leg.progressPx;
        if (projectNow && leg.state === 'approaching' && this._isLive()) progress = Math.min(leg.lengthPx, progress + WORLD_MOVEMENT.walkSpeed * Math.max(0, this.game.now() - leg.lastAt) / 1000);
        session.world = { speciesId: c.speciesId, seq: leg.sequence, last: c.last, to: leg.pointIndex, progressPx: Math.round(progress * 1000) / 1000 };
    }

    // Chamado antes de cada salvamento (GameCore._prepareStateForSave)
    beforeSave() {
        const c = this.cycle, session = c && this.game.getHuntSession();
        if (!c || !session || (c.sessionId !== null && session.id !== c.sessionId)) return;
        this._persist(session, true);
    }

    // ---------- progresso lógico ----------
    _isLive() { return !!this.cycle && !this._hidden && !this._offline && this.game.isHuntRunning(); }

    // Avança o progresso da perna até `now` (relógio do jogo). force = ignora o estado da sessão (congelar no instante da pausa).
    _advance(now, force) {
        const c = this.cycle, leg = c && c.leg;
        if (!leg || leg.state !== 'approaching') return;
        if (!force && !this._isLive()) return;
        const dt = Math.max(0, now - leg.lastAt);
        leg.lastAt = now;
        leg.progressPx = Math.min(leg.lengthPx, leg.progressPx + WORLD_MOVEMENT.walkSpeed * dt / 1000);
        if (leg.progressPx >= leg.lengthPx) this._arrive();
    }

    _syncRecord() {
        const c = this.cycle, leg = c && c.leg, rec = this.current;
        if (!rec || !leg || rec.sequence !== leg.sequence) return;
        rec.progressPx = leg.progressPx;
        rec.remainingMs = Math.max(0, (leg.lengthPx - leg.progressPx) / WORLD_MOVEMENT.walkSpeed * 1000);
        if (WORLD_ENCOUNTER_ACTIVE.includes(rec.state)) rec.state = leg.state;
    }

    _arm() {
        this._clearTimer();
        const c = this.cycle, leg = c && c.leg;
        if (!leg || leg.state !== 'approaching' || !this._isLive()) return;
        const remainingMs = (leg.lengthPx - leg.progressPx) / WORLD_MOVEMENT.walkSpeed * 1000;
        this._timer = this.game.clock.setTimer(() => this._onTimer(), Math.max(0, Math.min(WORLD_HUNT_TICK_MS, Math.ceil(remainingMs))));
    }

    _clearTimer() {
        if (this._timer !== null) { this.game.clock.clearTimer(this._timer); this._timer = null; }
    }

    _onTimer() {
        this._timer = null;
        const c = this.cycle, g = this.game;
        if (!c) return;
        if (g._isOfflineSimulating) { this._teardown('offline'); return; }
        if (g._towerMode) { this._teardown('tower_mode'); return; }
        this._advance(g.now());
        this._changed();
        this._arm();
    }

    // O personagem chegou ao ponto: a perna fica "arrived" até a entrega do inimigo (nada é perdido se a guarda recusar)
    _arrive() {
        const leg = this.cycle.leg;
        leg.state = 'arrived';
        leg.progressPx = leg.lengthPx;
        this._clearTimer();
        this._changed();
        if (this.game.isHuntRunning() && this._isLive()) this.game.startBattle();     // entrada oficial; se a guarda recusar, o encadeamento do jogo oferece a vez depois
    }

    // Estado lógico do personagem no mapa (posição, direção, se está andando), lido pela view. Só avança o relógio; não desenha nada.
    hunterState(map) {
        const c = this.cycle, leg = c && c.leg;
        if (!c || !leg || !map || c.mapId !== map.id) return null;
        this._advance(this.game.now());
        const pos = worldPathPosition(leg.waypoints, leg.progressPx, leg.dir);
        leg.dir = pos.dir;
        return { mapId: map.id, x: pos.x, y: pos.y, dir: pos.dir, moving: leg.state === 'approaching' && this._isLive(), distance: c.walkedBefore + leg.progressPx };
    }

    // ---------- gancho consultado por startBattle() (depois da guarda central) ----------
    // A caçada do mundo está ativa (e viva): batalhas de rota ficam SEGURAS enquanto ela caminha
    holdsBattles() {
        const c = this.cycle, g = this.game;
        if (!c || g._isOfflineSimulating || g._towerMode) return false;
        const session = g.getHuntSession();
        if (c.sessionId === null) return true;                      // a sessão está sendo iniciada por begin()
        if (!session || session.id !== c.sessionId || !(session.state === 'running' || session.state === 'paused')) { this._teardown('session_changed'); return false; }
        return true;                                                // rodando OU pausada: nenhuma batalha de rota enquanto o ciclo do mundo existir
    }

    takeArrivedEnemy() {
        const c = this.cycle, g = this.game, leg = c && c.leg;
        if (!leg || leg.state !== 'arrived' || !this.holdsBattles() || !g.isHuntRunning()) return null;    // pausada: espera a retomada
        try {
            const enemy = this._makeEnemy(null);
            if (!enemy) { this._teardown('generation_failed'); return null; }
            this._supplied = enemy;
            return enemy;
        } catch (e) {
            this._teardown('generation_failed');
            return null;
        }
    }

    // Inimigo da espécie do mapa pelo gerador do jogo (nível da rota, IVs, shiny...); `cache` só no Fast Driver
    _makeEnemy(cache) {
        const g = this.game, route = g.getRoute(g.gameState.currentRoute);
        const levelRange = route && Array.isArray(route.levelRange) ? route.levelRange : [5, 5];
        return g.generateWildPokemon({ pokemon: [{ id: this.cycle.speciesId, weight: 1, levelRange }] }, cache);
    }

    // ---------- cancelamento / encerramento ----------
    // Encerra o ciclo (uma batalha já em curso não é abortada: só deixa de ser acompanhada)
    cancel(reason) {
        if (!this.cycle) return false;
        this._teardown(reason || 'cancelled');
        return true;
    }

    _teardown(reason) {
        const c = this.cycle, g = this.game, rec = this.current;
        if (!c) return;
        const battle = g.currentBattle;
        const inBattle = !!(this._supplied && battle && battle.wild === this._supplied);
        this._clearTimer();
        if (!inBattle && this._supplied && g.gameState && g.gameState.currentEnemy === this._supplied) g.gameState.currentEnemy = null;   // entregue mas sem batalha: não deixa pendente
        if (rec && WORLD_ENCOUNTER_ACTIVE.includes(rec.state)) {
            this._syncRecord();
            rec.state = 'cancelled'; rec.reason = reason || 'cancelled'; rec.outcome = 'cancelled';
            this.lastResult = { id: rec.id, outcome: 'cancelled', reason: rec.reason };
        }
        const session = g.getHuntSession();
        if (session && session.world) delete session.world;
        this._supplied = null;
        this.cycle = null;
        this._paths = null;
        this._detach();
        this._changed();
    }

    // A view avisa quando o jogador troca a área exibida: sair do mapa encerra o ciclo (sem avançar nada invisivelmente)
    onAreaChanged(areaId) {
        if (this.cycle && this.cycle.mapId !== areaId) this._teardown('left_map');
    }

    // ---------- assinaturas ----------
    _attach() {
        this._detach();
        const bus = this.game.bus;
        this.game.encounterHook = this;
        this._unsubs = [
            bus.on('battle_started', (e) => this._onBattleStarted(e)),
            bus.on('battle_completed', (e) => this._onBattleCompleted(e)),
            bus.on('hunt_paused', (e) => { if (!this._offlineEvent(e)) this._onPaused(); }),
            bus.on('hunt_resumed', (e) => { if (!this._offlineEvent(e)) this._onResumed(); }),
            bus.on('hunt_stopped', () => this._teardown('hunt_stopped')),
        ];
    }

    _detach() {
        for (const off of this._unsubs) off();
        this._unsubs = [];
        if (this.game.encounterHook === this) this.game.encounterHook = null;
    }

    // Eventos da simulação offline não conduzem o ciclo (o Fast Driver chama fastTravel/fastResolved diretamente)
    _offlineEvent(e) { return !!((e && e.offline) || this.game._isOfflineSimulating || this._offline); }

    _onPaused() {
        const c = this.cycle;
        if (!c) return;
        this._advance(this.game.now(), true);                       // aplica o tempo até o instante da pausa, uma única vez
        this._clearTimer();
        this._changed();
    }

    _onResumed() {
        const c = this.cycle, leg = c && c.leg;
        if (!c) return;
        if (c.pendingLeg || !leg) { this._startLeg(); return; }     // pausada com a leg resolvida: só agora escolhe o próximo ponto
        leg.lastAt = this.game.now();                               // o tempo pausado não conta
        this._arm();
        this._changed();
    }

    _onBattleStarted(e) {
        if (this._offlineEvent(e)) return;
        const c = this.cycle, g = this.game, leg = c && c.leg;
        if (leg && leg.state === 'arrived' && this._supplied && g.currentBattle && g.currentBattle.wild === this._supplied) {
            leg.state = 'battling';
            this._changed();
        }
    }

    _onBattleCompleted(e) {
        if (this._offlineEvent(e)) return;
        const c = this.cycle, leg = c && c.leg;
        if (!leg || leg.state !== 'battling') return;              // só a batalha do encontro; resultado/recompensas já foram contados pelo jogo
        this._resolve(e && e.result === 'defeat' ? 'defeat' : 'victory');
        if (!this.cycle) return;
        if (this.game.isHuntRunning()) this._startLeg(); else this.cycle.pendingLeg = true;
    }

    // Registra o resultado e deixa o personagem parado no ponto, pronto para escolher o próximo
    _resolve(outcome) {
        const c = this.cycle, leg = c.leg;
        leg.state = 'resolved';
        c.last = leg.pointIndex;
        c.walkedBefore += leg.lengthPx;
        this._supplied = null;
        if (this.current && this.current.sequence === leg.sequence) { this.current.state = 'resolved'; this.current.outcome = outcome; }
        this.lastResult = { id: this.current ? this.current.id : null, outcome };
        this._changed();
    }

    // ---------- página escondida e simulação offline (mesmo ciclo, sem renderizar) ----------
    onHidden() {
        if (!this.cycle) return;
        this._advance(this.game.now());                            // aplica até o instante em que escondeu
        this._clearTimer();
        this._hidden = true;
    }

    // offlinePending: o tempo escondido passa de 2 s e a simulação offline vai continuar o ciclo (ela religa depois)
    onVisible(offlinePending) {
        if (!this.cycle || !this._hidden) return;
        this._hidden = false;
        if (offlinePending) { this._offline = true; return; }
        this._advance(this.game.now());                            // ≤ 2 s: aplica o tempo escondido uma única vez
        this._changed();
        this._arm();
    }

    // Caçada do mundo pausada pelo jogador (não por recarga): o offline não pode avançar nada dela
    offlineSuspended() {
        const s = this.cycle ? this.game.getHuntSession() : null;
        return !!s && s.state === 'paused' && s.pausedByReload !== true;
    }

    onOfflineBegin() {
        if (!this.cycle) return;
        this._offline = true; this._hidden = false; this._clearTimer();
        const leg = this.cycle.leg;
        if (leg && leg.state === 'battling') { leg.state = 'arrived'; if (this.current) this.current.state = 'arrived'; }
        this._supplied = null;   // a luta em curso é descartada pelo offline: a chegada volta a valer
    }

    onOfflineEnd() {
        if (!this.cycle) return;
        this._offline = false;
        const leg = this.cycle.leg;
        if (leg) leg.lastAt = this.game.now();                     // o tempo offline já foi aplicado pelo Fast Driver: não reaplicar
        this._arm();
        this._changed();
    }

    // Fast Driver: gasta, de uma vez, o tempo restante do percurso (ou o que couber em remainingMs). Devolve { spentMs, arrived }.
    fastTravel(remainingMs) {
        const c = this.cycle;
        if (!c) return null;
        if (!c.leg || c.pendingLeg) { if (!this._startLeg()) return null; }
        const leg = c.leg;
        if (leg.state === 'arrived') { const wait = Math.min(Math.max(0, c.delayMs), remainingMs); c.delayMs = Math.max(0, c.delayMs - wait); return { spentMs: wait, arrived: c.delayMs === 0 }; }
        const needMs = (leg.lengthPx - leg.progressPx) / WORLD_MOVEMENT.walkSpeed * 1000;
        const totalMs = Math.max(needMs, c.delayMs);                // o atraso até a próxima batalha corre junto com a caminhada (como online)
        if (totalMs > remainingMs) {
            leg.progressPx = Math.min(leg.lengthPx, leg.progressPx + WORLD_MOVEMENT.walkSpeed * Math.max(0, remainingMs) / 1000);
            c.delayMs = Math.max(0, c.delayMs - Math.max(0, remainingMs));
            return { spentMs: Math.max(0, remainingMs), arrived: false };
        }
        leg.progressPx = leg.lengthPx;
        leg.state = 'arrived';
        c.delayMs = 0;
        return { spentMs: totalMs, arrived: true };
    }

    // Inimigo da perna atual para o Fast Driver (mesmo gerador do jogo; não guarda nada)
    fastEnemy(cache) { return this.cycle ? this._makeEnemy(cache) : null; }

    // Fast Driver: a batalha da perna terminou. Registra, define o atraso até a próxima e escolhe o próximo ponto (mesma função da versão online)
    fastResolved(outcome, delayMs) {
        const c = this.cycle;
        if (!c || !c.leg) return;
        this._resolve(outcome);
        c.delayMs = Math.max(0, delayMs || 0);
        if (this.game.isHuntRunning()) this._startLeg(); else c.pendingLeg = true;
    }

    // ---------- reconstrução após carregar o save (sessão com `world`) ----------
    // Reconstrói o ciclo e a perna atual a partir de { speciesId, seq, last, to, progressPx }. Qualquer campo ausente ou inválido cai em
    // recuperação segura: perna do mesmo destino determinístico, do zero. Nada anda e nenhuma batalha começa aqui (sessão pausada).
    _restore() {
        const g = this.game, s = g.getHuntSession ? g.getHuntSession() : null, w = s && s.world;
        if (!w || !(s.state === 'running' || s.state === 'paused')) return;
        if (!Number.isInteger(w.speciesId) || !_worldHas(POKEMON_DATA, String(w.speciesId))) return;
        this.cycle = { speciesId: w.speciesId, mapId: `hunt_${w.speciesId}`, sessionId: s.id, seq: w.seq, last: w.last, leg: null, pendingLeg: true, walkedBefore: 0, delayMs: 0 };
        this._attach();
        if (!this._startLeg(w)) this.cycle.pendingLeg = true;       // sem perna reconstruível: a retomada (ou o offline) tenta de novo
    }
}
