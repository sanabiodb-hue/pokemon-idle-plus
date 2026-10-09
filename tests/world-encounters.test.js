'use strict';
// F7.6/F7.7: ciclo de caça nos mapas de caça (WorldEncounters). GameCore REAL + ManualClock (sem esperas, sem quadros):
// sessão ativa → ponto → caminho → caminhada (progresso lógico) → chegada → batalha oficial → resultado → próximo ponto.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame } = require('./helpers/game');
const { loadWorld, shown } = require('./helpers/world-env');

const TILE = 16, SPEED = 64, SPECIES = 25;
const dispatch = (game, type, extra = {}) => game.dispatchAutomationAction({ type, ...extra });
const watch = (game) => { const ev = []; game.bus.on('*', (e) => ev.push(e)); return ev; };
const count = (ev, type) => ev.filter(e => e.type === type && !e.offline).length;

function setup(opts = {}) {
    const { game, ctx, storage } = newGame({ seed: opts.seed ?? 7, load: opts.load, storage: opts.storage });
    game.clock = new ctx.ManualClock(opts.clock ?? 1_000_000);
    const world = loadWorld();
    const enc = new world.WorldEncounters(game);
    return { game, ctx, world, enc, storage, ev: watch(game) };
}
// Derrota o inimigo atual pelo caminho real (battleTick → onEnemyDefeated). Deixa a próxima batalha agendada.
function kill(game) {
    const b = game.currentBattle;
    b.wildCurrentHp = 1; b.playerTimer = b.playerNextAttack; b.enemyTimer = 0;
    const saved = game.rng; game.rng = () => 0.99; game.battleTick(); game.rng = saved;
}
function lose(game) {
    const b = game.currentBattle;
    b.playerCurrentHp = 1; b.wildCurrentHp = b.wildMaxHp; b.enemyTimer = b.enemyNextAttack; b.playerTimer = 0;
    const saved = game.rng; game.rng = () => 0.5; game.battleTick(); game.rng = saved;
}
// Faz o que o encadeamento do jogo faz depois de uma luta: zera o agendamento/cura que o dono possui e chama startBattle
function chain(game) {
    if (game._nextBattleTimeout) { clearTimeout(game._nextBattleTimeout); game._nextBattleTimeout = null; game._nextBattleScheduledAt = null; }
    if (game.healTimer) { clearTimeout(game.healTimer); game.healTimer = null; }
    return game.startBattle();
}
const etaOf = (lengthPx) => Math.ceil(lengthPx / SPEED * 1000);
// Comprimento esperado de uma perna, calculado de forma independente com a busca do motor
function legLength(world, map, fromIndex, toIndex) {
    const origin = fromIndex === null ? map.spawn : map.encounterPoints[fromIndex];
    const cells = world.worldFindPath(map, origin, map.encounterPoints[toIndex]);
    return (cells.length - 1) * TILE;
}
const session = (game) => game.getHuntSession();

// =============================================================== início explícito e sessão
test('F7.7 explícito: nada começa sozinho; só begin() cria o ciclo, e ele inicia a sessão pela entrada oficial', () => {
    const { game, enc, ev } = setup();
    assert.equal(game.encounterHook, null);
    assert.equal(session(game), null);
    const r = enc.begin(SPECIES);
    assert.equal(r.ok, true);
    assert.equal(session(game).state, 'running', 'START_HUNT oficial');
    assert.equal(count(ev, 'hunt_started'), 1);
    assert.equal(game.encounterHook, enc);
    assert.equal(enc.cycle.speciesId, SPECIES);
    assert.equal(enc.current.state, 'approaching');
    assert.ok(!game.currentBattle, 'nenhuma batalha de rota: a caçada começa caminhando');
    assert.equal(count(ev, 'battle_started'), 0);
    assert.deepEqual({ ...session(game).world }, { speciesId: SPECIES, seq: 0, last: null, to: enc.current.pointIndex, progressPx: 0 }, 'o mínimo para reconstruir o ciclo e a perna');
});

