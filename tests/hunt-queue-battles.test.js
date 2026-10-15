'use strict';
// F8.2 · Condição de conclusão por BATALHAS na fila de alvos (além do tempo). A contagem NÃO é um contador novo: é session.stats.battles, que o motor
// incrementa uma vez por battle_completed (vitória ou derrota) da sessão em andamento, e que é salvo com a sessão. O alvo é o da sessão da fila (um
// ciclo do mundo por vez); o motor lê a condição do alvo como único limite e a sessão para com battle_limit; o Fast Driver já para ao parar a sessão.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, runOffline } = require('./helpers/game');
const { makeFakeDom, makeUi } = require('./helpers/fake-dom');
const { loadWorld } = require('./helpers/world-env');

const MIN = 60_000;
const dispatch = (game, type, extra = {}) => game.dispatchAutomationAction({ type, ...extra });
const session = (game) => game.getHuntSession();
const B = (value) => ({ type: 'battles', value });
const T = (value) => ({ type: 'time', value });

function boot(opts = {}) {
    const g = newGame({ seed: opts.seed ?? 9, storage: opts.storage, load: opts.load });
    g.game.clock = new g.ctx.ManualClock(opts.clock ?? 10_000_000);
    if (opts.team) { g.game.catchPokemonWithIvs(4, 15, g.ctx.ivs ? g.ctx.ivs(10) : { hp: 10, atk: 10, def: 10, spAtk: 10, spDef: 10, speed: 10 }); g.game.gameState.team = [4]; g.game.gameState.activePokemonIndex = 0; g.game._invalidateAllCaches(); }
    const enc = new (loadWorld().WorldEncounters)(g.game);
    const hq = new g.ctx.HuntQueue(g.game, enc);
    const ev = [];
    g.game.bus.on('*', (e) => ev.push(e));
    return { ...g, enc, hq, ev };
}
const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
const count = (t, type, kind) => t.ev.filter(e => e.type === type && !e.offline && (kind === undefined || e.kind === kind)).length;
const stopTimers = (g) => {
    if (g.battleTimer) { clearInterval(g.battleTimer); g.battleTimer = null; }
    if (g._nextBattleTimeout) { clearTimeout(g._nextBattleTimeout); g._nextBattleTimeout = null; g._nextBattleScheduledAt = null; }
    if (g.healTimer) { clearInterval(g.healTimer); clearTimeout(g.healTimer); g.healTimer = null; }
};
// Leva a caminhada até a chegada e conclui a batalha do encontro (vitória ou derrota) pelo caminho real do combate.
function playBattle(t, win = true) {
    const g = t.game;
    g.clock.advance((t.enc.current ? t.enc.current.remainingMs : 0) + 1500);
    stopTimers(g);
    assert.ok(g.currentBattle, 'há batalha do encontro');
    const b = g.currentBattle, saved = g.rng;
    if (win) { b.wildCurrentHp = 1; b.playerTimer = b.playerNextAttack; b.enemyTimer = 0; g.rng = () => 0.99; }
    else { b.playerCurrentHp = 1; b.wildCurrentHp = b.wildMaxHp; b.enemyTimer = b.enemyNextAttack; b.playerTimer = 0; g.rng = () => 0.5; }
    g.battleTick(); g.rng = saved;
    stopTimers(g);
    if (!win && g.currentBattle) g.currentBattle.playerCurrentHp = g.currentBattle.playerMaxHp;      // a cura de derrota é de outro assunto: o próximo encontro começa inteiro
}
const progressOf = (t) => { const v = t.hq.view(); return v.activeItem ? t.ctx.huntQueueProgress(v.activeItem, session(t.game), t.game.now()) : null; };
const sessionsStarted = (t) => t.ev.filter(e => e.type === 'hunt_started' && !e.offline).map(e => e.id);

