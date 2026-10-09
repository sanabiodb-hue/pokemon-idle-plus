'use strict';
// F7.7 (correção): persistência do progresso da caminhada. `session.world` guarda { speciesId, seq, last, to, progressPx }: o suficiente
// para reconstruir a perna atual (caminho e posição são recalculados). O tempo offline continua sendo contado uma única vez e uma pausa
// explícita continua impedindo qualquer progresso até a retomada explícita.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, runOffline } = require('./helpers/game');
const { loadWorld } = require('./helpers/world-env');

const TILE = 16, SPEED = 64, SPECIES = 25, MIN = 60_000;
const dispatch = (game, type, extra = {}) => game.dispatchAutomationAction({ type, ...extra });
const watch = (game) => { const ev = []; game.bus.on('*', (e) => ev.push(e)); return ev; };
const session = (game) => game.getHuntSession();
const count = (ev, type) => ev.filter(e => e.type === type && !e.offline).length;

function boot(opts = {}) {
    const g = newGame({ seed: opts.seed ?? 7, load: opts.load, storage: opts.storage });
    g.game.clock = new g.ctx.ManualClock(opts.clock ?? 1_000_000);
    const world = loadWorld();
    const enc = new world.WorldEncounters(g.game);
    return { ...g, world, enc, ev: watch(g.game) };
}
const reload = (first, clock = 9_000_000) => boot({ seed: 9, load: true, storage: first.storage, clock });
function kill(game) {
    const b = game.currentBattle;
    b.wildCurrentHp = 1; b.playerTimer = b.playerNextAttack; b.enemyTimer = 0;
    const saved = game.rng; game.rng = () => 0.99; game.battleTick(); game.rng = saved;
}
const progressOf = (enc) => enc.cycle.leg.progressPx;

test('F7.7 persistência: viagem parcial → salvar → recarregar preserva destino e progresso lógico (nada anda, nada começa)', () => {
    const a = boot();
    a.enc.begin(SPECIES);
    a.game.clock.advance(7000);
    const c = a.enc.current, expectedProgress = SPEED * 7;
    a.game.saveNow();
    const w = session(a.game).world;
    assert.equal(w.to, c.pointIndex);
    assert.ok(Math.abs(w.progressPx - expectedProgress) < 1e-6, `progresso salvo ${w.progressPx} (esperado ${expectedProgress}, projetado até o instante do save)`);
    assert.deepEqual(Object.keys(w).sort(), ['last', 'progressPx', 'seq', 'speciesId', 'to'], 'só o necessário');
    assert.ok(JSON.stringify(w).length < 120, 'sem matrizes nem caminhos');

    const b = reload(a);
    assert.equal(session(b.game).state, 'paused');
    assert.ok(b.enc.cycle && b.enc.cycle.leg, 'perna reconstruída (não só o ciclo)');
    assert.equal(b.enc.current.pointIndex, c.pointIndex, 'mesmo destino');
    assert.equal(b.enc.current.sequence, c.sequence);
    assert.equal(b.enc.current.lengthPx, c.lengthPx, 'mesmo caminho (recalculado do mapa determinístico)');
    assert.ok(Math.abs(progressOf(b.enc) - expectedProgress) < 1e-6, 'mesmo progresso');
    const map = b.world.worldHuntMap(SPECIES);
    const h = b.enc.hunterState(map), at = b.world.worldPathPosition(b.enc.cycle.leg.waypoints, expectedProgress);
    assert.deepEqual([h.x, h.y], [at.x, at.y], 'mesma posição lógica');
    assert.equal(h.moving, false, 'pausada: parada');
    assert.equal(count(b.ev, 'battle_started'), 0);
    assert.ok(!b.game.battleTimer);
    b.game.clock.advance(3 * 60 * MIN);
    assert.equal(progressOf(b.enc), expectedProgress, 'três horas depois, nada andou');
});