test('F7.7 explícito: uma caçada que já roda é adotada (sem segunda sessão); pausada, sem equipe, Torre, offline e espécie inválida são recusados sem sobras', () => {
    const a = setup();
    assert.equal(dispatch(a.game, 'START_HUNT').ok, true);
    const sid = session(a.game).id;
    assert.equal(a.enc.begin(SPECIES).ok, true);
    assert.equal(session(a.game).id, sid, 'mesma sessão');
    assert.equal(count(a.ev, 'hunt_started'), 1);
    assert.equal(a.enc.begin(4).code, 'already_active');

    const cases = [
        ['hunt_paused', (g) => { dispatch(g, 'START_HUNT'); dispatch(g, 'PAUSE_HUNT'); }],
        ['tower_mode', (g) => { g._towerMode = true; }],
        ['offline', (g) => { g._isOfflineSimulating = true; }],
        ['no_party', (g) => { g.gameState.team = []; }],
    ];
    for (const [code, prep] of cases) {
        const { game, enc } = setup();
        prep(game);
        const before = game.bus._listenerCount;
        const r = enc.begin(SPECIES);
        assert.deepEqual([r.ok, r.code], [false, code], code);
        assert.equal(enc.cycle, null, `${code}: sem ciclo`);
        assert.equal(game.encounterHook, null, `${code}: sem gancho`);
        assert.equal(game.bus._listenerCount, before, `${code}: sem ouvintes sobrando`);
        assert.equal(game.clock.pendingTimers(), 0, `${code}: sem timers`);
    }
    for (const bad of [0, -1, 1.5, NaN, '25', null, undefined, {}, 1074, 99999]) {
        const { game, enc } = setup();
        const r = enc.begin(bad);
        assert.deepEqual([r.ok, r.code], [false, 'invalid_species'], String(bad));
        assert.equal(session(game), null, 'não iniciou sessão');
        assert.equal(game.encounterHook, null);
    }
});

// =============================================================== caminhada, chegada e batalha
test('F7.7 caminhada: a posição lógica progride pelo caminho (sem teleporte), em terreno andável, e o tempo é comprimento ÷ velocidade', () => {
    const { game, enc, world } = setup();
    enc.begin(SPECIES);
    const map = world.worldHuntMap(SPECIES), c = enc.current;
    const expectLen = legLength(world, map, null, c.pointIndex);
    assert.equal(c.lengthPx, expectLen, 'distância = caminho percorrido (não a reta)');
    assert.equal(c.etaMs, etaOf(expectLen));
    assert.ok(c.lengthPx > Math.hypot((c.point.x - map.spawn.x) * TILE, (c.point.y - map.spawn.y) * TILE) - 1, 'o caminho nunca é menor que a reta');
    const foot = (cell) => ({ x: cell.x * TILE + 8, y: cell.y * TILE + 13 });
    const start = enc.hunterState(map);
    assert.deepEqual([start.x, start.y], [foot(map.spawn).x, foot(map.spawn).y], 'começa no ponto inicial do mapa');
    let prev = start, walked = 0;
    for (let t = 100; t < c.etaMs - 100; t += 100) {
        game.clock.advance(100);
        const h = enc.hunterState(map);
        const step = Math.abs(h.x - prev.x) + Math.abs(h.y - prev.y);
        assert.ok(step <= SPEED * 0.1 + 1e-6 && step > 0, `passo de ${step.toFixed(3)} px em 100 ms (nunca um salto)`);
        assert.equal(world.worldCellBlocked(map, Math.floor(h.x / TILE), Math.floor((h.y - 1) / TILE)), false, 'sempre sobre terreno andável');
        assert.equal(h.moving, true);
        walked += step; prev = h;
    }
    assert.ok(walked > 0 && walked <= c.lengthPx, 'percorreu parte do caminho, sem passar do fim');
    assert.ok(Math.abs(enc.cycle.leg.progressPx - SPEED * (game.now() - 1_000_000) / 1000) < 1e-6, 'progresso = velocidade × tempo');
});

test('F7.7 chegada: a batalha só começa quando o progresso lógico chega ao fim do caminho (nem um ms antes), pela entrada oficial', () => {
    const { game, enc, ev } = setup();
    enc.begin(SPECIES);
    const c = enc.current;
    game.clock.advance(c.etaMs - 1);
    assert.equal(count(ev, 'battle_started'), 0);
    assert.equal(enc.current.state, 'approaching');
    assert.ok(!game.currentBattle);
    assert.equal(game.startBattle(), false, 'tentar iniciar antes da chegada é recusado (sem batalha aleatória de rota)');
    assert.equal(game.startBattle(), false);
    assert.ok(!game.currentBattle && !game.gameState.currentEnemy, 'nenhum inimigo foi gerado');
    assert.equal(game.getHuntSession().state, 'running');
    game.clock.advance(1);
    assert.equal(enc.current.state, 'battling');
    assert.equal(count(ev, 'battle_started'), 1);
    assert.equal(game.currentBattle.wild.id, SPECIES, 'a espécie do mapa');
    assert.equal(enc.cycle.leg.progressPx, enc.cycle.leg.lengthPx);
    assert.equal(game.startBattle(), false, 'o mesmo encontro não abre uma segunda batalha');
    game.clock.advance(120_000);
    assert.equal(count(ev, 'battle_started'), 1, 'tempo extra não cria outra batalha');
});