// =============================================================== A. condição: normalização, validação, compatibilidade
test('F8.2 A: condição única por item — tipos, limites e atalho numérico (minutos da F8.1); tudo o mais é recusado', () => {
    const t = boot(); const norm = t.ctx.huntQueueNormalizeCondition;
    for (const [c, expect] of [
        [{ type: 'time', value: 1 }, '{"type":"time","value":1}'], [{ type: 'time', value: 1440 }, '{"type":"time","value":1440}'],
        [{ type: 'battles', value: 1 }, '{"type":"battles","value":1}'], [{ type: 'battles', value: 10000 }, '{"type":"battles","value":10000}'],
        [25, '{"type":"time","value":25}'],
    ]) assert.equal(JSON.stringify(norm(c)), expect, JSON.stringify(c));
    for (const bad of [null, undefined, 'x', {}, { type: 'time' }, { type: 'time', value: 0 }, { type: 'time', value: 1441 }, { type: 'time', value: 1.5 }, { type: 'time', value: '5' },
        { type: 'battles', value: 0 }, { type: 'battles', value: 10001 }, { type: 'battles', value: -3 }, { type: 'battles', value: NaN }, { type: 'xp', value: 5 }, { type: 'bogus', value: 1 }, 0, 1441, [], true]) {
        assert.equal(norm(bad), null, JSON.stringify(bad));
    }
    assert.equal(t.hq.add(25, B(50)).ok, true);
    assert.equal(t.hq.add(16, B(0)).code, 'invalid_battles'); assert.equal(t.hq.add(16, B(10001)).code, 'invalid_battles');
    assert.equal(t.hq.add(16, T(0)).code, 'invalid_minutes'); assert.equal(t.hq.add(16, { type: 'bogus', value: 5 }).code, 'invalid_minutes');
    assert.equal(t.hq.add(16, T(30)).ok, true);
    assert.equal(JSON.stringify(t.hq.view().items), JSON.stringify([{ speciesId: 25, condition: B(50) }, { speciesId: 16, condition: T(30) }]));
    assert.equal(t.ctx.huntQueueConditionLabel(B(50)), '50 batalhas'); assert.equal(t.ctx.huntQueueConditionLabel(B(1)), '1 batalha'); assert.equal(t.ctx.huntQueueConditionLabel(T(30)), '30 min');
});

test('F8.2 A: saves antigos (itens só com minutes) são migrados para condição de tempo com a mesma duração; formato novo vence; inválidos viram interrupção segura', () => {
    const t = boot(); const S = t.ctx.sanitizeHuntQueue;
    const base = (items, extra = {}) => ({ items, index: 0, state: 'idle', sessionId: null, haltReason: null, ...extra });
    const out = S(base([{ speciesId: 25, minutes: 30 }, { speciesId: 16, condition: { type: 'battles', value: 50 } }, { speciesId: 1, minutes: 7, condition: { type: 'battles', value: 9 } }]));
    assert.equal(JSON.stringify(out.items), JSON.stringify([{ speciesId: 25, condition: T(30) }, { speciesId: 16, condition: B(50) }, { speciesId: 1, condition: B(9) }]), 'antigo→tempo; novo vale; se há os dois, só a condição nova (nada de mistura)');
    for (const bad of [{ speciesId: 25 }, { speciesId: 25, minutes: 0 }, { speciesId: 25, condition: { type: 'battles', value: 99999 } }, { speciesId: 25, condition: 'x' }, { speciesId: 25, condition: { type: 'time', value: 5, extra: 1 } }]) {
        const r = S(base([{ speciesId: 16, minutes: 5 }, bad], { index: 1, state: 'halted', haltReason: 'manual' }));
        if (bad.condition && bad.condition.extra) { assert.equal(r.items.length, 2, 'campo extra é ignorado, a condição válida fica'); continue; }
        assert.equal(r.items.length, 1, JSON.stringify(bad)); assert.equal(r.state, 'halted'); assert.equal(r.haltReason, 'invalid_data');
    }
});

