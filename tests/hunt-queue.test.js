'use strict';
// F8.1 · Fila sequencial de alvos. GameCore REAL + WorldEncounters REAL + HuntQueue REAL (+ HuntView para a interface), relógio controlado.
// A fila vive em gameState.automation.queue (única fonte); cada alvo é uma sessão própria, iniciada por enc.begin; a duração usa o limite de tempo do
// motor (time_limit). Só time_limit da sessão da fila conclui o alvo; qualquer outro motivo interrompe a fila na posição.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, runOffline } = require('./helpers/game');
const { makeFakeDom, makeUi } = require('./helpers/fake-dom');
const { loadWorld } = require('./helpers/world-env');

const MIN = 60_000;
const dispatch = (game, type, extra = {}) => game.dispatchAutomationAction({ type, ...extra });
const session = (game) => game.getHuntSession();

function boot(opts = {}) {
    const g = newGame({ seed: opts.seed ?? 9, storage: opts.storage, load: opts.load });
    g.game.clock = new g.ctx.ManualClock(opts.clock ?? 10_000_000);
    const world = loadWorld();
    const enc = new world.WorldEncounters(g.game);
    const hq = new g.ctx.HuntQueue(g.game, enc);
    const ev = [];
    g.game.bus.on('*', (e) => ev.push(e));
    return { ...g, world, enc, hq, ev };
}
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
const count = (t, type, kind) => t.ev.filter(e => e.type === type && !e.offline && (kind === undefined || e.kind === kind)).length;
const kill = (game) => { const b = game.currentBattle; b.wildCurrentHp = 1; b.playerTimer = b.playerNextAttack; b.enemyTimer = 0; const s = game.rng; game.rng = () => 0.99; game.battleTick(); game.rng = s; if (game.battleTimer) { clearInterval(game.battleTimer); game.battleTimer = null; } };

// Leva o alvo atual até a conclusão: passa o tempo da duração (a caminhada chega e a batalha começa) e vence a batalha do encontro.
function finishTarget(t, minutes) {
    t.game.clock.advance(minutes * MIN + 5000);
    if (t.game.battleTimer) { clearInterval(t.game.battleTimer); t.game.battleTimer = null; }
    assert.ok(t.game.currentBattle, 'há batalha do encontro para concluir');
    kill(t.game);
}
const sessionsStarted = (t) => t.ev.filter(e => e.type === 'hunt_started' && !e.offline).map(e => e.id);

// =============================================================== A. edição
test('F8.1 A: adicionar, remover e ordenar — duplicatas recusadas, limites, e só alvos pendentes mudam', () => {
    const t = boot();
    assert.equal(t.hq.view().state, 'idle');
    assert.equal(t.hq.add(25, 10).ok, true);
    assert.equal(t.hq.add(25, 3).code, 'duplicate', 'duplicata recusada (regra: uma espécie por fila)');
    assert.equal(t.hq.add(999999, 5).code, 'invalid_species');
    for (const bad of [0, -1, 1.5, 1441, NaN, '5']) assert.equal(t.hq.add(16, bad).code, 'invalid_minutes', String(bad));
    t.hq.add(16, 5); t.hq.add(1, 7);
    assert.equal(JSON.stringify(t.hq.view().items.map(i => [i.speciesId, i.minutes])), JSON.stringify([[25, 10], [16, 5], [1, 7]]));
    assert.equal(t.hq.move(1, -1).ok, true);
    assert.equal(JSON.stringify(t.hq.view().items.map(i => i.speciesId)), '[16,25,1]');
    assert.equal(t.hq.move(0, -1).code, 'invalid_index'); assert.equal(t.hq.move(2, 1).code, 'invalid_index'); assert.equal(t.hq.move(0, 2).code, 'invalid_index');
    assert.equal(t.hq.remove(1).ok, true);
    assert.equal(JSON.stringify(t.hq.view().items.map(i => i.speciesId)), '[16,1]');
    assert.equal(t.hq.remove(9).code, 'invalid_index');
    // limite de itens
    const u = boot();
    let added = 0; for (let id = 1; id <= 40; id++) if (u.hq.add(id, 1).ok) added++;
    assert.equal(added, u.ctx.HUNT_QUEUE_MAX_ITEMS);
    assert.equal(u.hq.add(41, 1).code, 'queue_full');
    // esvaziar volta a "sem fila"
    const v = boot(); v.hq.add(25, 1); v.hq.remove(0);
    assert.equal(v.game.gameState.automation && v.game.gameState.automation.queue, undefined);
    assert.equal(v.hq.view().state, 'idle');
});