test('F7.7 chegada por frações: dividir o tempo em 1, 7, 16,6, 33, 250 e 1000 ms leva à chegada no mesmo instante lógico', () => {
    let reference = null;
    for (const step of [1, 7, 16.6667, 33, 250, 1000, 4999]) {
        const { game, enc } = setup();
        enc.begin(SPECIES);
        const eta = enc.current.etaMs;
        let t = 0;
        while (enc.current.state === 'approaching' && t < eta + 5000) {
            const d = Math.min(step, eta + 5000 - t);
            game.clock.advance(d); t += d;
            if (enc.cycle) enc.hunterState({ id: enc.cycle.mapId });          // leitura do estado lógico (como a view faz)
        }
        assert.equal(enc.current.state, 'battling', `passo ${step}`);
        assert.ok(t >= eta - 1e-6 && t < eta + step + 1, `chegou em ${t} ms (eta ${eta}, passo ${step})`);
        const first = enc.current.pointIndex;
        reference = reference === null ? first : reference;
        assert.equal(first, reference, 'mesmo ponto escolhido');
    }
});

test('F7.7 chegada com batalha em curso: espera a vez (guarda central), sem segunda batalha, e é servida pelo encadeamento sem perder o pedido', () => {
    const { game, enc, ev } = setup();
    assert.equal(dispatch(game, 'START_HUNT').ok, true);               // uma batalha de rota já em curso (caçada comum)
    const routeBattle = game.currentBattle;
    assert.equal(enc.begin(SPECIES).ok, true);
    game.clock.advance(enc.current.etaMs);
    assert.equal(enc.current.state, 'arrived');
    assert.equal(game.currentBattle, routeBattle, 'a luta em curso não foi trocada');
    assert.equal(game._battleGuard.last, 'in_battle', 'recusa da guarda central');
    assert.equal(count(ev, 'battle_started'), 1);
    kill(game);
    assert.equal(game.startBattle(), false, 'próxima batalha agendada: recusa');
    assert.equal(enc.current.state, 'arrived');
    assert.equal(chain(game), true);
    assert.equal(enc.current.state, 'battling');
    assert.equal(game.currentBattle.wild.id, SPECIES);
    assert.equal(count(ev, 'battle_started'), 2);
});

test('F7.7 ciclo: resultado real → próximo ponto automático, sem repetir o anterior, sem batalha de rota no meio, com percurso a partir do ponto anterior', () => {
    const { game, enc, world, ev } = setup();
    enc.begin(SPECIES);
    const map = world.worldHuntMap(SPECIES), sid = session(game).id;
    let last = null;
    const seen = [];
    for (let n = 0; n < 6; n++) {
        const c = enc.current;
        assert.equal(c.sequence, n, `perna ${n}`);
        assert.equal(c.pointIndex, world.worldPickEncounterPoint(map, sid, n, last), 'ponto segue a função pura determinística');
        if (last !== null) assert.notEqual(c.pointIndex, last, 'não repete o ponto imediatamente');
        assert.equal(c.lengthPx, legLength(world, map, last, c.pointIndex), 'percurso parte do ponto anterior');
        game.clock.advance(c.etaMs);
        if (n > 0) assert.equal(chain(game) || enc.current.state === 'battling', true);
        assert.equal(enc.current.state, 'battling');
        assert.equal(game.currentBattle.wild.id, SPECIES);
        assert.equal(count(ev, 'battle_started'), n + 1, 'uma batalha por chegada');
        if (n % 2 === 0) kill(game); else lose(game);
        seen.push(c.pointIndex);
        last = c.pointIndex;
        assert.equal(enc.lastResult.outcome, n % 2 === 0 ? 'victory' : 'defeat');
        assert.equal(enc.current.state, 'approaching', 'a sessão segue ativa: já começou o próximo deslocamento');
        assert.equal(enc.current.sequence, n + 1);
        assert.deepEqual({ ...session(game).world }, { speciesId: SPECIES, seq: n + 1, last, to: enc.current.pointIndex, progressPx: 0 });
        // enquanto caminha para o próximo: nada de batalha de rota
        const started = count(ev, 'battle_started');
        assert.equal(chain(game), false, 'sem chegada, o encadeamento do jogo não abre luta (sem fallback aleatório)');
        assert.equal(count(ev, 'battle_started'), started);
        if (n % 2 === 1) { game.stopBattle(); game.healTimer = null; }
    }
    assert.ok(new Set(seen).size >= 3, 'usou vários pontos');
});