test('F7.7 persistência: continuar depois da recarga não reinicia a perna nem duplica o tempo (chega exatamente no tempo que faltava)', () => {
    const a = boot();
    a.enc.begin(SPECIES);
    a.game.clock.advance(5000);
    const eta = a.enc.current.etaMs;
    a.game.saveNow();
    const b = reload(a);
    const legId = b.enc.current.id;
    b.game.clock.advance(20 * MIN);                                           // tempo de relógio com o jogo fechado/pausado não conta
    dispatch(b.game, 'RESUME_HUNT');
    assert.equal(b.enc.current.id, legId, 'mesma perna (não recomeçou)');
    assert.ok(Math.abs(progressOf(b.enc) - SPEED * 5) < 1e-6, 'retomou do progresso salvo, sem acrescentar o tempo parado');
    const remaining = Math.ceil((b.enc.current.lengthPx - SPEED * 5) / SPEED * 1000);
    assert.equal(remaining, eta - 5000);
    b.game.clock.advance(remaining - 1);
    assert.equal(b.enc.current.state, 'approaching');
    assert.equal(count(b.ev, 'battle_started'), 0);
    b.game.clock.advance(1);
    assert.equal(b.enc.current.state, 'battling', 'chegou exatamente quando faltava');
    assert.equal(count(b.ev, 'battle_started'), 1, 'uma batalha');
    assert.equal(b.game.currentBattle.wild.id, SPECIES);
    // persistir de novo na mesma perna não muda nada
    b.game.saveNow(); b.game.saveNow();
    assert.equal(count(b.ev, 'battle_started'), 1);
});

test('F7.7 persistência: salvar nunca avança nem dispara a chegada (projeção só de leitura)', () => {
    const a = boot();
    a.enc.begin(SPECIES);
    const eta = a.enc.current.etaMs;
    a.game.clock.advance(eta - 1);
    const before = { p: progressOf(a.enc), at: a.enc.cycle.leg.lastAt };
    a.game.saveNow(); a.game.saveNow();
    assert.equal(progressOf(a.enc), before.p, 'o save não mexeu no estado');
    assert.equal(a.enc.cycle.leg.lastAt, before.at);
    assert.equal(a.enc.current.state, 'approaching');
    assert.equal(count(a.ev, 'battle_started'), 0, 'salvar não inicia batalha');
    const w = session(a.game).world;
    assert.ok(w.progressPx > a.enc.current.lengthPx - SPEED * 0.01 - 1e-6 && w.progressPx <= a.enc.current.lengthPx, 'progresso projetado, limitado ao comprimento');
});

test('F7.7 offline: o intervalo é contado uma única vez — progresso = salvo + velocidade × tempo, e repetir o mesmo intervalo não reaplica', async () => {
    const a = boot();
    a.enc.begin(SPECIES);
    a.game.clock.advance(4000);
    a.game.saveNow();
    const saved = session(a.game).world.progressPx;
    const eta = a.enc.current.etaMs;
    const b = reload(a);
    assert.equal(session(b.game).pausedByReload, true, 'estava ativa');
    const offlineMs = 6000;                                                    // menos que o tempo que faltava: sem batalha
    assert.ok(offlineMs < eta - 4000);
    await runOffline(b.game, offlineMs);
    assert.equal(count(b.ev.filter(e => e.offline), 'battle_completed'), 0, 'nenhuma batalha');
    assert.ok(Math.abs(progressOf(b.enc) - (saved + SPEED * offlineMs / 1000)) < 1e-6, 'tempo offline aplicado uma vez');
    const after = progressOf(b.enc);
    b.game._processOfflineBattles(offlineMs);                                  // o mesmo intervalo outra vez
    assert.equal(b.game._isOfflineSimulating, false);
    assert.equal(progressOf(b.enc), after, 'não reaplica');
    assert.equal(session(b.game).state, 'paused', 'volta pausada até a retomada explícita');
    // salvar e recarregar de novo: continua exatamente daí, e o mesmo intervalo não é aplicado outra vez
    b.game.saveNow();
    const c = reload(b, 12_000_000);
    assert.equal(session(c.game).pausedByReload, false, 'o offline já foi contado: nada a recuperar');
    c.game._processOfflineBattles(offlineMs);
    assert.equal(c.game._isOfflineSimulating, false);
    assert.ok(Math.abs(progressOf(c.enc) - after) < 1e-6, 'progresso idêntico depois da segunda recarga');
});

test('F7.7 offline longo a partir do progresso salvo: o tempo restante da perna é gasto primeiro e só depois vem a batalha', async () => {
    const prepare = () => { const a = boot({ seed: 3 }); a.enc.begin(SPECIES); a.game.clock.advance(6000); a.game.saveNow(); return a; };
    const first = prepare();
    const remaining = first.enc.current.etaMs - 6000;
    const b = reload(first);
    await runOffline(b.game, remaining - 1);
    assert.equal(b.ev.filter(e => e.offline && e.type === 'battle_completed').length, 0, 'sem tempo para chegar');
    const c = reload(prepare());                                              // partida idêntica (mesma semente), recarregada de novo
    await runOffline(c.game, remaining + 10 * MIN);
    const done = c.ev.filter(e => e.offline && e.type === 'battle_completed');
    assert.ok(done.length >= 1);
    assert.ok(done.every(e => e.enemyId === SPECIES));
    assert.equal(session(c.game).stats.battles, done.length, 'contado uma vez');
});