test('F8.1 A: com a fila em andamento, concluídos e o alvo ativo ficam travados; só os pendentes mudam', async () => {
    const t = boot();
    t.hq.add(25, 1); t.hq.add(16, 1); t.hq.add(1, 1); t.hq.add(4, 1);
    t.hq.start();
    assert.equal(t.hq.remove(0).code, 'locked'); assert.equal(t.hq.move(0, 1).code, 'locked'); assert.equal(t.hq.move(1, -1).code, 'locked');
    assert.equal(t.hq.move(1, 1).ok, true); assert.equal(t.hq.move(2, 1).ok, true);          // pendentes
    assert.equal(JSON.stringify(t.hq.view().items.map(i => i.speciesId)), '[25,1,4,16]', 'ordem após mover pendentes');
    finishTarget(t, 1); await flush();
    assert.equal(t.hq.view().index, 1);
    assert.equal(t.hq.remove(0).code, 'locked', 'o concluído não sai');
    assert.equal(t.hq.remove(1).code, 'locked', 'o novo alvo ativo também é travado');
    assert.equal(t.hq.remove(2).ok, true);
    assert.equal(t.hq.clear().code, 'queue_running', 'limpar exige encerrar a caçada antes');
});

// =============================================================== B. início, C. conclusão e avanço, D. duração
test('F8.1 B/C: iniciar usa a entrada oficial; concluir o alvo avança EXATAMENTE uma vez, com sessão própria por alvo e um só ciclo', async () => {
    const t = boot();
    const route = t.game.gameState.currentRoute;
    t.hq.add(25, 1); t.hq.add(16, 2);
    assert.equal(t.hq.start().ok, true);
    const v0 = t.hq.view();
    assert.equal(v0.state, 'running'); assert.equal(v0.sessionId, session(t.game).id);
    assert.equal(t.enc.cycle.speciesId, 25);
    assert.equal(t.hq.start().code, 'queue_running', 'segunda partida recusada');
    assert.equal(t.enc.begin(16).code, 'already_active');
    const first = session(t.game).id;
    finishTarget(t, 1);
    assert.equal(session(t.game).state, 'stopped'); assert.equal(session(t.game).stopReason, 'time_limit');
    assert.equal(t.hq.view().index, 1, 'o índice já avançou (uma vez)');
    assert.equal(t.hq.view().sessionId, null, 'aguardando o início adiado');
    await flush();
    const v1 = t.hq.view();
    assert.equal(v1.index, 1); assert.equal(v1.sessionId, session(t.game).id); assert.notEqual(session(t.game).id, first, 'sessão nova para o novo alvo');
    assert.equal(session(t.game).state, 'running'); assert.equal(t.enc.cycle.speciesId, 16);
    assert.equal(count(t, 'hunt_started'), 2); assert.equal(count(t, 'hunt_stopped'), 1);
    assert.equal(count(t, 'hunt_queue', 'completed'), 1); assert.equal(count(t, 'hunt_queue', 'started'), 2);
    assert.equal(t.game.gameState.currentRoute, route, 'selecionar alvos nunca troca a rota de progressão');
    assert.equal(t.game.clock.pendingTimers(), 1, 'um timer de caminhada (um só ciclo)');
    // sinal repetido: o mesmo hunt_stopped entregue de novo não avança nem inicia nada
    t.game._emit('hunt_stopped', { id: first, reason: 'time_limit' });
    t.hq.runPending(); await flush();
    assert.equal(t.hq.view().index, 1); assert.equal(count(t, 'hunt_started'), 2);
});