test('F7.7 resultados: vitória e derrota reais não duplicam contadores nem recompensas; evento repetido é inofensivo', () => {
    for (const result of ['victory', 'defeat']) {
        const { game, enc, ev } = setup();
        enc.begin(SPECIES);
        game.clock.advance(enc.current.etaMs);
        const s0 = { ...session(game).stats }, money0 = count(ev, 'money_earned'), done0 = count(ev, 'battle_completed');
        if (result === 'victory') kill(game); else lose(game);
        assert.equal(count(ev, 'battle_completed'), done0 + 1);
        assert.equal(session(game).stats.battles - s0.battles, 1, 'o contador é do jogo, uma vez');
        assert.equal(session(game).stats[result === 'victory' ? 'victories' : 'defeats'] - s0[result === 'victory' ? 'victories' : 'defeats'], 1);
        assert.ok(count(ev, 'money_earned') - money0 <= 1);
        const seq = enc.current.sequence;
        enc._onBattleCompleted({ type: 'battle_completed', result });         // evento atrasado/repetido
        enc._onBattleCompleted({ type: 'battle_completed', result });
        assert.equal(enc.current.sequence, seq, 'não avançou outra perna');
        assert.equal(session(game).stats.battles - s0.battles, 1);
    }
});

// =============================================================== pausa, retomada, encerramento
test('F7.7 pausa: congela posição e progresso, preserva caminho/destino/sequência; retomar continua o MESMO percurso, sem novo sorteio e sem duplicar a chegada', () => {
    const { game, enc, world, ev } = setup();
    enc.begin(SPECIES);
    const map = world.worldHuntMap(SPECIES), c = enc.current, id = c.id, idx = c.pointIndex;
    game.clock.advance(4000);
    dispatch(game, 'PAUSE_HUNT');
    const frozen = enc.hunterState(map), seq = enc.cycle.seq;
    assert.equal(Math.round(enc.cycle.leg.progressPx), SPEED * 4, 'tempo aplicado até a pausa, uma vez');
    assert.equal(frozen.moving, false);
    assert.equal(game.clock.pendingTimers(), 0, 'nenhum timer durante a pausa');
    game.clock.advance(10 * 60_000);
    const still = enc.hunterState(map);
    assert.deepEqual([still.x, still.y], [frozen.x, frozen.y], 'posição congelada');
    assert.equal(enc.current.state, 'approaching');
    assert.equal(game.startBattle(), false, 'pausada: nenhuma batalha (nem de rota)');
    assert.equal(count(ev, 'battle_started'), 0);
    assert.equal(enc.cycle.seq, seq, 'nada foi sorteado');
    dispatch(game, 'RESUME_HUNT');
    assert.equal(enc.current.id, id); assert.equal(enc.current.pointIndex, idx); assert.equal(enc.cycle.seq, seq);
    const remaining = c.etaMs - 4000;
    game.clock.advance(remaining - 2);
    assert.equal(enc.current.state, 'approaching', 'o tempo pausado não contou');
    game.clock.advance(3);
    assert.equal(enc.current.state, 'battling');
    assert.equal(count(ev, 'battle_started'), 1);
    for (let i = 0; i < 4; i++) { dispatch(game, 'PAUSE_HUNT'); dispatch(game, 'RESUME_HUNT'); }
    assert.equal(count(ev, 'battle_started'), 1, 'pausar/retomar não duplica a batalha');
});

