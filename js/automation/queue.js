// ============================================================
// F8.1 · Fila sequencial de alvos da caça
//
// FONTE DE VERDADE: gameState.automation.queue (persistida junto da política e da sessão):
//   { items: [{ speciesId, condition: { type: 'time'|'battles', value } }], index, state, sessionId, haltReason }
//   state: 'idle' (montada, nada rodou) | 'running' (o alvo `index` está em andamento — sessionId — ou aguarda o início, sessionId null)
//          | 'halted' (parou por outro motivo; mantém a posição) | 'done' (todos concluídos; estado final estável)
//   Alvo i: concluído se i < index; ativo se state='running' e i === index; pendente se i >= index (fora o ativo).
//   Não há "status por item": um único índice evita cópias que divirjam.
// Cada alvo é uma SESSÃO de caça própria, iniciada pela entrada oficial (WorldEncounters.begin). A duração do alvo usa o mecanismo de parada
// por tempo/por batalhas que já existem: o motor lê a condição do alvo ativo como ÚNICO limite da sessão (engine._snapshot: o limite escolhido vale e o
// outro limite global fica desligado; condições globais de interrupção — shiny, sem poções, rota completa — continuam valendo). A sessão para com o
// motivo da condição: time_limit (type 'time', value = minutos) ou battle_limit (type 'battles', value = batalhas concluídas, vitórias e derrotas).
// Só esse motivo, vindo da sessão DA FILA, conclui o alvo; qualquer outro motivo de parada interrompe a fila (halted) sem avançar.
// O progresso NUNCA é um contador novo: batalhas = session.stats.battles (contado uma vez pelo motor em cada battle_completed da sessão em andamento e
// salvo com a sessão); tempo = huntSessionDurationMs. Itens de saves antigos ({ speciesId, minutes }) viram { type: 'time', value: minutes } ao carregar.
// ============================================================

const HUNT_QUEUE_MAX_ITEMS = 20;
const HUNT_QUEUE_MIN_MINUTES = 1;
const HUNT_QUEUE_MAX_MINUTES = 1440;
const HUNT_QUEUE_DEFAULT_MINUTES = 10;
// Batalhas por alvo: 24 h de caçada no ciclo do mundo rendem ~6.200 batalhas (medido na F7.11), então 10.000 cobre o teto de 24 h do tempo com folga e
// fica muito abaixo do limite de política do motor (1e9), que é o mecanismo reutilizado.
const HUNT_QUEUE_MIN_BATTLES = 1;
const HUNT_QUEUE_MAX_BATTLES = 10000;
const HUNT_QUEUE_DEFAULT_BATTLES = 50;
const HUNT_QUEUE_CONDITION_TYPES = ['time', 'battles'];
const HUNT_QUEUE_COMPLETION_REASON = { time: 'time_limit', battles: 'battle_limit' };

// Condição válida { type, value } ou null. Atalho aceito: um número = minutos (contrato da F8.1).
function huntQueueNormalizeCondition(c) {
    if (typeof c === 'number') c = { type: 'time', value: c };
    if (!_isObj(c) || !HUNT_QUEUE_CONDITION_TYPES.includes(c.type) || !Number.isInteger(c.value)) return null;
    const [lo, hi] = c.type === 'time' ? [HUNT_QUEUE_MIN_MINUTES, HUNT_QUEUE_MAX_MINUTES] : [HUNT_QUEUE_MIN_BATTLES, HUNT_QUEUE_MAX_BATTLES];
    return c.value >= lo && c.value <= hi ? { type: c.type, value: c.value } : null;
}
// Item de save (formato novo ou o antigo só com minutes) → condição única; novo formato vale se existir.
function huntQueueItemCondition(it) {
    if (!_isObj(it)) return null;
    if (_isObj(it.condition)) return huntQueueNormalizeCondition(it.condition);
    return Object.prototype.hasOwnProperty.call(it, 'minutes') ? huntQueueNormalizeCondition({ type: 'time', value: it.minutes }) : null;
}
function huntQueueConditionLabel(c) { return c.type === 'battles' ? `${c.value} ${c.value === 1 ? 'batalha' : 'batalhas'}` : `${c.value} min`; }
// Progresso do alvo ATIVO, derivado da sessão real: { type, value, current } (current = batalhas concluídas ou minutos decorridos)
function huntQueueProgress(item, session, nowMs) {
    if (!item || !session) return null;
    const c = item.condition;
    return { type: c.type, value: c.value, current: c.type === 'battles' ? Math.min(session.stats.battles, c.value) : Math.min(c.value, Math.floor(huntSessionDurationMs(session, nowMs) / 60000)) };
}
const HUNT_QUEUE_STATES = ['idle', 'running', 'halted', 'done'];