test('F8.2 A: carregar um save real com itens no formato antigo — migra, preserva a duração e a fila executa como limite de tempo', async () => {
    const a = boot();
    a.hq.add(25, T(2)); a.hq.add(16, T(3));
    a.game.gameState.automation.queue.items = [{ speciesId: 25, minutes: 2 }, { speciesId: 16, minutes: 3 }];   // como o save da F8.1 guardava
    a.game.saveNow();
    const b = boot({ load: true, storage: a.storage, clock: a.game.clock.now() });
    assert.equal(JSON.stringify(b.hq.view().items), JSON.stringify([{ speciesId: 25, condition: T(2) }, { speciesId: 16, condition: T(3) }]));
    assert.equal(b.hq.start().ok, true);
    b.game.clock.advance(2 * MIN + 5000); stopTimers(b.game);
    const bt = b.game.currentBattle; bt.wildCurrentHp = 1; bt.playerTimer = bt.playerNextAttack; bt.enemyTimer = 0; b.game.battleTick(); stopTimers(b.game);
    await flush();
    assert.equal(b.hq.view().index, 1); assert.equal(b.enc.cycle.speciesId, 16, 'o limite de tempo antigo continua concluindo o alvo');
});

// =============================================================== B. contagem de batalhas
test('F8.2 B: vitórias e derrotas contam exatamente uma vez cada; o contador é session.stats.battles; o alvo só conclui na N-ésima', async () => {
    const t = boot();
    t.hq.add(25, B(3)); t.hq.add(16, B(2));
    t.hq.start();
    const id = session(t.game).id;
    assert.equal(progressOf(t).current, 0);
    playBattle(t, true);
    assert.equal(session(t.game).stats.battles, 1); assert.equal(progressOf(t).current, 1); assert.equal(session(t.game).state, 'running');
    playBattle(t, false);
    assert.equal(session(t.game).stats.battles, 2); assert.equal(session(t.game).stats.defeats, 1); assert.equal(progressOf(t).current, 2);
    assert.equal(session(t.game).state, 'running'); assert.equal(t.hq.view().index, 0, 'ainda não concluiu');
    playBattle(t, true);                                                                      // 3ª: conclui
    assert.equal(session(t.game).state, 'stopped'); assert.equal(session(t.game).stopReason, 'battle_limit');
    assert.equal(session(t.game).stats.battles, 3); assert.equal(session(t.game).stats.victories, 2); assert.equal(session(t.game).stats.defeats, 1);
    assert.equal(t.hq.view().index, 1, 'avançou uma vez');
    await flush();
    assert.notEqual(session(t.game).id, id); assert.equal(session(t.game).stats.battles, 0, 'o excesso/zero: o próximo alvo começa do zero');
    assert.equal(t.enc.cycle.speciesId, 16); assert.equal(count(t, 'hunt_started'), 2); assert.equal(count(t, 'hunt_stopped'), 1);
    assert.equal(count(t, 'hunt_queue', 'completed'), 1);
});

test('F8.2 B: encontros cancelados e batalhas nunca iniciadas não contam; eventos repetidos de parada não avançam a fila', async () => {
    const t = boot();
    t.hq.add(25, B(2)); t.hq.add(16, B(2));
    t.hq.start();
    const first = session(t.game).id;
    t.game.clock.advance(1000);                                                               // caminhando: nada de batalha ainda
    assert.equal(session(t.game).stats.battles, 0);
    dispatch(t.game, 'PAUSE_HUNT'); t.game.clock.advance(60 * MIN); dispatch(t.game, 'RESUME_HUNT');
    assert.equal(session(t.game).stats.battles, 0, 'pausar/retomar não gera contagem');
    playBattle(t, true); playBattle(t, true); await flush();
    assert.equal(t.hq.view().index, 1);
    t.game._emit('hunt_stopped', { id: first, reason: 'battle_limit' });                    // repetido: inofensivo
    t.hq.runPending(); await flush();
    assert.equal(t.hq.view().index, 1); assert.equal(count(t, 'hunt_started'), 2);
});