test('F7.7 pausa com a chegada já feita: a pausa não entrega o inimigo; a retomada entrega uma única vez', () => {
    const { game, enc, ev } = setup();
    assert.equal(dispatch(game, 'START_HUNT').ok, true);
    enc.begin(SPECIES);
    game.clock.advance(enc.current.etaMs);
    assert.equal(enc.current.state, 'arrived');
    kill(game);
    dispatch(game, 'PAUSE_HUNT');
    assert.equal(chain(game), false, 'pausada: nem o inimigo do mapa nem batalha de rota');
    assert.equal(enc.current.state, 'arrived');
    assert.equal(enc._supplied, null);
    assert.equal(count(ev, 'battle_started'), 1);
    dispatch(game, 'RESUME_HUNT');                                           // ATTACK da retomada → startBattle → gancho
    chain(game);
    assert.equal(enc.current.state, 'battling');
    assert.equal(count(ev, 'battle_started'), 2);
    dispatch(game, 'PAUSE_HUNT'); dispatch(game, 'RESUME_HUNT');
    assert.equal(count(ev, 'battle_started'), 2);
});

test('F7.7 pausa durante a batalha: a luta termina normalmente, nenhum ponto é sorteado enquanto pausada e a retomada começa a próxima perna uma vez', () => {
    const { game, enc, ev } = setup();
    enc.begin(SPECIES);
    game.clock.advance(enc.current.etaMs);
    dispatch(game, 'PAUSE_HUNT');
    const seq = enc.cycle.seq, battle = game.currentBattle;
    assert.equal(game.currentBattle, battle, 'a batalha em curso não foi abortada');
    kill(game);
    assert.equal(enc.current.state, 'resolved');
    assert.equal(enc.cycle.seq, seq, 'pausada: o próximo ponto NÃO foi escolhido');
    assert.equal(enc.cycle.pendingLeg, true);
    assert.equal(game.clock.pendingTimers(), 0);
    game.clock.advance(60_000);
    assert.equal(enc.current.state, 'resolved');
    dispatch(game, 'RESUME_HUNT');
    assert.equal(enc.current.state, 'approaching');
    assert.equal(enc.cycle.seq, seq + 1);
    dispatch(game, 'PAUSE_HUNT'); dispatch(game, 'RESUME_HUNT');
    assert.equal(enc.cycle.seq, seq + 1, 'uma única perna nova');
    assert.equal(count(ev, 'battle_started'), 1);
});

test('F7.7 encerramento: parar a caçada cancela o percurso e limpa timers, gancho, ouvintes e o registro da sessão; as batalhas normais voltam', () => {
    const { game, enc } = setup();
    const listeners0 = game.bus._listenerCount;
    enc.begin(SPECIES);
    game.clock.advance(3000);
    dispatch(game, 'STOP_HUNT');
    assert.equal(enc.cycle, null);
    assert.equal(enc.current.state, 'cancelled');
    assert.equal(enc.current.reason, 'hunt_stopped');
    assert.equal(game.encounterHook, null);
    assert.equal(game.clock.pendingTimers(), 0);
    assert.equal(game.bus._listenerCount, listeners0, 'ouvintes liberados (o motor da caçada também saiu)');
    assert.equal(session(game).world, undefined, 'registro do mundo removido da sessão parada');
    game.clock.advance(10 * 60_000);
    assert.equal(enc.current.state, 'cancelled');
    assert.equal(game.startBattle(), true, 'fora de uma caçada do mundo, a batalha normal de rota funciona');
    assert.notEqual(game.currentBattle, null);
});

test('F7.7 cancelamento: uma batalha em curso nunca é abortada; o resultado depois do cancelamento não reabre nada', () => {
    const { game, enc, ev } = setup();
    enc.begin(SPECIES);
    game.clock.advance(enc.current.etaMs);
    const battle = game.currentBattle, timer = game.battleTimer;
    dispatch(game, 'STOP_HUNT');
    assert.equal(game.currentBattle, battle);
    assert.equal(game.battleTimer, timer);
    const done = count(ev, 'battle_completed');
    kill(game);
    assert.equal(count(ev, 'battle_completed'), done + 1);
    assert.equal(enc.cycle, null);
    assert.equal(enc.cancel('de novo'), false);
    assert.equal(game.clock.pendingTimers(), 0);
});