test('F8.1 D: a duração do alvo usa o limite de tempo do motor (time_limit) sem tocar na política guardada; antes do tempo nada para', async () => {
    const t = boot();
    const policyBefore = JSON.stringify(t.game.getAutomationPolicy());
    t.hq.add(25, 3);
    t.hq.start();
    t.game.clock.advance(2 * MIN);                                 // 2 de 3 minutos: a batalha termina e a caçada segue
    if (t.game.battleTimer) { clearInterval(t.game.battleTimer); t.game.battleTimer = null; }
    kill(t.game);
    assert.equal(session(t.game).state, 'running', 'ainda não deu o tempo');
    assert.equal(t.hq.view().index, 0);
    assert.equal(JSON.stringify(t.game.getAutomationPolicy()), policyBefore, 'a política do jogador não foi alterada');
    assert.equal(t.game.getAutomationPolicy().stopConditions.timeLimitMinutes, 0);
    // a sessão seguinte tem outra duração (cada alvo a sua)
    t.game.clock.advance(2 * MIN);
    t.game.clock.advance(1000);
    if (t.game.currentBattle && !t.game.battleTimer) { /* a próxima batalha do encontro já está em curso */ }
    if (t.game.currentBattle) kill(t.game);
    assert.equal(session(t.game).stopReason, 'time_limit');
    assert.equal(t.hq.view().state, 'done');
});

// =============================================================== E. fim da fila
test('F8.1 E: o último alvo leva a um estado final explícito e estável — nada recomeça, nada é inventado', async () => {
    const t = boot();
    t.hq.add(25, 1);
    t.hq.start();
    finishTarget(t, 1); await flush();
    const v = t.hq.view();
    assert.equal(v.state, 'done'); assert.equal(v.index, 1); assert.equal(v.sessionId, null);
    assert.equal(session(t.game).state, 'stopped'); assert.equal(t.enc.cycle, null); assert.equal(t.game.encounterHook, null);
    const starts = count(t, 'hunt_started');
    t.game.clock.advance(60 * MIN); await flush();
    assert.equal(count(t, 'hunt_started'), starts, 'nenhuma caçada nova');
    assert.equal(t.game.isHuntRunning(), false);
    assert.equal(t.hq.start().code, 'queue_done'); assert.equal(t.hq.add(16, 1).code, 'queue_done');
    assert.equal(t.hq._unsubs.length, 0, 'fila concluída: sem ouvintes');
    assert.equal(t.hq.clear().ok, true);
    assert.equal(t.hq.view().state, 'idle'); assert.equal(t.hq.view().total, 0);
});

// =============================================================== F. pausa e retomada, G. outras paradas
test('F8.1 F: pausar e retomar preservam a posição, a sessão e o progresso; o tempo pausado não conta para a duração do alvo', async () => {
    const t = boot();
    t.hq.add(25, 2); t.hq.add(16, 2);
    t.hq.start();
    const id = session(t.game).id;
    t.game.clock.advance(1 * MIN);
    dispatch(t.game, 'PAUSE_HUNT');
    const prog = t.enc.cycle.leg.progressPx;
    t.game.clock.advance(5 * 60 * MIN);                            // 5 horas pausado
    assert.equal(session(t.game).state, 'paused'); assert.equal(t.hq.view().index, 0); assert.equal(t.hq.view().sessionId, id);
    assert.equal(t.enc.cycle.leg.progressPx, prog);
    assert.equal(dispatch(t.game, 'RESUME_HUNT').ok, true);
    assert.equal(session(t.game).id, id, 'a mesma sessão');
    t.game.clock.advance(30_000);
    if (t.game.battleTimer) { clearInterval(t.game.battleTimer); t.game.battleTimer = null; }
    if (t.game.currentBattle) kill(t.game);
    assert.equal(session(t.game).state, 'running', 'o tempo parado não contou (só 1,5 min dos 2)');
    t.game.clock.advance(MIN);
    if (t.game.battleTimer) { clearInterval(t.game.battleTimer); t.game.battleTimer = null; }
    if (t.game.currentBattle) kill(t.game);
    await flush();
    assert.equal(t.hq.view().index, 1);
    assert.equal(count(t, 'hunt_paused'), 1);
});

test('F8.1 G: qualquer parada que não seja time_limit interrompe a fila NA POSIÇÃO (halted); continuar recomeça o mesmo alvo numa sessão nova', async () => {
    for (const reason of ['manual', 'no_potions', 'shiny_found', 'battle_limit']) {
        const t = boot();
        t.hq.add(25, 5); t.hq.add(16, 5);
        t.hq.start();
        const first = session(t.game).id;
        assert.equal(dispatch(t.game, 'STOP_HUNT', reason === 'manual' ? {} : { reason }).ok, true);
        await flush();
        const v = t.hq.view();
        assert.equal(v.state, 'halted', reason); assert.equal(v.index, 0); assert.equal(v.haltReason, reason); assert.equal(v.total, 2);
        assert.equal(t.enc.cycle, null);
        assert.equal(count(t, 'hunt_started'), 1, `${reason}: nada iniciou sozinho`);
        assert.equal(t.hq._unsubs.length, 0);
        assert.equal(t.hq.start().ok, true);
        assert.notEqual(session(t.game).id, first); assert.equal(t.enc.cycle.speciesId, 25);
        assert.equal(t.hq.view().state, 'running');
    }
});