test('F8.2 B: batalhas de ROTA nunca são atribuídas a um alvo — ao sair do mapa a fila pára na posição e a sessão vira caçada comum (antes, 3 batalhas de rota concluíam "Pikachu: 3 batalhas")', async () => {
    const t = boot();
    t.hq.add(25, B(3)); t.hq.add(16, T(5));
    t.hq.start();
    t.enc.onAreaChanged('starter_town');
    const v = t.hq.view();
    assert.equal(v.state, 'halted'); assert.equal(v.haltReason, 'cycle_lost'); assert.equal(v.index, 0); assert.equal(v.sessionId, null);
    const sid = session(t.game).id;
    for (let k = 0; k < 4; k++) {                                                              // batalhas de rota acontecendo
        stopTimers(t.game);
        if (!t.game.currentBattle) { t.game.startBattle(); stopTimers(t.game); }
        const b = t.game.currentBattle; b.wildCurrentHp = 1; b.playerTimer = b.playerNextAttack; b.enemyTimer = 0;
        const sv = t.game.rng; t.game.rng = () => 0.99; t.game.battleTick(); t.game.rng = sv; stopTimers(t.game);
    }
    await flush();
    assert.equal(t.hq.view().state, 'halted'); assert.equal(t.hq.view().index, 0, 'a fila não avançou');
    assert.equal(session(t.game).id, sid, 'nenhuma sessão nova'); assert.equal(count(t, 'hunt_started'), 1);
    assert.equal(t.enc.cycle, null);
});

// =============================================================== C. limites: a condição do alvo é o único limite
test('F8.2 C: a condição do alvo é o ÚNICO limite — o limite global do outro tipo não se mistura (batalhas ignoram o tempo global e vice-versa)', async () => {
    // alvo por TEMPO com limite global de 2 batalhas: não pode parar na 2ª batalha
    const a = boot();
    assert.equal(a.game.setAutomationPolicy({ stopConditions: { battleLimit: 2 } }).ok, true);
    a.hq.add(25, T(30));
    a.hq.start();
    playBattle(a, true); playBattle(a, true); playBattle(a, true);
    assert.equal(session(a.game).state, 'running', 'o limite global de batalhas não vale para o alvo por tempo');
    assert.equal(a.hq.view().state, 'running');
    // alvo por BATALHAS com limite global de 1 minuto: não pode parar por tempo
    const b = boot();
    assert.equal(b.game.setAutomationPolicy({ stopConditions: { timeLimitMinutes: 1 } }).ok, true);
    b.hq.add(25, B(2));
    b.hq.start();
    b.game.clock.advance(5 * MIN);                                                             // passa o limite global de 1 min
    stopTimers(b.game);
    const bt = b.game.currentBattle; bt.wildCurrentHp = 1; bt.playerTimer = bt.playerNextAttack; bt.enemyTimer = 0; b.game.battleTick(); stopTimers(b.game);
    assert.equal(session(b.game).state, 'running', 'o limite global de tempo não vale para o alvo por batalhas');
    assert.equal(b.hq.view().index, 0);
    playBattle(b, true);
    assert.equal(session(b.game).stopReason, 'battle_limit');
    assert.equal(JSON.stringify(b.game.getAutomationPolicy().stopConditions.timeLimitMinutes), '1', 'a política guardada não foi tocada');
});

test('F8.2 C: só a razão DA condição deste alvo conclui (time_limit só para tempo, battle_limit só para batalhas); qualquer outra interrompe', async () => {
    for (const [cond, wrong, right] of [[T(30), 'battle_limit', 'time_limit'], [B(50), 'time_limit', 'battle_limit']]) {
        const t = boot();
        t.hq.add(25, cond); t.hq.add(16, T(5));
        t.hq.start();
        assert.equal(dispatch(t.game, 'STOP_HUNT', { reason: wrong }).ok, true);
        await flush();
        assert.equal(t.hq.view().state, 'halted', `${cond.type}: razão ${wrong} não conclui`); assert.equal(t.hq.view().index, 0); assert.equal(t.hq.view().haltReason, wrong);
        const u = boot();
        u.hq.add(25, cond); u.hq.add(16, T(5));
        u.hq.start();
        assert.equal(dispatch(u.game, 'STOP_HUNT', { reason: right }).ok, true);
        await flush();
        assert.equal(u.hq.view().index, 1, `${cond.type}: ${right} conclui`); assert.equal(u.enc.cycle.speciesId, 16);
    }
    // parada manual nunca é conclusão, mesmo faltando uma batalha
    const m = boot();
    m.hq.add(25, B(3)); m.hq.add(16, B(3));
    m.hq.start(); playBattle(m, true); playBattle(m, true);
    dispatch(m.game, 'STOP_HUNT'); await flush();
    assert.equal(m.hq.view().state, 'halted'); assert.equal(m.hq.view().haltReason, 'manual'); assert.equal(m.hq.view().index, 0);
    assert.equal(count(m, 'hunt_started'), 1);
    assert.equal(m.hq.start().ok, true); assert.equal(session(m.game).stats.battles, 0, 'continuar recomeça o alvo do zero (sessão nova)');
});

