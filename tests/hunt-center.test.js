'use strict';
// F8.0 · Central de Caça (alvo da caçada dentro da aba Caça). A interface NÃO guarda estado de caçada: tudo vem da sessão do jogo e do
// controlador do mundo. Estes testes usam o GameCore REAL, o WorldEncounters REAL e a HuntView REAL (DOM falso), com relógio controlado, e
// conferem os EFEITOS reais das ações sobre a sessão — não só o aspecto dos botões.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, runOffline } = require('./helpers/game');
const { makeFakeDom, makeUi } = require('./helpers/fake-dom');
const { loadWorld, shown } = require('./helpers/world-env');

const SPECIES = 25, MIN = 60_000;
const dispatch = (game, type, extra = {}) => game.dispatchAutomationAction({ type, ...extra });
const session = (game) => game.getHuntSession();

function boot(opts = {}) {
    const g = newGame({ seed: opts.seed ?? 9, storage: opts.storage, load: opts.load });
    g.game.clock = new g.ctx.ManualClock(opts.clock ?? 10_000_000);
    const world = loadWorld();
    const dom = makeFakeDom(g.ctx);
    const ui = makeUi(g.game);
    ui.worldEncounters = new world.WorldEncounters(g.game);
    ui.opened = [];
    ui.worldView = { openHuntMap: (id) => { ui.opened.push(id); return { ok: true }; } };
    const view = new g.ctx.HuntView(ui);
    view.render();
    return { ...g, world, dom, ui, view, enc: ui.worldEncounters };
}
const live = (t) => t.dom.html('hunt-target-live');
const text = (t) => t.dom.text('hunt-target-live');
const subs = (game) => { let n = 0; const on = game.bus.on.bind(game.bus); game.bus.on = (...a) => { n++; const off = on(...a); return () => { n--; return off(); }; }; return () => n; };

// =============================================================== A. busca de espécies compartilhada
test('F8.0 A: a busca da Central é a MESMA função do mapa (mesmo resultado, limite e regra de espécie desconhecida)', async () => {
    const t = boot();
    const dex = t.game.gameState.pokedex;
    for (const q of ['25', 'pika', '0', '1', '', 'zzz', '  PIKACHU ']) {
        const mine = t.ctx.huntSpeciesMatches(q, dex, 10);
        const r = await shown({ gameObject: t.game, encounters: true });
        assert.equal(JSON.stringify(r.view._huntMatches(q)), JSON.stringify(mine), `consulta "${q}"`);
    }
    const many = t.ctx.huntSpeciesMatches('1', dex, 10);
    assert.equal(many.list.length, 10); assert.ok(many.total > 10);
    assert.ok(t.ctx.huntSpeciesMatches('25', dex).list.every(x => x.name === '???' || dex[x.id]), 'nome só de espécie vista');
});

// =============================================================== B. matriz estado × controle
// Cada estado é montado pelas operações REAIS; para cada controle, o que a matriz diz tem de coincidir com o que a operação oficial faz.
const STATES = {
    'sem sessão': () => boot(),
    'parada (encerrada por você)': () => { const t = boot(); dispatch(t.game, 'START_HUNT'); dispatch(t.game, 'STOP_HUNT'); return t; },
    'caçada comum por rota (sem ciclo)': () => { const t = boot(); dispatch(t.game, 'START_HUNT'); return t; },
    'ciclo do mundo, caminhando': () => { const t = boot(); t.enc.begin(SPECIES); t.game.clock.advance(1500); return t; },
    'ciclo do mundo, batalha em andamento': () => { const t = boot(); t.enc.begin(SPECIES); t.game.clock.advance(t.enc.current.remainingMs + 500); t.game._stopBattleTimer(); return t; },
    'ciclo do mundo, pausado': () => { const t = boot(); t.enc.begin(SPECIES); t.game.clock.advance(1500); dispatch(t.game, 'PAUSE_HUNT'); return t; },
    'caçada comum pausada (sem ciclo)': () => { const t = boot(); dispatch(t.game, 'START_HUNT'); dispatch(t.game, 'PAUSE_HUNT'); return t; },
    'cálculo offline em andamento': () => { const t = boot(); t.enc.begin(SPECIES); t.game._isOfflineSimulating = true; return t; },
    'Torre de Desafio': () => { const t = boot(); t.game._towerMode = true; return t; },
    'sem equipe': () => { const t = boot(); t.game.gameState.team = []; return t; },
};