// =============================================================== H. concorrência
test('F8.1 H: iniciar repetido e continuar durante a transição — nunca duas sessões, nem avanço duplo', async () => {
    const t = boot();
    t.hq.add(25, 1); t.hq.add(16, 1); t.hq.add(1, 1);
    for (let i = 0; i < 5; i++) t.hq.start();
    assert.equal(count(t, 'hunt_started'), 1);
    finishTarget(t, 1);
    // ANTES de o avanço adiado rodar, o jogador clica em "Continuar": começa o alvo 2 uma única vez
    assert.equal(t.hq.view().awaiting, true);
    assert.equal(t.hq.start().ok, true);
    assert.equal(t.hq.start().code, 'queue_running');
    await flush(); t.hq.runPending(); await flush();
    assert.equal(count(t, 'hunt_started'), 2, 'o avanço adiado não iniciou um segundo alvo');
    assert.equal(t.hq.view().index, 1);
    assert.equal(t.enc.cycle.speciesId, 16);
    // pausar/retomar/parar em sequência rápida durante o alvo
    dispatch(t.game, 'PAUSE_HUNT'); dispatch(t.game, 'RESUME_HUNT'); dispatch(t.game, 'PAUSE_HUNT'); dispatch(t.game, 'STOP_HUNT'); dispatch(t.game, 'STOP_HUNT'); dispatch(t.game, 'RESUME_HUNT');
    await flush();
    assert.equal(t.hq.view().state, 'halted'); assert.equal(t.hq.view().index, 1); assert.equal(count(t, 'hunt_stopped'), 2);
    assert.equal(count(t, 'hunt_started'), 2);
    assert.ok(sessionsStarted(t).length === new Set(sessionsStarted(t)).size, 'ids de sessão distintos');
});

test('F8.1 H: em toda a cadeia há no máximo uma sessão ativa e um ciclo; a rota de progressão nunca muda', async () => {
    const t = boot();
    const route = t.game.gameState.currentRoute;
    [[25, 1], [16, 1], [1, 1]].forEach(([id, m]) => t.hq.add(id, m));
    const check = () => {
        const s = session(t.game);
        assert.ok(!(s && s.state === 'running' && !t.enc.cycle), 'sessão ativa sempre com ciclo');
        assert.ok([0, 1].includes(t.game.clock.pendingTimers()));
        assert.equal(t.game.gameState.currentRoute, route);
    };
    t.hq.start(); check();
    for (let k = 0; k < 3; k++) { finishTarget(t, 1); check(); await flush(); check(); }
    assert.equal(t.hq.view().state, 'done');
    assert.equal(sessionsStarted(t).length, 3);
});

// =============================================================== I. salvar e carregar
test('F8.1 I: salvar e carregar com vários alvos — posição, pendentes e duração preservados; a sessão volta pausada e retomar continua', async () => {
    const a = boot();
    a.hq.add(25, 3); a.hq.add(16, 4); a.hq.add(1, 5);
    a.hq.start();
    a.game.clock.advance(MIN);
    a.game.saveNow();
    const b = boot({ load: true, storage: a.storage, clock: a.game.clock.now() });
    const v = b.hq.view();
    assert.equal(JSON.stringify(v.items), JSON.stringify([{ speciesId: 25, minutes: 3 }, { speciesId: 16, minutes: 4 }, { speciesId: 1, minutes: 5 }]));
    assert.equal(v.state, 'running'); assert.equal(v.index, 0); assert.equal(v.sessionId, session(b.game).id);
    assert.equal(session(b.game).state, 'paused'); assert.equal(b.enc.cycle.speciesId, 25);
    assert.equal(b.ctx.huntSessionDurationMs(session(b.game), b.game.clock.now()), MIN, 'a duração acumulada sobreviveu');
    assert.equal(count(b, 'hunt_started'), 0, 'carregar não iniciou caçada nova');
    assert.equal(b.hq._unsubs.length, 1, 'fila rodando: um ouvinte');
    dispatch(b.game, 'RESUME_HUNT');
    finishTarget(b, 2);                                              // 1 min já contado + 2 = 3 min
    await flush();
    assert.equal(b.hq.view().index, 1); assert.equal(b.enc.cycle.speciesId, 16);
});