// =============================================================== D. sequência mista, fim da fila, concorrência
test('F8.2 D: sequência mista tempo → batalhas → batalhas — cada alvo conclui pela SUA condição, uma vez, até o estado final estável', async () => {
    const t = boot();
    const route = t.game.gameState.currentRoute;
    t.hq.add(25, T(1)); t.hq.add(16, B(2)); t.hq.add(1, B(1));
    t.hq.start();
    t.game.clock.advance(MIN + 3000); stopTimers(t.game);                                       // alvo 1: tempo
    const b1 = t.game.currentBattle; b1.wildCurrentHp = 1; b1.playerTimer = b1.playerNextAttack; b1.enemyTimer = 0; t.game.battleTick(); stopTimers(t.game);
    await flush();
    assert.equal(t.hq.view().index, 1); assert.equal(t.enc.cycle.speciesId, 16); assert.equal(session(t.game).stopReason, null);
    playBattle(t, true); assert.equal(t.hq.view().index, 1, '1 de 2 batalhas: ainda não'); playBattle(t, false);
    await flush();
    assert.equal(t.hq.view().index, 2); assert.equal(t.enc.cycle.speciesId, 1);
    playBattle(t, true); await flush();
    const v = t.hq.view();
    assert.equal(v.state, 'done'); assert.equal(session(t.game).state, 'stopped'); assert.equal(t.enc.cycle, null);
    assert.equal(sessionsStarted(t).length, 3); assert.equal(count(t, 'hunt_started'), 3);
    assert.equal(t.game.gameState.currentRoute, route);
    const starts = count(t, 'hunt_started');
    t.game.clock.advance(60 * MIN); await flush();
    assert.equal(count(t, 'hunt_started'), starts, 'nada recomeça');
    assert.equal(t.hq.start().code, 'queue_done');
});

test('F8.2 D: cliques repetidos e parada manual durante a mudança de alvo por batalhas — uma sessão, um avanço', async () => {
    const t = boot();
    t.hq.add(25, B(1)); t.hq.add(16, B(1)); t.hq.add(1, B(1));
    for (let i = 0; i < 4; i++) t.hq.start();
    assert.equal(count(t, 'hunt_started'), 1);
    playBattle(t, true);
    assert.equal(t.hq.view().awaiting, true);
    assert.equal(t.hq.start().ok, true); assert.equal(t.hq.start().code, 'queue_running');
    await flush(); t.hq.runPending(); await flush();
    assert.equal(count(t, 'hunt_started'), 2); assert.equal(t.hq.view().index, 1);
    dispatch(t.game, 'STOP_HUNT'); dispatch(t.game, 'STOP_HUNT'); dispatch(t.game, 'PAUSE_HUNT'); await flush();
    assert.equal(t.hq.view().state, 'halted'); assert.equal(t.hq.view().index, 1); assert.equal(count(t, 'hunt_started'), 2);
    assert.equal(count(t, 'hunt_queue', 'completed'), 1);
});