test('F7.7 offline e Torre durante a caminhada: encerram o ciclo; o gancho não entrega inimigo nesses modos', () => {
    for (const mode of ['_isOfflineSimulating', '_towerMode']) {
        const { game, enc } = setup();
        enc.begin(SPECIES);
        game[mode] = true;
        game.clock.advance(enc.current.etaMs);
        assert.equal(enc.cycle, null, mode);
        assert.equal(enc.current.reason, mode === '_isOfflineSimulating' ? 'offline' : 'tower_mode');
        assert.equal(game.encounterHook, null);
        assert.equal(game.clock.pendingTimers(), 0);
        game[mode] = false;
    }
});

test('F7.7 página escondida: a caminhada congela; ≤ 2 s o tempo escondido é aplicado uma única vez; sem timers enquanto escondida', () => {
    const { game, enc, world } = setup();
    enc.begin(SPECIES);
    const map = world.worldHuntMap(SPECIES);
    game.clock.advance(3000);
    game._onPageHidden();
    assert.equal(game.clock.pendingTimers(), 0);
    const p0 = enc.cycle.leg.progressPx;
    assert.equal(Math.round(p0), SPEED * 3);
    game.clock.advance(1500);
    assert.equal(enc.cycle.leg.progressPx, p0, 'nada anda escondido');
    game._onPageVisible();
    assert.equal(Math.round(enc.hunterState(map) && enc.cycle.leg.progressPx), Math.round(SPEED * 4.5), 'os 1,5 s escondidos foram aplicados uma vez');
    game._onPageHidden(); game.clock.advance(1000); game._onPageVisible(); game._onPageVisible();
    assert.equal(Math.round(enc.cycle.leg.progressPx), Math.round(SPEED * 5.5), 'visibilidade repetida não reaplica');
    assert.ok(enc.cycle.leg.progressPx < enc.cycle.leg.lengthPx);
});

// =============================================================== persistência (session.world)
test('F7.7 persistência: o save guarda só { speciesId, seq, last [, to, progressPx] }; saves antigos e valores inválidos são aceitos com segurança', () => {
    const { ctx } = newGame();
    const base = (extra) => ({ id: 'h1', state: 'paused', routeId: 'kanto_route1', policy: ctx.defaultAutomationPolicy(), createdAt: 1, startedAt: 1, activeMs: 5, stats: {}, ...extra });
    const ok = ctx.sanitizeHuntSession(base({ world: { speciesId: 25, seq: 3, last: 2 } }));
    assert.equal(JSON.stringify(ok.world), '{"speciesId":25,"seq":3,"last":2}');
    assert.equal(JSON.stringify(ctx.sanitizeHuntSession(base({ world: { speciesId: 25, seq: 0, last: null } })).world), '{"speciesId":25,"seq":0,"last":null}');
    assert.equal(ctx.sanitizeHuntSession(base({})).world, undefined, 'save anterior à F7.7: sem campo, sem problema');
    for (const bad of [null, 5, 'x', [], {}, { speciesId: 0, seq: 0, last: null }, { speciesId: -3, seq: 0, last: null }, { speciesId: 1.5, seq: 0, last: null }, { speciesId: '25', seq: 0, last: null },
        { speciesId: 25, seq: -1, last: null }, { speciesId: 25, seq: 2e9, last: null }, { speciesId: 25, seq: 'a', last: null }, { speciesId: 25, seq: 1, last: -1 }, { speciesId: 25, seq: 1, last: 1.5 }, { speciesId: 25, seq: 1, last: 5000 }, { speciesId: 25, seq: 1 }, { speciesId: 1e9, seq: 1, last: null }]) {
        const s = ctx.sanitizeHuntSession(base({ world: bad }));
        assert.ok(s, 'a sessão continua válida');
        assert.equal(s.world, undefined, JSON.stringify(bad));
    }
});

// =============================================================== view: leitura do estado, câmera e sprite
const viewSetup = async (extra = {}) => {
    const { game, ctx } = newGame({ seed: 11 });
    game.clock = new ctx.ManualClock(2_000_000);
    const r = await shown({ gameObject: game, encounters: true, globals: { getPokemonSpriteUrl: (id) => `sprites/pokemon/${id}.png` }, ...extra });
    return { ...r, game };
};