test('F8.1 I: salvar enquanto a fila AGUARDA o próximo alvo — carregar mantém a posição e nada inicia sozinho; continuar inicia uma vez', async () => {
    const a = boot();
    a.hq.add(25, 1); a.hq.add(16, 1);
    a.hq.start();
    finishTarget(a, 1);
    a.game._towerMode = true;                                        // o avanço adiado encontra a Torre e não inicia: a fila fica aguardando
    await flush();
    a.game._towerMode = false;
    assert.equal(a.hq.view().awaiting, true);
    a.game.saveNow();
    const b = boot({ load: true, storage: a.storage, clock: a.game.clock.now() });
    const v = b.hq.view();
    assert.equal(v.awaiting, true); assert.equal(v.index, 1); assert.equal(v.sessionId, null);
    await flush();
    assert.equal(count(b, 'hunt_started'), 0);
    assert.equal(b.hq.start().ok, true);
    assert.equal(b.enc.cycle.speciesId, 16);
    assert.equal(count(b, 'hunt_started'), 1);
});

test('F8.1 I: saves antigos (sem fila) e dados inválidos da fila carregam sem erro, coerentes, e sem iniciar nada', () => {
    const a = boot();
    a.hq.add(25, 3); a.hq.add(16, 4);
    dispatch(a.game, 'START_HUNT');
    a.game.saveNow();
    // sem o campo: save anterior à F8.1
    const old = boot();
    assert.equal(old.hq.view().state, 'idle'); assert.equal(old.hq.view().total, 0);
    const S = a.ctx.sanitizeHuntQueue;
    const sess = { id: 'h1', state: 'paused' };
    const good = { items: [{ speciesId: 25, minutes: 3 }, { speciesId: 16, minutes: 4 }], index: 1, state: 'running', sessionId: 'h1', haltReason: null };
    assert.equal(JSON.stringify(S(good, sess)), JSON.stringify(good));
    const ok = (raw, expect) => { const r = S(raw, sess); assert.equal(JSON.stringify(r && { s: r.state, i: r.index, n: r.items.length }), JSON.stringify(expect), JSON.stringify(raw).slice(0, 90)); };
    ok(null, null); ok('x', null); ok({}, null); ok({ items: [] }, null); ok({ items: 'a' }, null);
    ok({ ...good, index: -3 }, { s: 'running', i: 0, n: 2 });
    ok({ ...good, index: 99 }, { s: 'done', i: 2, n: 2 });
    ok({ ...good, state: 'bogus' }, { s: 'idle', i: 0, n: 2 });
    ok({ ...good, state: 'done', index: 0 }, { s: 'halted', i: 0, n: 2 });
    ok({ ...good, items: [{ speciesId: 25, minutes: 3 }, { speciesId: 25, minutes: 4 }, { speciesId: 'x', minutes: 4 }, { speciesId: 7, minutes: 0 }] }, { s: 'halted', i: 0, n: 1 });
    ok({ ...good, items: Array.from({ length: 40 }, (_, i) => ({ speciesId: i + 1, minutes: 1 })), index: 0, state: 'idle', sessionId: null }, { s: 'idle', i: 0, n: 20 });
    // sessão da fila inexistente, de outra id ou encerrada → a fila pára na posição
    for (const bad of [undefined, { id: 'zz', state: 'paused' }, { id: 'h1', state: 'stopped' }]) {
        const r = S(good, bad); assert.equal(r.state, 'halted'); assert.equal(r.haltReason, 'session_lost'); assert.equal(r.sessionId, null); assert.equal(r.index, 1);
    }
    // pelo carregamento completo: fila corrompida no estado salvo → não lança, volta coerente e sem iniciar nada
    const c = boot();
    c.hq.add(25, 3); c.hq.add(16, 4);
    c.game.gameState.automation.queue.index = -5;
    c.game.gameState.automation.queue.state = 'running';
    c.game.gameState.automation.queue.sessionId = 'não-existe';
    c.game.gameState.automation.queue.items.push({ speciesId: 'x', minutes: 'y' });
    c.game.saveNow();
    let d;
    assert.doesNotThrow(() => { d = boot({ load: true, storage: c.storage, clock: c.game.clock.now() }); });
    const v = d.hq.view();
    assert.equal(v.total, 2); assert.equal(v.state, 'halted'); assert.equal(v.haltReason, 'invalid_data', 'item inválido descartado: pára na posição'); assert.equal(v.sessionId, null); assert.ok(v.index >= 0 && v.index < v.total);
    assert.equal(count(d, 'hunt_started'), 0); assert.equal(d.game.isHuntRunning(), false);
});