// =============================================================== E. persistência
test('F8.2 E: salvar a meio do caminho (4 de 10 batalhas) e carregar — contador, alvo e fila preservados; a batalha em curso não conta duas vezes', async () => {
    const a = boot();
    a.hq.add(25, B(10)); a.hq.add(16, T(30));
    a.hq.start();
    for (let k = 0; k < 4; k++) playBattle(a, true);
    a.game.clock.advance((a.enc.current.remainingMs) + 1500); stopTimers(a.game);               // 5ª batalha já em curso no momento de salvar
    assert.ok(a.game.currentBattle);
    a.game.saveNow();
    const b = boot({ load: true, storage: a.storage, clock: a.game.clock.now() });
    assert.equal(JSON.stringify(b.hq.view().items), JSON.stringify([{ speciesId: 25, condition: B(10) }, { speciesId: 16, condition: T(30) }]));
    assert.equal(session(b.game).state, 'paused'); assert.equal(session(b.game).stats.battles, 4, 'só as 4 concluídas');
    assert.equal(progressOf(b).current, 4); assert.equal(progressOf(b).value, 10);
    assert.equal(count(b, 'hunt_started'), 0);
    dispatch(b.game, 'RESUME_HUNT');
    let guard = 0;
    while (b.hq.view().index === 0 && guard++ < 12) { b.game.clock.advance(30_000); stopTimers(b.game); if (b.game.currentBattle) { const bt = b.game.currentBattle; bt.wildCurrentHp = 1; bt.playerTimer = bt.playerNextAttack; bt.enemyTimer = 0; const sv = b.game.rng; b.game.rng = () => 0.99; b.game.battleTick(); b.game.rng = sv; stopTimers(b.game); } }
    await flush();
    assert.equal(b.hq.view().index, 1, 'concluiu');
    assert.equal(b.enc.cycle.speciesId, 16);
    assert.ok(guard <= 9, `foram necessárias ${guard} rodadas: 6 batalhas restantes, não mais (a em curso na hora de salvar valeu uma)`);
});

// =============================================================== F. offline
async function controlRun(count_, opts = {}) {                                                   // mede quanto tempo simulado leva N batalhas (para os casos de borda)
    const c = boot(opts);
    c.hq.add(25, B(count_)); c.hq.add(16, T(5));
    c.hq.start(); c.game.clock.advance(3000);
    const gap = 6 * 60 * MIN;
    c.game.clock.advance(gap);
    await runOffline(c.game, gap);
    return c;
}

test('F8.2 F: o limite é atingido DURANTE o Fast Driver — para exatamente em N (de ~dezenas possíveis), conclui a sessão e avança uma vez; o excesso não é simulado nem creditado ao próximo alvo', async () => {
    const t = boot();
    t.hq.add(25, B(10)); t.hq.add(16, T(5));
    t.hq.start();
    t.game.clock.advance(3000);
    const first = session(t.game).id;
    const gap = 6 * 60 * MIN;                                                                  // dá para ~hundreds de batalhas
    t.game.clock.advance(gap);
    const data = await runOffline(t.game, gap);
    assert.equal(data.battles, 10, 'exatamente 10 batalhas simuladas (não mais)');
    const offEv = t.ev.filter(e => e.type === 'battle_completed' && e.offline);
    assert.equal(offEv.length, 10, 'um evento por batalha, sem duplicar');
    assert.equal(t.hq.view().index, 1, 'avançou uma vez');
    assert.notEqual(session(t.game).id, first);
    assert.equal(session(t.game).stats.battles, 0, 'o próximo alvo começa do zero: nenhuma batalha do excesso foi atribuída a ele');
    assert.equal(t.enc.cycle.speciesId, 16);
    assert.equal(count(t, 'hunt_started'), 2);
    assert.equal(t.ev.filter(e => e.type === 'hunt_stopped').length, 1);
});