function defaultHuntQueue() { return { items: [], index: 0, state: 'idle', sessionId: null, haltReason: null }; }

// Limpeza de save/importação: sempre devolve uma fila coerente (ou null se não há fila). `session` = sessão já limpa do mesmo save (ou undefined).
function sanitizeHuntQueue(raw, session) {
    if (!_isObj(raw)) return null;
    const items = [];
    const seen = new Set();
    let dropped = false;
    const list = Array.isArray(raw.items) ? raw.items : [];
    for (const it of list.slice(0, HUNT_QUEUE_MAX_ITEMS)) {
        const condition = huntQueueItemCondition(it);
        const ok = _isObj(it) && Number.isInteger(it.speciesId) && it.speciesId >= 1 && it.speciesId <= 9999999 && condition !== null && !seen.has(it.speciesId);
        if (!ok) { dropped = true; continue; }
        seen.add(it.speciesId);
        items.push({ speciesId: it.speciesId, condition });
    }
    if (list.length > HUNT_QUEUE_MAX_ITEMS) dropped = true;
    const q = defaultHuntQueue();
    q.items = items;
    if (!items.length) return null;                                         // fila vazia = sem fila (save antigo e fila apagada são iguais)
    let state = HUNT_QUEUE_STATES.includes(raw.state) ? raw.state : 'idle';
    let index = Number.isInteger(raw.index) && raw.index >= 0 ? Math.min(raw.index, items.length) : 0;
    let haltReason = typeof raw.haltReason === 'string' && /^[a-z_]{1,40}$/.test(raw.haltReason) ? raw.haltReason : null;
    const sessionId = typeof raw.sessionId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(raw.sessionId) ? raw.sessionId : null;
    if (dropped && state !== 'idle') { state = 'halted'; haltReason = 'invalid_data'; index = Math.min(index, items.length - 1); }   // itens descartados deslocam a posição: pára e deixa o jogador decidir
    if (state === 'idle') { index = 0; }
    if (state === 'done' && index < items.length) { state = 'halted'; haltReason = haltReason || 'invalid_data'; }
    if (state === 'running' && index >= items.length) { state = 'done'; index = items.length; }
    if (state === 'halted' && index >= items.length) { state = 'done'; index = items.length; haltReason = null; }
    q.index = index; q.state = state; q.haltReason = state === 'halted' ? (haltReason || 'unknown') : null;
    q.sessionId = state === 'running' ? sessionId : null;
    // a sessão da fila tem de existir e ainda estar viva; senão a fila pára na posição (o alvo recomeça quando o jogador continuar)
    if (q.state === 'running' && q.sessionId !== null && !(session && session.id === q.sessionId && (session.state === 'running' || session.state === 'paused'))) {
        q.state = 'halted'; q.haltReason = 'session_lost'; q.sessionId = null;
    }
    return q;
}