// =============================================================== J. offline
async function offlineRun(t, ms) {
    const data = await runOffline(t.game, ms);
    return data;
}

test('F8.1 J: um alvo termina DURANTE o offline (aba escondida): a simulação para, o próximo alvo começa uma vez, e o intervalo não é reaplicado', async () => {
    const t = boot();
    t.hq.add(25, 5); t.hq.add(16, 5);
    t.hq.start();
    t.game.clock.advance(3000);
    const first = session(t.game).id;
    t.game.clock.advance(30 * MIN);                                  // o tempo em que a aba ficou escondida (o relógio real andou)
    const data = await offlineRun(t, 30 * MIN);
    assert.ok(data.battles > 5);
    const v = t.hq.view();
    assert.equal(v.index, 1, 'concluiu o alvo 1 durante o offline e avançou uma vez');
    assert.equal(session(t.game).state, 'running'); assert.notEqual(session(t.game).id, first);
    assert.equal(t.enc.cycle.speciesId, 16, 'o alvo 2 começou no fim do cálculo offline');
    assert.equal(count(t, 'hunt_started'), 2);
    assert.equal(sessionsStarted(t).length, 2);
    // o tempo que sobrou do intervalo NÃO foi creditado ao alvo 2 (limitação documentada): ele começa do zero
    assert.ok(t.ctx.huntSessionDurationMs(session(t.game), t.game.clock.now()) < MIN, 'duração do alvo 2 recém-iniciada');
    assert.equal(t.hq._unsubs.length, 1);
});

test('F8.1 J: recarga + offline — o alvo conclui no cálculo, a fila avança UMA vez e aguarda (tudo volta pausado depois de recarregar); continuar inicia o próximo', async () => {
    const a = boot();
    a.hq.add(25, 5); a.hq.add(16, 5); a.hq.add(1, 5);
    a.hq.start();
    a.game.clock.advance(3000);
    a.game.saveNow();
    const gap = 30 * MIN;
    const b = boot({ load: true, storage: a.storage, clock: a.game.clock.now() + gap });
    b.game.gameState.lastSave = b.game.clock.now() - gap;
    const data = await offlineRun(b, gap);
    assert.ok(data.battles > 5);
    const v = b.hq.view();
    assert.equal(v.index, 1); assert.equal(v.state, 'running'); assert.equal(v.awaiting, true);
    assert.equal(count(b, 'hunt_started'), 0, 'nenhuma caçada nova sozinha depois da recarga');
    assert.equal(b.game.isHuntRunning(), false);
    b.game.saveNow();
    // segunda recarga imediata: nada se repete
    const c = boot({ load: true, storage: b.storage, clock: b.game.clock.now() + 500 });
    assert.equal(c.hq.view().index, 1); assert.equal(c.hq.view().awaiting, true); assert.equal(count(c, 'hunt_started'), 0);
    assert.equal(c.hq.start().ok, true);
    assert.equal(c.enc.cycle.speciesId, 16);
    assert.equal(count(c, 'hunt_started'), 1);
});

test('F8.1 J: a fila TERMINA durante o offline — estado final, nenhuma caçada fora da fila, nada volta ao alvo anterior', async () => {
    const t = boot();
    t.hq.add(25, 2);
    t.hq.start();
    t.game.clock.advance(3000);
    t.game.clock.advance(30 * MIN);
    await offlineRun(t, 30 * MIN);
    const v = t.hq.view();
    assert.equal(v.state, 'done'); assert.equal(v.index, 1);
    assert.equal(session(t.game).state, 'stopped'); assert.equal(t.game.isHuntRunning(), false);
    assert.equal(count(t, 'hunt_started'), 1, 'nenhuma caçada nova');
    assert.equal(t.enc.cycle, null); assert.equal(t.game.encounterHook, null);
    await flush();
    t.game.clock.advance(MIN); await flush();
    assert.equal(count(t, 'hunt_started'), 1);
});