test('F8.2 F: bordas do intervalo — o limite na ÚLTIMA batalha permitida conclui; faltando tempo para a última, o alvo segue em N-1 e a fila não avança', async () => {
    const control = await controlRun(10);
    // duração simulada de 10 batalhas: lida da primeira sessão (encerrada) — ela ficou no registro de eventos de parada
    const stop = control.ev.find(e => e.type === 'hunt_stopped');
    const need = stop.durationMs;
    assert.ok(need > 10_000, `10 batalhas levam ${need} ms simulados`);
    const run = async (gap) => {
        const t = boot();
        t.hq.add(25, B(10)); t.hq.add(16, T(5));
        t.hq.start();
        t.game.clock.advance(gap);
        const data = await runOffline(t.game, gap);
        return { t, data };
    };
    // exatamente o necessário (com folga mínima de arredondamento): conclui
    const hit = await run(need + 1500);
    assert.equal(hit.data.battles, 10); assert.equal(hit.t.hq.view().index, 1); assert.equal(count(hit.t, 'hunt_started'), 2);
    // 20 s a menos: a 10ª batalha não cabe
    const miss = await run(need - 20_000);
    assert.ok(miss.data.battles < 10 && miss.data.battles >= 7, `battles=${miss.data.battles}`);
    assert.equal(miss.t.hq.view().index, 0); assert.equal(session(miss.t.game).state, 'running');
    assert.equal(progressOf(miss.t).current, session(miss.t.game).stats.battles);
    assert.equal(count(miss.t, 'hunt_started'), 1);
});

test('F8.2 F: derrotas também contam no Fast Driver (equipe fraca) — vitórias + derrotas = N exatamente, sem recompensa duplicada', async () => {
    const t = boot({ team: true });
    assert.equal(t.game.setAutomationPolicy({ heal: { enabled: false } }).ok, true);          // sem cura automática: nenhuma interrupção por falta de poções, só a contagem
    t.hq.add(25, B(25)); t.hq.add(16, T(5));
    t.hq.start();
    t.game.clock.advance(3000);
    const first = session(t.game);
    const gap = 6 * 60 * MIN;
    t.game.clock.advance(gap);
    const data = await runOffline(t.game, gap);
    const stopped = t.ev.find(e => e.type === 'hunt_stopped');
    assert.equal(stopped.reason, 'battle_limit');
    assert.equal(stopped.stats.battles, 25); assert.equal(stopped.stats.victories + stopped.stats.defeats, 25);
    assert.ok(stopped.stats.defeats > 0, 'o cenário tem derrotas');
    assert.equal(data.battles, stopped.stats.victories, 'o simulador conta vitórias; as derrotas entram na sessão');
    const off = t.ev.filter(e => e.type === 'battle_completed' && e.offline);
    assert.equal(off.length, 25);
    assert.equal(off.reduce((a, e) => a + (e.xp || 0), 0), stopped.stats.xp, 'a EXP da sessão = soma dos eventos (nada em dobro)');
    assert.equal(t.hq.view().index, 1);
});

test('F8.2 F: sessão pausada não avança no offline; e recarga + offline conclui o alvo UMA vez e aguarda (tudo volta pausado); uma segunda recarga não repete nada', async () => {
    const p = boot();
    p.hq.add(25, B(5)); p.hq.add(16, T(5));
    p.hq.start(); playBattle(p, true);
    dispatch(p.game, 'PAUSE_HUNT');
    p.game.clock.advance(6 * 60 * MIN);
    p.game._processOfflineBattles(6 * 60 * MIN);
    assert.equal(p.game._isOfflineSimulating, false);
    assert.equal(session(p.game).stats.battles, 1); assert.equal(p.hq.view().index, 0);
    // recarga com 1 batalha já feita: faltam 4
    const a = boot();
    a.hq.add(25, B(5)); a.hq.add(16, B(5)); a.hq.add(1, B(5));
    a.hq.start(); playBattle(a, true);
    a.game.saveNow();
    const gap = 6 * 60 * MIN;
    const b = boot({ load: true, storage: a.storage, clock: a.game.clock.now() + gap });
    b.game.gameState.lastSave = b.game.clock.now() - gap;
    assert.equal(progressOf(b).current, 1);
    const data = await runOffline(b.game, gap);
    assert.equal(data.battles, 4, 'só as 4 que faltavam (1 já contada antes de salvar)');
    const v = b.hq.view();
    assert.equal(v.index, 1); assert.equal(v.awaiting, true); assert.equal(count(b, 'hunt_started'), 0);
    b.game.saveNow();
    const c = boot({ load: true, storage: b.storage, clock: b.game.clock.now() + 500 });
    assert.equal(c.hq.view().index, 1); assert.equal(c.hq.view().awaiting, true); assert.equal(count(c, 'hunt_started'), 0);
});