test('F7.7 view: abrir o mapa não inicia nada; o botão explícito inicia a caçada e o personagem aparece caminhando, com a câmera acompanhando', async () => {
    const { env, view, game, encounters, world } = await viewSetup();
    view.openHuntMap(SPECIES); env.flush();
    assert.equal(session(game), null);
    assert.ok(!game.currentBattle);
    assert.equal(encounters.cycle, null);
    assert.equal(env.encounterBtn.disabled, false);
    env.encounterBtn.fire('click'); env.flush();
    assert.equal(session(game).state, 'running');
    assert.equal(env.encounterBtn.disabled, true, 'um ciclo por vez');
    assert.match(env.encounterStatus.textContent, /Caminhando até Pikachu/);
    const map = view.currentScene().map;
    const heroAt = () => { const hero = env.draws.filter(a => a.length === 9).at(-1); return [hero[5], hero[6]]; };
    const cams = [], poses = [];
    for (let i = 0; i < 6; i++) {
        game.clock.advance(1500);
        view.requestRedraw(true); env.flush();
        cams.push({ ...view.lastCamera });
        poses.push({ x: view._player(map).x, y: view._player(map).y, moving: view._player(map).moving });
    }
    assert.ok(poses.every(p => p.moving), 'andando');
    assert.notDeepEqual([poses[0].x, poses[0].y], [poses[5].x, poses[5].y], 'a posição lógica mudou');
    const m = view.lastMetrics, cam = view.lastCamera, p = view._player(map);
    const feet = world.worldToScreen(cam, m, p.x, p.y - 6);
    assert.ok(Math.abs(feet.x - m.bufferWidth / 2) <= m.zoom || cam.x === 0 || Math.abs(cam.x + m.viewWidth - map.width * TILE) < 1, 'câmera centrada no personagem (ou parada na borda do mapa)');
    assert.ok(cams.some((c, i) => i > 0 && (c.x !== cams[i - 1].x || c.y !== cams[i - 1].y)), 'a câmera acompanhou o movimento');
    // o personagem é desenhado exatamente onde o estado lógico o põe
    const ch = world.WORLD_CHARACTER, at = world.worldToScreen(cam, m, p.x - ch.anchor.x, p.y - ch.anchor.y - (p.moving && Math.floor(p.distance / 6) % 2 === 1 ? 1 : 0));
    assert.deepEqual(heroAt(), [at.x, at.y]);
});

test('F7.7 view: controles manuais nunca desviam o personagem durante a caçada; a lógica segue sem Canvas visível', async () => {
    const { env, view, game, encounters } = await viewSetup();
    view.openHuntMap(SPECIES); env.flush();
    env.encounterBtn.fire('click'); env.flush();
    const map = view.currentScene().map;
    game.clock.advance(3000); view.requestRedraw(true); env.flush();
    const before = encounters.hunterState(map);
    env.key('keydown', 'ArrowLeft'); env.key('keydown', 'KeyW');
    env.key('keyup', 'ArrowLeft'); env.key('keyup', 'KeyW');
    assert.equal(env.controlsEl.hidden, true, 'sem direcional');
    assert.equal(view.controls.direction(), null);
    const eta = encounters.current.etaMs;
    view.onHide();                                                          // sai da aba: sem renderer
    const draws = env.draws.length;
    game.clock.advance(eta);
    assert.equal(encounters.current.state, 'battling', 'chegada e batalha sem Canvas');
    assert.equal(env.draws.length, draws, 'nada foi desenhado');
    assert.equal(env.pending(), 0);
    assert.ok(before.x !== undefined);
    view.onShow(); env.flush();
    assert.match(env.encounterStatus.textContent, /Batalha contra Pikachu/);
});

test('F7.7 view: sair do mapa encerra o ciclo (nada avança invisivelmente nem cria encontro na área anterior); a batalha em curso não é abortada', async () => {
    const { env, view, game, encounters } = await viewSetup();
    view.openHuntMap(SPECIES); env.flush();
    env.encounterBtn.fire('click'); env.flush();
    const listeners = game.bus._listenerCount;
    game.clock.advance(5000);
    view.setArea('starter_town'); env.flush();
    assert.equal(encounters.cycle, null);
    assert.equal(encounters.current.reason, 'left_map');
    assert.equal(game.encounterHook, null);
    assert.equal(game.clock.pendingTimers(), 0);
    assert.ok(game.bus._listenerCount < listeners, 'ouvintes do ciclo liberados');
    game.clock.advance(10 * 60_000);
    assert.ok(!game.currentBattle, 'nenhuma batalha foi criada na área anterior');
    // a caçada (sessão) segue a regra da sessão: continua rodando como caçada comum de rota
    assert.equal(session(game).state, 'running');
    // durante a batalha, sair do mapa não a aborta
    view.openHuntMap(SPECIES); env.flush();
    dispatch(game, 'STOP_HUNT');
    env.encounterBtn.fire('click');
    game.clock.advance(encounters.current.etaMs);
    const battle = game.currentBattle;
    assert.equal(encounters.current.state, 'battling');
    view.setArea('kanto_route1'); env.flush();
    assert.equal(game.currentBattle, battle);
    kill(game);
    assert.equal(encounters.cycle, null);
});