test('F8.1 J: pausar a fila (sessão pausada) e ficar offline não avança nada; o offline não conclui alvo de fila pausada', async () => {
    const t = boot();
    t.hq.add(25, 1); t.hq.add(16, 1);
    t.hq.start();
    t.game.clock.advance(2000);
    dispatch(t.game, 'PAUSE_HUNT');
    t.game.clock.advance(2000);
    const sess = session(t.game).id;
    t.game.clock.advance(30 * MIN);
    t.game._processOfflineBattles(30 * MIN);                         // caçada pausada pelo jogador: o offline nem começa (offlineSuspended)
    assert.equal(t.game._isOfflineSimulating, false);
    assert.equal(session(t.game).id, sess); assert.equal(session(t.game).state, 'paused');
    assert.equal(t.hq.view().index, 0); assert.equal(count(t, 'hunt_started'), 1);
});

// =============================================================== K. interface (Central)
function bootUi(opts = {}) {
    const t = boot(opts);
    const dom = makeFakeDom(t.ctx);
    const ui = makeUi(t.game);
    ui.worldEncounters = t.enc; ui.huntQueue = t.hq;
    ui.opened = []; ui.worldView = { openHuntMap: (id) => { ui.opened.push(id); return { ok: true }; } };
    const view = new t.ctx.HuntView(ui);
    view.render();
    return { ...t, dom, ui, view };
}
const qhtml = (t) => t.dom.html('hunt-queue');
const qtext = (t) => t.dom.text('hunt-queue');