// Leitura pura (não escreve nada): fila normalizada + derivados para a interface e para a matriz de controles.
function huntQueueView(game) {
    const a = game && game.gameState && game.gameState.automation;
    const q = a && a.queue ? a.queue : defaultHuntQueue();
    const total = q.items.length;
    const awaiting = q.state === 'running' && q.sessionId === null && q.index < total;
    return {
        items: q.items.map(i => ({ speciesId: i.speciesId, condition: { type: i.condition.type, value: i.condition.value } })),
        index: q.index, state: q.state, sessionId: q.sessionId, haltReason: q.haltReason, total, awaiting,
        activeItem: (q.state === 'running' && q.sessionId !== null) ? q.items[q.index] || null : null,
        nextItem: q.index < total ? q.items[q.index] : null,
    };
}
function huntQueueStatusOf(view, i) {
    if (i < view.index) return 'done';
    if (view.state === 'running' && view.sessionId !== null && i === view.index) return 'active';
    return 'pending';
}

class HuntQueue {
    // enc: WorldEncounters (entrada oficial dos alvos). Estado transitório mínimo: assinaturas e as marcas de "avançar uma única vez".
    constructor(game, enc) {
        this.game = game;
        this.enc = enc;
        this._unsubs = [];
        this._encUnsub = null;
        this._pending = false;              // avanço agendado e ainda não consumido (garante UMA só execução)
        this._kickAfterOffline = false;     // o alvo terminou durante o cálculo offline: o próximo começa quando ele acabar
        game.queueHook = this;
        this._reconcile();                  // depois de carregar: a sessão da fila precisa ainda ter o seu ciclo do mundo
        this.sync();
    }

    // ---------- leitura ----------
    view() { return huntQueueView(this.game); }
    _q() { const a = this.game.gameState && this.game.gameState.automation; return a && a.queue ? a.queue : null; }
    _w() {                                                  // fila gravável (cria a fatia da automação como START_HUNT faz)
        const gs = this.game.gameState;
        if (!gs.automation) gs.automation = { policy: this.game.getAutomationPolicy() };
        if (!gs.automation.queue) gs.automation.queue = defaultHuntQueue();
        return gs.automation.queue;
    }
    isLocked(i) {
        const v = this.view();
        return i < v.index || (v.state === 'running' && v.sessionId !== null && i === v.index);
    }

    _fail(code, message) { return { ok: false, code, message }; }
    _changed(kind, extra) {
        this.sync();
        this.game.save();
        this.game._emit('hunt_queue', { kind, ...extra });
    }

    // ---------- edição ----------
    // condition: { type: 'time', value: minutos } | { type: 'battles', value: batalhas } | um número (= minutos, como na F8.1)
    add(speciesId, condition = HUNT_QUEUE_DEFAULT_MINUTES) {
        if (!Number.isInteger(speciesId) || speciesId < 1 || typeof POKEMON_DATA === 'undefined' || !POKEMON_DATA[speciesId]) return this._fail('invalid_species', 'Espécie inválida.');
        const cond = huntQueueNormalizeCondition(condition);
        if (!cond) {
            const battles = _isObj(condition) && condition.type === 'battles';
            return battles ? this._fail('invalid_battles', `A quantidade deve ser de ${HUNT_QUEUE_MIN_BATTLES} a ${HUNT_QUEUE_MAX_BATTLES} batalhas.`)
                : this._fail('invalid_minutes', `A duração deve ser de ${HUNT_QUEUE_MIN_MINUTES} a ${HUNT_QUEUE_MAX_MINUTES} minutos.`);
        }
        const v = this.view();
        if (v.state === 'done') return this._fail('queue_done', 'A fila terminou. Limpe-a para montar outra.');
        if (v.items.some(i => i.speciesId === speciesId)) return this._fail('duplicate', 'Essa espécie já está na fila.');
        if (v.total >= HUNT_QUEUE_MAX_ITEMS) return this._fail('queue_full', `A fila comporta no máximo ${HUNT_QUEUE_MAX_ITEMS} alvos.`);
        this._w().items.push({ speciesId, condition: cond });
        this._changed('edited', { op: 'add', speciesId });
        return { ok: true };
    }