test('F8.2 F: a fila TERMINA no offline por batalhas — estado final, nenhuma caçada fora da fila, e o resto do intervalo não vira outra caçada', async () => {
    const t = boot();
    t.hq.add(25, B(8));
    t.hq.start(); t.game.clock.advance(3000);
    const gap = 6 * 60 * MIN;
    t.game.clock.advance(gap);
    const data = await runOffline(t.game, gap);
    assert.equal(data.battles, 8);
    assert.equal(t.hq.view().state, 'done'); assert.equal(session(t.game).state, 'stopped'); assert.equal(t.game.isHuntRunning(), false);
    assert.equal(count(t, 'hunt_started'), 1); assert.equal(t.enc.cycle, null); assert.equal(t.game.encounterHook, null);
});

// =============================================================== G. interface
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
const qtext = (t) => t.dom.text('hunt-queue');
const qhtml = (t) => t.dom.html('hunt-queue');

test('F8.2 G: a Central escolhe o tipo por alvo (tempo/batalhas), mostra a condição e o progresso real derivado da sessão', () => {
    const t = bootUi();
    try {
        assert.match(t.dom.html('hunt-target-pick'), /data-hunt-queue-type/); assert.match(t.dom.html('hunt-target-pick'), /Duração do alvo \(minutos\)/);
        t.view.handleChange({ matches: (sel) => sel === '[data-hunt-queue-type]', value: 'battles' });
        assert.equal(t.view._queueType, 'battles'); assert.equal(t.view._queueValue, t.ctx.HUNT_QUEUE_DEFAULT_BATTLES, 'trocar o tipo traz o valor padrão do tipo');
        assert.match(t.dom.html('hunt-target-pick'), /Quantidade de batalhas/); assert.match(t.dom.html('hunt-target-pick'), /value="50"/);
        t.view.handleAction('target-pick', { id: '25' }); t.view._queueValue = 3;
        t.view.handleAction('queue-add', {});
        t.view.handleChange({ matches: (sel) => sel === '[data-hunt-queue-type]', value: 'time' });
        t.view.handleAction('target-pick', { id: '16' }); t.view._queueValue = 15;
        t.view.handleAction('queue-add', {});
        assert.equal(JSON.stringify(t.hq.view().items), JSON.stringify([{ speciesId: 25, condition: B(3) }, { speciesId: 16, condition: T(15) }]));
        assert.match(qtext(t), /3 batalhas/); assert.match(qtext(t), /15 min/);
        t.view.handleAction('queue-start', {});
        assert.match(qtext(t), /alvo 1 de 2.*\(0\/3 batalhas\)/);
        playBattle(t, true); playBattle(t, false);
        t.view.renderQueue();
        assert.match(qtext(t), /\(2\/3 batalhas\)/); assert.match(qtext(t), /· 2\/3/);
        assert.equal(session(t.game).stats.battles, 2, 'a tela lê o mesmo número que o motor');
        t.view._queueValue = 99999; t.view.handleAction('queue-add', {});
        assert.match(t.ui.toasts.at(-1), /Espécie|já está|batalhas|Escolha/i);
    } finally { t.view.onHide(); }
});

test('F8.2 G: trocar de aba e desmontar a Central não altera a contagem; remontar mostra o progresso atual', async () => {
    const t = bootUi();
    t.hq.add(25, B(4)); t.hq.add(16, B(4));
    t.hq.start();
    t.view.onShow(); playBattle(t, true); t.view.onHide();
    playBattle(t, true); playBattle(t, true);                                                  // aba fechada: a fila trabalha sozinha
    assert.equal(progressOf(t).current, 3);
    t.view.onShow(); t.view.renderQueue();
    assert.match(qtext(t), /\(3\/4 batalhas\)/);
    playBattle(t, true); await flush();
    assert.equal(t.hq.view().index, 1);
    t.view.renderQueue();
    assert.match(qhtml(t), /data-queue-status="done"/); assert.match(qtext(t), /alvo 2 de 2.*\(0\/4 batalhas\)/);
    t.view.onHide();
});