test('F7.7 compatibilidade: cidade, caminhada manual, Depot e navegação continuam funcionando com o ciclo de caça ligado', async () => {
    const { env, view, game } = await viewSetup();
    env.key('keydown', 'ArrowRight'); env.flush(16); for (let i = 0; i < 10; i++) env.flush(25); env.key('keyup', 'ArrowRight'); env.flush(20);
    const city = view.currentScene().map;
    assert.ok(view._player(city).x > 3 * TILE);
    assert.equal(env.encounterBox.hidden, true);
    assert.equal(view.openHuntMap(7).ok, true); env.flush();
    env.key('keydown', 'ArrowRight');
    assert.equal(env.pending(), 0, 'mapa de caça segue sem caminhada manual');
    env.key('keyup', 'ArrowRight');
    assert.equal(view.openRoute('kanto_route1').ok, true);
    assert.equal(view.setArea('starter_town'), true);
    assert.equal(session(game), null);
    assert.equal(game.encounterHook, null);
});

test('F7.7 dados do mapa e cache da F7.4 permanecem intactos depois de ciclos completos', () => {
    const { game, enc, world } = setup();
    enc.begin(SPECIES);
    const map = world.worldHuntMap(SPECIES);
    const snap = JSON.stringify(map), stats = JSON.stringify(world.worldHuntStats());
    for (let n = 0; n < 3; n++) { game.clock.advance(enc.current.etaMs); if (n > 0) chain(game); kill(game); }
    enc.cancel('teste');
    assert.equal(JSON.stringify(world.worldHuntMap(SPECIES)), snap);
    assert.equal(world.worldHuntMap(SPECIES), map);
    assert.equal(JSON.stringify(world.worldHuntStats()), stats, 'nenhum mapa novo foi gerado');
    assert.ok(Object.isFrozen(map) && Object.isFrozen(map.encounterPoints[0]));
    assert.equal('state' in map || 'leg' in map || 'cycle' in map, false);
});

test('F7.7 pontos: sequência reproduzível, sem repetição imediata, e candidatos inválidos/únicos tratados (função pura da F7.6 mantida)', () => {
    const w1 = loadWorld(), w2 = loadWorld();
    const m1 = w1.worldHuntMap(SPECIES), m2 = w2.worldHuntMap(SPECIES);
    const run = (w, map, sid) => { const out = []; let last = null; for (let seq = 0; seq < 40; seq++) { const i = w.worldPickEncounterPoint(map, sid, seq, last); out.push(i); last = i; } return out.join(','); };
    assert.equal(run(w1, m1, 'habc1'), run(w2, m2, 'habc1'));
    assert.notEqual(run(w1, m1, 'habc2'), run(w1, m1, 'habc1'));
    const idxs = run(w1, m1, 'habc1').split(',').map(Number);
    for (let i = 1; i < idxs.length; i++) assert.notEqual(idxs[i], idxs[i - 1]);
    const open = (points) => ({ id: 'x', type: 'hunt', width: 10, height: 10, rows: Array.from({ length: 10 }, (_, y) => (y === 5 ? '..TT......' : '..........')), spawn: { x: 0, y: 0 }, encounterPoints: points });
    assert.equal(w1.worldPickEncounterPoint(open([{ x: 8, y: 8 }]), 's', 1, 0), 0, 'único candidato: reutiliza');
    const mixed = open([{ x: 3, y: 5 }, { x: 99, y: 1 }, { x: -1, y: 2 }, { x: 1.5, y: 1 }, { x: 8, y: 8 }, null, { x: 2, y: 2 }]);
    assert.equal(JSON.stringify(w1.worldEncounterCandidates(mixed)), '[4,6]');
    assert.equal(w1.worldPickEncounterPoint(open([]), 's', 0, null), null);
});