    remove(i) {
        const v = this.view();
        if (!Number.isInteger(i) || i < 0 || i >= v.total) return this._fail('invalid_index', 'Alvo inexistente.');
        if (this.isLocked(i)) return this._fail('locked', i < v.index ? 'Alvos concluídos não podem ser removidos.' : 'O alvo em andamento não pode ser removido.');
        const q = this._w();
        q.items.splice(i, 1);
        if (!q.items.length) this._reset();                  // fila esvaziada = sem fila
        else if (q.state === 'running' && q.sessionId === null && q.index >= q.items.length) { q.state = 'done'; q.index = q.items.length; }
        else if (q.state === 'halted' && q.index >= q.items.length) { q.state = 'done'; q.index = q.items.length; q.haltReason = null; }
        this._changed('edited', { op: 'remove', index: i });
        return { ok: true };
    }

    move(i, delta) {
        const v = this.view(), j = i + delta;
        if (!Number.isInteger(i) || (delta !== 1 && delta !== -1) || i < 0 || j < 0 || i >= v.total || j >= v.total) return this._fail('invalid_index', 'Movimento inválido.');
        if (this.isLocked(i) || this.isLocked(j)) return this._fail('locked', 'Só os alvos pendentes podem ser reordenados.');
        const q = this._w();
        [q.items[i], q.items[j]] = [q.items[j], q.items[i]];
        this._changed('edited', { op: 'move', index: i });
        return { ok: true };
    }

    clear() {
        const v = this.view();
        if (v.state === 'running' && v.sessionId !== null) return this._fail('queue_running', 'Encerre a caçada em andamento antes de limpar a fila.');
        this._reset();
        this._changed('edited', { op: 'clear' });
        return { ok: true };
    }

    _reset() {
        const a = this.game.gameState.automation;
        if (a) delete a.queue;
        this._pending = false; this._kickAfterOffline = false;
    }

    // ---------- execução ----------
    // Inicia a fila (idle), continua depois de uma interrupção (halted) ou do aguardo (running sem sessão).
    start() {
        const g = this.game, v = this.view();
        if (!v.total) return this._fail('empty_queue', 'Adicione alvos à fila primeiro.');
        if (v.state === 'done') return this._fail('queue_done', 'A fila terminou. Limpe-a para montar outra.');
        if (v.state === 'running' && v.sessionId !== null) return this._fail('queue_running', 'A fila já está em andamento.');
        const s = g.getHuntSession();
        if (s && (s.state === 'running' || s.state === 'paused')) return this._fail('hunt_active', 'Já existe uma caçada em andamento.');
        if (g._isOfflineSimulating) return this._fail('offline', 'Aguarde o cálculo offline terminar.');
        if (g._towerMode) return this._fail('tower_mode', 'Saia da Torre de Desafio primeiro.');
        return this._startTarget(v.state === 'idle' ? 0 : v.index);
    }

    _startTarget(i) {
        const q = this._w();
        const item = q.items[i];
        if (!item) return this._fail('empty_queue', 'Não há próximo alvo.');
        q.index = i; q.state = 'running'; q.sessionId = null; q.haltReason = null;
        const r = this.enc.begin(item.speciesId);              // entrada oficial: sessão (START_HUNT), ciclo do mundo e primeira perna
        if (!r.ok) {
            q.state = 'halted'; q.haltReason = 'start_failed';
            this._changed('halted', { reason: 'start_failed', code: r.code });
            return r;
        }
        q.sessionId = this.game.getHuntSession().id;
        this._changed('started', { index: i, speciesId: item.speciesId });
        return { ok: true, index: i };
    }