test('F7.7 pausa: sessão pausada continua pausada e não progride, antes e depois do fechamento; só a retomada explícita anda', () => {
    const a = boot();
    a.enc.begin(SPECIES);
    a.game.clock.advance(4500);
    dispatch(a.game, 'PAUSE_HUNT');
    const paused = progressOf(a.enc);
    a.game.clock.advance(60 * MIN);
    a.game.saveNow();
    assert.equal(session(a.game).world.progressPx, paused, 'o save de uma sessão pausada guarda o progresso congelado');
    const b = reload(a);
    assert.equal(session(b.game).state, 'paused');
    assert.equal(session(b.game).pausedByReload, false);
    assert.equal(b.enc.offlineSuspended(), true);
    const stats = JSON.stringify(session(b.game).stats);
    b.game._processOfflineBattles(10 * 60 * MIN);                              // 10 h fora
    assert.equal(b.game._isOfflineSimulating, false);
    assert.equal(progressOf(b.enc), paused, 'não progrediu');
    assert.equal(JSON.stringify(session(b.game).stats), stats);
    assert.equal(b.game.startBattle(), false, 'nenhuma batalha enquanto pausada');
    assert.equal(count(b.ev, 'battle_started'), 0);
    b.game.clock.advance(5 * MIN);
    assert.equal(progressOf(b.enc), paused);
    dispatch(b.game, 'RESUME_HUNT');
    b.game.clock.advance(1000);
    b.enc.hunterState({ id: b.enc.cycle.mapId });
    assert.ok(Math.abs(progressOf(b.enc) - (paused + SPEED)) < 1e-6, 'a retomada explícita continua de onde parou');
});

test('F7.7 batalha em curso no salvamento: ao recarregar e retomar a luta restaurada pertence à mesma perna (não abre outra)', () => {
    const a = boot();
    a.enc.begin(SPECIES);
    a.game.clock.advance(a.enc.current.etaMs);
    assert.equal(a.enc.current.state, 'battling');
    a.game.saveNow();
    assert.equal(session(a.game).world.progressPx, a.enc.current.lengthPx, 'chegada registrada como progresso completo');
    const b = reload(a);
    assert.equal(b.enc.cycle.leg.state, 'arrived');
    assert.ok(b.game.gameState.currentEnemy && b.game.gameState.currentEnemy.id === SPECIES, 'o inimigo da luta veio no save');
    assert.equal(b.enc._supplied, b.game.gameState.currentEnemy, 'reconhecido como o inimigo desta perna');
    dispatch(b.game, 'RESUME_HUNT');                                          // ATTACK → startBattle (usa o inimigo salvo)
    assert.equal(b.enc.current.state, 'battling');
    assert.equal(count(b.ev, 'battle_started'), 1);
    const seq = b.enc.current.sequence;
    kill(b.game);
    assert.equal(b.enc.lastResult.outcome, 'victory');
    assert.equal(b.enc.current.sequence, seq + 1, 'a perna seguinte começou uma única vez');
    assert.equal(b.enc.current.state, 'approaching');
    assert.equal(count(b.ev, 'battle_started'), 1, 'nenhuma batalha extra para a mesma perna');
});

test('F7.7 saves anteriores: sem o campo `world`, ou só com { speciesId, seq, last }, continuam aceitos e recuperam com segurança', () => {
    // sem `world` algum (save anterior à F7.7): caçada comum por rota, sem ciclo nem gancho
    const a = boot();
    dispatch(a.game, 'START_HUNT');
    a.game.saveNow();
    const old = reload(a);
    assert.equal(session(old.game).world, undefined);
    assert.equal(old.enc.cycle, null);
    assert.equal(old.game.encounterHook, null);
    assert.equal(session(old.game).state, 'paused');
    // só a identidade (formato da primeira versão da F7.7): perna do mesmo destino, do zero
    const b = boot();
    b.enc.begin(SPECIES);
    b.game.clock.advance(8000);
    const to = b.enc.current.pointIndex;
    b.game.encounterHook = null;                                              // sem o controlador não há reescrita: simula um save feito pela versão anterior
    session(b.game).world = { speciesId: SPECIES, seq: 0, last: null };
    b.game.saveNow();
    const c = reload(b);
    const w = session(c.game).world;
    assert.deepEqual([w.speciesId, w.seq, w.last], [SPECIES, 0, null], 'o sanitizador aceitou o formato antigo');
    assert.deepEqual([w.to, w.progressPx], [to, 0], 'e o controlador completou o registro com o destino recalculado e progresso 0');
    assert.equal(c.enc.current.pointIndex, to, 'mesmo destino determinístico');
    assert.equal(progressOf(c.enc), 0, 'sem progresso salvo, recomeça a perna do zero');
    assert.equal(count(c.ev, 'battle_started'), 0);
});