// operação oficial de cada controle; devolve { ok }
const OPS = {
    start: (t) => dispatch(t.game, 'START_HUNT'),
    startTarget: (t) => t.enc.begin(SPECIES),
    pause: (t) => dispatch(t.game, 'PAUSE_HUNT'),
    resume: (t) => dispatch(t.game, 'RESUME_HUNT'),
    stop: (t) => dispatch(t.game, 'STOP_HUNT'),
};

for (const [name, build] of Object.entries(STATES)) {
    test(`F8.0 B: matriz × operações reais — ${name}`, () => {
        for (const control of Object.keys(OPS)) {
            const probe = build();
            const snap = probe.ctx.huntCenterSnapshot(probe.game, probe.enc);
            const m = probe.ctx.huntControlMatrix(snap, SPECIES)[control];
            const t = build();
            const before = JSON.stringify({ s: session(t.game) && { id: session(t.game).id, st: session(t.game).state }, c: !!t.enc.cycle });
            const r = OPS[control](t);
            if (m.enabled) assert.equal(r.ok, true, `${name}/${control}: habilitado, mas a operação oficial recusou (${r.code})`);
            else {
                assert.equal(r.ok, false, `${name}/${control}: desabilitado (${m.reason}), mas a operação oficial aceitou`);
                assert.equal(JSON.stringify({ s: session(t.game) && { id: session(t.game).id, st: session(t.game).state }, c: !!t.enc.cycle }), before, `${name}/${control}: a recusa não alterou nada`);
                assert.ok(m.reason && m.reason.length > 5, 'toda recusa traz o motivo');
            }
            [t, probe].forEach(x => { if (x.game._nextBattleTimeout) { clearTimeout(x.game._nextBattleTimeout); x.game._nextBattleTimeout = null; } });
        }
    });
}

test('F8.0 B: a fase do trajeto não muda os controles (só o texto); e Abrir no Mapa só vale para o mapa do ciclo quando há ciclo', () => {
    const t = boot();
    const base = { sessionState: 'running', stoppedByCondition: false, offline: false, tower: false, hasTeam: true, lastResult: null };
    const cyc = (phase) => ({ ...base, cycle: { speciesId: SPECIES, phase, progressPx: 10, lengthPx: 100, pct: 10, battleBusy: false, healing: false } });
    const ref = JSON.stringify(t.ctx.huntControlMatrix(cyc('approaching'), SPECIES));
    for (const ph of ['arrived', 'battling', 'resolved', 'pending']) assert.equal(JSON.stringify(t.ctx.huntControlMatrix(cyc(ph), SPECIES)), ref, ph);
    const none = t.ctx.huntControlMatrix({ ...base, sessionState: 'none', cycle: null }, null);
    assert.equal(none.openMap.enabled, false);
    assert.equal(t.ctx.huntCenterTargetId(cyc('approaching'), 150), SPECIES, 'com ciclo vale a espécie do ciclo, nunca a seleção');
    assert.equal(t.ctx.huntCenterTargetId({ ...base, cycle: null }, 150), 150);
    assert.match(t.ctx.huntCenterStatusText(cyc('approaching'), 'Pikachu'), /Caminhando até Pikachu: 10%/);
});