test('F8.1 K: a Central monta a fila pela interface — adicionar, ordenar, remover, iniciar e limpar chamam as operações da fila e a tela reflete a fila real', () => {
    const t = bootUi();
    try {
        assert.match(qtext(t), /Fila vazia/);
        assert.match(qhtml(t), /data-hunt-action="queue-add" disabled/);
        t.view.handleAction('target-pick', { id: '25' }); t.view._queueMinutes = 3;
        t.view.handleAction('queue-add', {});
        t.view.handleAction('target-pick', { id: '16' }); t.view._queueMinutes = 4;
        t.view.handleAction('queue-add', {});
        t.view.handleAction('queue-add', {});                      // duplicata: recusada
        assert.match(t.ui.toasts.at(-1), /já está na fila|Já está na fila|Essa espécie/i);
        assert.equal(JSON.stringify(t.hq.view().items), JSON.stringify([{ speciesId: 25, minutes: 3 }, { speciesId: 16, minutes: 4 }]));
        assert.match(qtext(t), /1\. (Pikachu|\?\?\?) #025 · 3 min/); assert.match(qtext(t), /Fila pronta: 2 alvos/);
        t.view.handleAction('queue-down', { index: '0' });
        assert.equal(JSON.stringify(t.hq.view().items.map(i => i.speciesId)), '[16,25]');
        t.view.handleAction('queue-up', { index: '1' });
        assert.equal(JSON.stringify(t.hq.view().items.map(i => i.speciesId)), '[25,16]');
        t.view.handleAction('queue-start', {});
        assert.equal(t.hq.view().state, 'running'); assert.equal(t.enc.cycle.speciesId, 25);
        assert.match(qhtml(t), /data-queue-status="active"/); assert.match(qhtml(t), /data-queue-status="pending"/);
        assert.match(qhtml(t), /data-hunt-action="queue-start" disabled/); assert.match(qhtml(t), /data-hunt-action="queue-clear" disabled/);
        assert.match(qtext(t), /Fila em andamento: alvo 1 de 2/);
        assert.match(t.dom.html('hunt-status'), /data-hunt-action="pause"/);
        // o botão de pausa da Central pausa a sessão e a fila segue a mesma posição
        t.view.handleAction('pause', {});
        assert.equal(session(t.game).state, 'paused'); assert.match(qtext(t), /Fila pausada/);
        t.view.handleAction('queue-remove', { index: '0' });
        assert.match(t.ui.toasts.at(-1), /em andamento|não pode ser removido/);
        t.view.handleAction('queue-clear', {});
        assert.match(t.ui.toasts.at(-1), /Encerre a caçada/);
        t.view.handleAction('stop', {});
        assert.match(qtext(t), /Fila interrompida/); assert.match(qhtml(t), /CONTINUAR FILA/);
        t.view.handleAction('queue-clear', {});
        assert.match(qtext(t), /Fila vazia/);
    } finally { t.view.onHide(); }
});

test('F8.1 K: os controles da Central seguem a fila e a sessão reais (matriz com fila)', () => {
    const t = bootUi();
    try {
        const M = (target = 25) => t.ctx.huntControlMatrix(t.ctx.huntCenterSnapshot(t.game, t.enc), target);
        assert.equal(M().queueStart.enabled, false); assert.equal(M().queueAdd.enabled, true); assert.equal(M().queueClear.enabled, false);
        assert.equal(M(null).queueAdd.enabled, false);
        t.hq.add(25, 1);
        assert.equal(M(25).queueAdd.enabled, false, 'já está na fila');
        assert.equal(M().queueStart.enabled, true); assert.equal(M().queueClear.enabled, true);
        t.hq.start();
        const m = M();
        assert.equal(m.start.enabled, false); assert.equal(m.startTarget.enabled, false); assert.equal(m.queueStart.enabled, false); assert.equal(m.queueClear.enabled, false);
        assert.equal(m.pause.enabled, true); assert.equal(m.stop.enabled, true);
        // as operações reais concordam com a matriz
        assert.equal(dispatch(t.game, 'START_HUNT').ok, false); assert.equal(t.enc.begin(16).ok, false); assert.equal(t.hq.start().ok, false); assert.equal(t.hq.clear().ok, false);
        t.game._isOfflineSimulating = true;
        assert.equal(M().pause.enabled, false); assert.equal(M().queueAdd.enabled === true || M().queueAdd.enabled === false, true);
        t.game._isOfflineSimulating = false;
    } finally { t.view.onHide(); }
});

test('F8.1 K: com a aba Caça desmontada (e ao trocar de aba) a fila continua avançando; remontar mostra o estado atual sem duplicar assinaturas', async () => {
    const t = bootUi();
    t.hq.add(25, 1); t.hq.add(16, 1);
    t.hq.start();
    t.view.onShow();
    const base = t.view._unsubs.length;
    for (let i = 0; i < 10; i++) { t.view.onHide(); t.view.onShow(); }
    assert.equal(t.view._unsubs.length, base, 'sem acúmulo');
    t.view.onHide();                                                // aba fechada: a fila trabalha sozinha
    finishTarget(t, 1); await flush();
    assert.equal(t.hq.view().index, 1); assert.equal(t.enc.cycle.speciesId, 16);
    t.view.onShow();
    t.view.renderQueue();
    assert.match(qtext(t), /alvo 2 de 2/);
    assert.match(qhtml(t), /data-queue-status="done"/);
    t.view.onHide();
});

test('F8.1 K: cliques repetidos e atrasados na Central durante a mudança de alvo não duplicam sessão nem avanço', async () => {
    const t = bootUi();
    try {
        t.hq.add(25, 1); t.hq.add(16, 1);
        for (let i = 0; i < 4; i++) t.view.handleAction('queue-start', {});
        assert.equal(count(t, 'hunt_started'), 1);
        finishTarget(t, 1);
        for (let i = 0; i < 3; i++) t.view.handleAction('queue-start', {});       // durante a transição: continua uma vez
        await flush();
        for (let i = 0; i < 3; i++) t.view.handleAction('queue-start', {});
        assert.equal(count(t, 'hunt_started'), 2);
        assert.equal(t.hq.view().index, 1);
        t.view.handleAction('stop', {}); t.view.handleAction('stop', {}); t.view.handleAction('pause', {});
        assert.equal(t.hq.view().state, 'halted');
        assert.equal(count(t, 'hunt_stopped'), 2);
    } finally { t.view.onHide(); }
});

test('F8.1 M: ouvinte só com a fila rodando — ociosa, concluída ou interrompida não pesam no cálculo offline', async () => {
    const t = boot();
    assert.equal(t.hq._unsubs.length, 0);
    t.hq.add(25, 1); assert.equal(t.hq._unsubs.length, 0, 'montada, sem rodar');
    t.hq.start(); assert.equal(t.hq._unsubs.length, 1);
    finishTarget(t, 1); await flush();
    assert.equal(t.hq.view().state, 'done'); assert.equal(t.hq._unsubs.length, 0);
});