test('F7.7 dados inválidos de progresso: descartados com segurança, sem corromper a sessão nem iniciar batalha', () => {
    const base = boot();
    base.enc.begin(SPECIES);
    base.game.clock.advance(5000);
    const good = { ...session(base.game).world };
    const len = base.enc.current.lengthPx;
    const variants = [
        ['progresso negativo', { ...good, progressPx: -5 }, 0],
        ['progresso NaN', { ...good, progressPx: NaN }, 0],
        ['progresso Infinity', { ...good, progressPx: Infinity }, 0],
        ['progresso texto', { ...good, progressPx: '320' }, 0],
        ['progresso gigante', { ...good, progressPx: 1e12 }, 0],
        ['progresso sem destino', (() => { const w = { ...good }; delete w.to; return w; })(), 0],
        ['destino sem progresso', (() => { const w = { ...good }; delete w.progressPx; return w; })(), 0],
        ['destino diferente do recalculado', { ...good, to: good.to + 7 }, 0],
        ['destino fracionário', { ...good, to: 1.5 }, 0],
        ['sequência de outra perna', { ...good, seq: good.seq + 3 }, 0],
        ['objeto vazio', {}, null],
        ['espécie inválida', { ...good, speciesId: 0 }, null],
        ['espécie inexistente', { ...good, speciesId: 99999 }, null],
    ];
    for (const [name, world, expectProgress] of variants) {
        const a = boot();
        a.enc.begin(SPECIES);
        a.game.clock.advance(5000);
        a.game.encounterHook = null;                                          // sem o controlador não há reescrita: grava o dado inválido como está
        session(a.game).world = world;
        a.game.saveNow();
        let b;
        assert.doesNotThrow(() => { b = reload(a); }, name);
        assert.ok(session(b.game), `${name}: sessão intacta`);
        assert.equal(session(b.game).state, 'paused', name);
        assert.equal(count(b.ev, 'battle_started'), 0, `${name}: nenhuma batalha`);
        assert.ok(!b.game.battleTimer, name);
        if (expectProgress === null) { assert.equal(b.enc.cycle, null, `${name}: sem ciclo, caçada comum`); assert.equal(session(b.game).world === undefined || !b.enc.cycle, true); }
        else {
            assert.ok(b.enc.cycle && b.enc.cycle.leg, `${name}: ciclo reconstruído`);
            assert.equal(progressOf(b.enc), expectProgress, `${name}: progresso descartado`);
        }
    }
    // progresso maior que o caminho (mapa/regra mudou): limitado ao fim, chegada pendente SEM iniciar batalha enquanto pausada
    const c = boot();
    c.enc.begin(SPECIES);
    c.game.clock.advance(5000);
    c.game.encounterHook = null;
    session(c.game).world = { ...good, progressPx: len + 500 };
    c.game.saveNow();
    const d = reload(c);
    assert.equal(progressOf(d.enc), len, 'limitado ao comprimento da perna');
    assert.equal(d.enc.cycle.leg.state, 'arrived');
    assert.equal(count(d.ev, 'battle_started'), 0, 'pausada: nenhuma batalha ao carregar');
    assert.ok(!d.game.battleTimer);
    dispatch(d.game, 'RESUME_HUNT');
    assert.equal(count(d.ev, 'battle_started'), 1, 'a retomada explícita entrega a batalha uma vez');
    assert.equal(d.game.currentBattle.wild.id, SPECIES);
});

test('F7.7 regressões: ciclo sem recarga, offline por rota e caçada comum seguem inalterados; o gancho some quando o ciclo acaba', () => {
    const a = boot();
    a.enc.begin(SPECIES);
    a.game.clock.advance(2000);
    dispatch(a.game, 'STOP_HUNT');
    assert.equal(a.game.encounterHook, null);
    assert.equal(session(a.game).world, undefined, 'sessão parada não guarda o ciclo');
    a.game.saveNow();                                                          // salvar sem ciclo ativo não quebra nada
    const b = reload(a);
    assert.equal(b.enc.cycle, null);
    const r = boot();
    dispatch(r.game, 'START_HUNT');
    r.game.saveNow();
    assert.equal(session(r.game).world, undefined, 'caçada comum não escreve o campo do mundo');
});