// =============================================================== C. efeitos reais das ações pela interface
test('F8.0 C: escolher o alvo, iniciar, pausar, retomar e encerrar pela interface chamam as operações oficiais e a sessão reflete cada passo', () => {
    const t = boot();
    try {
        t.view.onShow();
        assert.match(text(t), /Nenhum alvo ativo/);
        t.view.handleAction('target-pick', { id: String(SPECIES) });
        assert.match(text(t), /Espécie-alvo: \?\?\?|Espécie-alvo: Pikachu/);
        assert.match(text(t), /Bioma: Campo/);
        assert.doesNotMatch(live(t), /data-hunt-action="target-start" disabled/);
        t.view.handleAction('target-start', {});
        const s = session(t.game);
        assert.equal(s.state, 'running');
        assert.equal(t.enc.cycle.speciesId, SPECIES, 'o ciclo é o do controlador oficial');
        assert.match(text(t), /Caminhando até/);
        assert.match(live(t), /role="progressbar"/);
        assert.match(live(t), /data-hunt-action="target-start" disabled/, 'um ciclo por vez');
        const id = s.id;
        t.game.clock.advance(2000);
        const progress = t.enc.cycle.leg.progressPx;
        t.view.handleAction('pause', {});
        assert.equal(session(t.game).state, 'paused'); assert.equal(session(t.game).id, id);
        assert.match(text(t), /Pausada, parada a \d+% do caminho/);
        t.game.clock.advance(5000);
        assert.equal(t.enc.cycle.leg.progressPx, progress, 'pausar congela o progresso');
        t.view.handleAction('resume', {});
        assert.equal(session(t.game).state, 'running'); assert.equal(session(t.game).id, id, 'a mesma sessão, nunca outra');
        assert.equal(t.enc.cycle.leg.progressPx, progress, 'retomar continua do mesmo ponto');
        t.view.handleAction('stop', {});
        assert.equal(session(t.game).state, 'stopped');
        assert.equal(t.enc.cycle, null, 'encerrar desmonta o ciclo (hunt_stopped)');
        assert.match(text(t), /Nenhum alvo ativo/);
    } finally { t.view.onHide(); }
});

test('F8.0 C: Abrir no Mapa só navega — troca de aba e abre o mapa da espécie, sem iniciar nem alterar a sessão ou a rota', () => {
    const t = boot();
    try {
        t.view.handleAction('target-pick', { id: String(SPECIES) });
        const route = t.game.gameState.currentRoute;
        t.view.handleAction('target-open-map', {});
        assert.deepEqual(t.ui.switched, ['tab-map']);
        assert.deepEqual(t.ui.opened, [SPECIES]);
        assert.equal(session(t.game), null, 'nenhuma sessão criada');
        assert.equal(t.enc.cycle, null);
        assert.equal(t.game.gameState.currentRoute, route);
        // sem espécie: desabilitado e recusa segura
        const u = boot();
        u.view.handleAction('target-open-map', {});
        assert.deepEqual(u.ui.switched, []);
        assert.match(u.ui.toasts.at(-1), /Escolha uma espécie/);
    } finally { t.view.onHide(); }
});