    // ---------- reação ao fim da sessão ----------
    sync() {
        const q = this._q();
        const want = !!q && q.state === 'running';
        if (want && !this._unsubs.length) this._unsubs = [this.game.bus.on('hunt_stopped', (e) => this._onStopped(e))];
        else if (!want && this._unsubs.length) { for (const off of this._unsubs) off(); this._unsubs = []; }     // sem fila rodando: nenhum ouvinte (offline continua sem custo extra)
        if (want && !this._encUnsub && this.enc && this.enc.onChange) this._encUnsub = this.enc.onChange(() => this._onCycleChange());
        else if (!want && this._encUnsub) { this._encUnsub(); this._encUnsub = null; }
    }

    // F8.2: se o ciclo do mundo da sessão da fila acaba SEM a sessão parar (o jogador saiu do mapa de caça, Torre, falha de geração...), a sessão passa a ser
    // uma caçada comum por rota. Batalhas de rota não podem contar para o alvo (nem o tempo dela concluí-lo): a fila pára na posição.
    _onCycleChange() {
        const q = this._q();
        if (!q || q.state !== 'running' || q.sessionId === null || this.game._isOfflineSimulating) return;
        const s = this.game.getHuntSession();
        if (!s || s.id !== q.sessionId || !(s.state === 'running' || s.state === 'paused')) return;      // sessão parada: quem trata é _onStopped
        if (this.enc.status().active) return;
        q.state = 'halted'; q.haltReason = 'cycle_lost'; q.sessionId = null;
        this._changed('halted', { reason: 'cycle_lost' });
    }

    _reconcile() {
        const q = this._q();
        if (!q || q.state !== 'running' || q.sessionId === null) return;
        const s = this.game.getHuntSession();
        if (s && s.id === q.sessionId && (s.state === 'running' || s.state === 'paused') && !this.enc.status().active) {
            q.state = 'halted'; q.haltReason = 'cycle_lost'; q.sessionId = null;
        }
    }

    _onStopped(e) {
        const q = this._q();
        if (!q || q.state !== 'running' || q.sessionId === null || !e || e.id !== q.sessionId) return;   // só a sessão DA fila; evento repetido é inofensivo
        q.sessionId = null;                                                                          // consome o sinal: uma conclusão = um processamento
        const item = q.items[q.index];
        if (item && e.reason === HUNT_QUEUE_COMPLETION_REASON[item.condition.type]) {              // a razão da condição DESTE alvo (tempo → time_limit; batalhas → battle_limit)
            q.index += 1;
            if (q.index >= q.items.length) { q.state = 'done'; this._changed('done', {}); return; }
            this._changed('completed', { index: q.index - 1 });
            if (this.game._isOfflineSimulating) {
                const h = this.game._offlineHunt;
                this._kickAfterOffline = !(h && h.resumeFromReload);                                 // depois de uma recarga tudo volta pausado: o jogador continua
            } else this._schedule();
        } else {
            q.state = 'halted'; q.haltReason = HUNT_STOP_REASONS.includes(e.reason) ? e.reason : 'unknown';
            this._changed('halted', { reason: q.haltReason });
        }
    }

    // Avanço adiado para DEPOIS do despacho do evento em curso (o motor e o controlador do mundo ainda estão encerrando a sessão)
    _schedule() {
        if (this._pending) return;
        this._pending = true;
        Promise.resolve().then(() => this.runPending());
    }

    // Consome o avanço agendado. Idempotente: sem marca pendente não faz nada.
    runPending() {
        if (!this._pending) return null;
        this._pending = false;
        const v = this.view();
        if (!(v.awaiting)) return null;
        const g = this.game, s = g.getHuntSession();
        if (g._isOfflineSimulating) { this._kickAfterOffline = true; return null; }
        if (g._towerMode || (s && (s.state === 'running' || s.state === 'paused'))) return null;
        return this._startTarget(v.index);
    }

    // Chamado por GameCore ao fim do cálculo offline
    onOfflineEnd() {
        if (!this._kickAfterOffline) return;
        this._kickAfterOffline = false;
        this._pending = true;
        this.runPending();
    }
}