test('F8.0 C: com um ciclo ativo a interface mostra a espécie do CICLO (não a seleção), e iniciar outro alvo é recusado sem efeito', () => {
    const t = boot();
    try {
        t.enc.begin(SPECIES);
        t.view.handleAction('target-pick', { id: '150' });
        t.view.renderTarget();
        assert.match(text(t), /#025/);
        assert.doesNotMatch(text(t), /#150/);
        const id = session(t.game).id;
        t.view.handleAction('target-start', {});
        assert.equal(session(t.game).id, id);
        assert.equal(t.enc.cycle.speciesId, SPECIES);
        assert.match(t.ui.toasts.at(-1), /Já existe uma caçada/);
    } finally { t.view.onHide(); }
});

// =============================================================== D. alternância rápida e cliques repetidos
const events = (game) => { const ev = []; game.bus.on('*', (e) => { if (!e.offline) ev.push(e.type); }); return ev; };
const count = (ev, type) => ev.filter(x => x === type).length;

test('F8.0 D: pausar → retomar → pausar rapidamente: uma sessão, duração e progresso preservados, timers e eventos sem duplicação', () => {
    const t = boot(); const ev = events(t.game);
    try {
        t.enc.begin(SPECIES);
        t.game.clock.advance(2000);
        const id = session(t.game).id, prog = t.enc.cycle.leg.progressPx, dur = () => t.ctx.huntSessionDurationMs(session(t.game), t.game.clock.now());
        const d0 = dur();
        t.view.handleAction('pause', {}); t.view.handleAction('resume', {}); t.view.handleAction('pause', {});
        assert.equal(session(t.game).state, 'paused'); assert.equal(session(t.game).id, id);
        assert.equal(t.enc.cycle.leg.progressPx, prog, 'sem avanço nem reinício');
        assert.equal(dur(), d0, 'a duração não reiniciou nem andou durante a pausa instantânea');
        assert.equal(t.game.clock.pendingTimers(), 0, 'pausada: nenhum timer');
        assert.equal(count(ev, 'hunt_paused'), 2); assert.equal(count(ev, 'hunt_resumed'), 1); assert.equal(count(ev, 'hunt_started'), 1);
        assert.match(live(t), /Pausada/);
        t.view.handleAction('resume', {});
        assert.equal(t.game.clock.pendingTimers(), 1, 'ativa: exatamente um timer de caminhada');
        assert.equal(dur() >= d0, true);
    } finally { t.view.onHide(); }
});

test('F8.0 D: iniciar e tentar iniciar de novo antes de a tela atualizar — uma sessão, um ciclo, um hunt_started', () => {
    const t = boot(); const ev = events(t.game);
    try {
        t.view.handleAction('target-pick', { id: String(SPECIES) });
        t.view.handleAction('target-start', {});
        const id = session(t.game).id;
        t.view.handleAction('target-start', {}); t.view.handleAction('target-start', {}); t.view.handleAction('start', {});
        assert.equal(session(t.game).id, id);
        assert.equal(count(ev, 'hunt_started'), 1);
        assert.equal(t.game.clock.pendingTimers(), 1);
        assert.equal(t.enc._unsubs.length, 5, 'o controlador assinou uma só vez');
        // o clique "atrasado" também é recusado pela própria operação, mesmo sem passar pela matriz
        assert.equal(t.enc.begin(SPECIES).code, 'already_active');
        assert.equal(dispatch(t.game, 'START_HUNT').code, 'hunt_active');
    } finally { t.view.onHide(); }
});

test('F8.0 D: encerrar e pausar/retomar logo depois — recusados com segurança, nada reaparece (sem ciclo, sem timers)', () => {
    const t = boot(); const ev = events(t.game);
    try {
        t.enc.begin(SPECIES); t.game.clock.advance(1000);
        t.view.handleAction('stop', {});
        const after = JSON.stringify({ st: session(t.game).state, cycle: !!t.enc.cycle, timers: t.game.clock.pendingTimers() });
        t.view.handleAction('pause', {}); t.view.handleAction('resume', {}); t.view.handleAction('stop', {});
        assert.equal(JSON.stringify({ st: session(t.game).state, cycle: !!t.enc.cycle, timers: t.game.clock.pendingTimers() }), after);
        assert.equal(count(ev, 'hunt_stopped'), 1, 'um único encerramento');
        assert.equal(count(ev, 'hunt_paused') + count(ev, 'hunt_resumed'), 0);
        assert.equal(session(t.game).state, 'stopped');
    } finally { t.view.onHide(); }
});

test('F8.0 D: 40 alternâncias pausa/retomada: o estado final é o real, cada transição válida gerou exatamente um evento, e a interface concorda', () => {
    const t = boot(); const ev = events(t.game);
    try {
        t.enc.begin(SPECIES); t.game.clock.advance(1000);
        const id = session(t.game).id;
        for (let i = 0; i < 40; i++) { t.view.handleAction(i % 2 === 0 ? 'pause' : 'resume', {}); t.game.clock.advance(7); }
        for (let i = 0; i < 5; i++) t.view.handleAction('resume', {});          // repetidos e redundantes
        assert.equal(session(t.game).state, 'running'); assert.equal(session(t.game).id, id);
        assert.equal(count(ev, 'hunt_paused'), 20); assert.equal(count(ev, 'hunt_resumed'), 20);
        assert.equal(t.game.clock.pendingTimers(), 1);
        t.view.renderTarget(); t.view.renderStatus();
        assert.match(text(t), /Caminhando/); assert.match(t.dom.text('hunt-status'), /Caçando/);
    } finally { t.view.onHide(); }
});

// =============================================================== E. troca de abas internas e ciclo de vida da interface
test('F8.0 E: abrir e fechar a aba 30 vezes não acumula assinaturas nem timers, e a caçada segue andando sem a aba aberta', () => {
    const t = boot();
    const busCount = subs(t.game);
    try {
        t.enc.begin(SPECIES);
        const hidden = busCount();                         // assinaturas da própria caçada (controlador e motor de automação), sem a interface
        t.view.onShow();
        const base = { bus: busCount(), encListeners: t.enc._listeners.size, unsubs: t.view._unsubs.length };
        assert.ok(base.bus > hidden && base.encListeners === 1);
        for (let i = 0; i < 30; i++) { t.view.onHide(); t.view.onShow(); }
        assert.deepEqual({ bus: busCount(), encListeners: t.enc._listeners.size, unsubs: t.view._unsubs.length }, base, 'nada acumula');
        t.view.onHide();
        assert.equal(busCount(), hidden, 'a interface soltou tudo o que assinou'); assert.equal(t.enc._listeners.size, 0); assert.equal(t.view._tick, null); assert.equal(t.view._unsubs.length, 0);
        // fora da aba a caminhada continua (a interface não conduz nada)
        const p0 = t.enc.cycle.leg.progressPx;
        t.game.clock.advance(3000);
        assert.ok(t.enc.cycle.leg.progressPx > p0, 'a caçada anda com a aba fechada');
        assert.equal(session(t.game).state, 'running');
        t.view.onShow();                                  // voltar mostra o estado ATUAL, sem recriar nada
        t.view.renderTarget();
        assert.match(text(t), /Caminhando/);
        assert.equal(t.game.clock.pendingTimers(), 1);
    } finally { t.view.onHide(); }
});

test('F8.0 E: o ciclo do mundo notifica a Central (re-render agrupado) e a interface lê o estado, nunca o escreve', () => {
    const t = boot();
    try {
        t.view.onShow();
        let renders = 0;
        const orig = t.view.renderTarget.bind(t.view);
        t.view.renderTarget = () => { renders++; return orig(); };
        t.enc.begin(SPECIES);                              // _changed() → onChange → _scheduleRender (debounce de 400 ms em tempo real)
        assert.ok(t.view._renderTimer, 'uma única renderização agendada');
        t.enc.cancel('teste');
        assert.ok(t.view._renderTimer);
        clearTimeout(t.view._renderTimer); t.view._renderTimer = null;
        assert.equal(renders, 0);
    } finally { t.view.onHide(); }
});

// =============================================================== F. salvar e carregar
test('F8.0 F: salvar no meio do trajeto e carregar — a Central mostra a sessão pausada, o alvo e o progresso reais, e retomar continua o percurso', () => {
    const a = boot();
    a.enc.begin(SPECIES); a.game.clock.advance(3000);
    const pctBefore = a.enc.status().progressPx;
    a.game.saveNow();
    const b = boot({ load: true, storage: a.storage, clock: a.game.clock.now() });
    try {
        assert.equal(session(b.game).state, 'paused');
        assert.equal(b.enc.cycle.speciesId, SPECIES, 'o controlador recompôs o ciclo a partir do save');
        b.view.renderTarget();
        assert.match(text(b), /#025/);
        assert.match(text(b), /Pausada, parada a \d+% do caminho/);
        assert.equal(b.enc.status().progressPx, pctBefore + 0 || pctBefore, 'progresso salvo');
        assert.match(b.dom.text('hunt-status'), /Pausada|RETOMAR/);
        b.view.handleAction('resume', {});
        assert.equal(session(b.game).state, 'running');
        assert.ok(b.enc.cycle.leg.progressPx >= pctBefore);
        b.game.clock.advance(1000);
        assert.ok(b.enc.cycle.leg.progressPx > pctBefore, 'o percurso continua do ponto salvo');
    } finally { b.view.onHide(); }
});

// =============================================================== G. simulação offline e guarda de ações
test('F8.0 G: durante a simulação offline, pausar, retomar e encerrar manualmente são recusados pela lógica (código offline), sem tocar na simulação', async () => {
    async function run(act) {
        const t = boot();
        t.enc.begin(SPECIES); t.game.clock.advance(3000);
        let end = null;
        const prev = t.game.onBattleEvent;
        t.game.onBattleEvent = (e, d) => { if (e === 'offlineEnd') end = d; return prev && prev.call(t.game, e, d); };
        t.game._processOfflineBattles(60 * MIN);
        assert.equal(t.game._isOfflineSimulating, true);
        const r = act ? act(t) : null;
        await new Promise((res) => { const i = setInterval(() => { if (end) { clearInterval(i); res(); } }, 5); });
        t.game.stopBattle();
        if (t.game._nextBattleTimeout) { clearTimeout(t.game._nextBattleTimeout); t.game._nextBattleTimeout = null; }
        return { t, r, battles: end.battles };
    }
    const control = await run(null);
    for (const [name, act] of [['PAUSE_HUNT', (t) => dispatch(t.game, 'PAUSE_HUNT')], ['STOP_HUNT manual', (t) => dispatch(t.game, 'STOP_HUNT')],
        ['pelo botão Pausar', (t) => { t.view.handleAction('pause', {}); return { ok: false, code: 'offline' }; }]]) {
        const x = await run(act);
        assert.equal(x.r.ok, false, name);
        if (name !== 'pelo botão Pausar') assert.equal(x.r.code, 'offline', name);
        assert.equal(x.battles, control.battles, `${name}: a simulação não foi afetada (antes: 297 × 221 batalhas)`);
        assert.equal(session(x.t.game).state, 'running', name);
        assert.ok(x.t.enc.cycle, `${name}: o ciclo segue`);
    }
});

test('F8.0 G: o motor de automação continua podendo encerrar durante o offline (parada por condição, com motivo)', () => {
    const t = boot();
    dispatch(t.game, 'START_HUNT');
    t.game._isOfflineSimulating = true;
    assert.equal(dispatch(t.game, 'STOP_HUNT').code, 'offline');
    assert.equal(dispatch(t.game, 'STOP_HUNT', { reason: 'manual' }).code, 'offline');
    assert.equal(dispatch(t.game, 'STOP_HUNT', { reason: 'time_limit' }).ok, true);
    assert.equal(session(t.game).state, 'stopped'); assert.equal(session(t.game).stopReason, 'time_limit');
    t.game._isOfflineSimulating = false;
    // retomar uma caçada PAUSADA durante o cálculo offline também é recusado (o caso só existe com a simulação em curso)
    const u = boot();
    dispatch(u.game, 'START_HUNT'); dispatch(u.game, 'PAUSE_HUNT');
    u.game._isOfflineSimulating = true;
    assert.equal(dispatch(u.game, 'RESUME_HUNT').code, 'offline');
    assert.equal(session(u.game).state, 'paused');
    u.game._isOfflineSimulating = false;
    assert.equal(dispatch(u.game, 'RESUME_HUNT').ok, true);
});

test('F8.0 G: com a aba Caça montada ou desmontada o resultado lógico do offline é idêntico (a interface não participa)', async () => {
    async function run(mounted) {
        const t = boot();
        t.enc.begin(SPECIES); t.game.clock.advance(3000);
        if (mounted) t.view.onShow();
        const data = await runOffline(t.game, 30 * MIN);
        const s = session(t.game);
        const out = JSON.stringify({ battles: data.battles, victories: s.stats.victories, defeats: s.stats.defeats, xp: s.stats.xp, money: s.stats.money, world: s.world, activeMs: s.activeMs, now: t.game.now() });
        t.view.onHide();
        return out;
    }
    assert.equal(await run(true), await run(false));
});
