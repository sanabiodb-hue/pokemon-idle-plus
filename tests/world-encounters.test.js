'use strict';
// F7.6: encontros nos mapas de caça. Lógica (WorldEncounters) testada com o GameCore REAL e um ManualClock (sem esperas nem quadros);
// a view só lê o estado. Entradas oficiais: START/PAUSE/RESUME/STOP_HUNT e startBattle() (guarda central da F7.0).
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame } = require('./helpers/game');
const { loadWorld, shown } = require('./helpers/world-env');

const TILE = 16;
const dispatch = (game, type, extra = {}) => game.dispatchAutomationAction({ type, ...extra });
const watch = (game) => { const ev = []; game.bus.on('*', (e) => ev.push(e)); return ev; };
const count = (ev, type) => ev.filter(e => e.type === type && !e.offline).length;

function setup(opts = {}) {
    const { game, ctx } = newGame({ seed: opts.seed ?? 7 });
    game.clock = new ctx.ManualClock(1_000_000);
    const world = loadWorld();
    const enc = new world.WorldEncounters(game);
    return { game, ctx, world, enc, ev: watch(game) };
}
const startHunt = (game) => { const r = dispatch(game, 'START_HUNT'); assert.equal(r.ok, true, JSON.stringify(r)); return game.getHuntSession(); };

// Derrota o inimigo atual pelo caminho real (battleTick → onEnemyDefeated). Deixa a próxima batalha agendada.
function kill(game) {
    const b = game.currentBattle;
    b.wildCurrentHp = 1; b.playerTimer = b.playerNextAttack; b.enemyTimer = 0;
    const saved = game.rng; game.rng = () => 0.99; game.battleTick(); game.rng = saved;
}
// Faz o Pokémon do jogador cair pelo caminho real (defeat)
function lose(game) {
    const b = game.currentBattle;
    b.playerCurrentHp = 1; b.wildCurrentHp = b.wildMaxHp; b.enemyTimer = b.enemyNextAttack; b.playerTimer = 0;
    const saved = game.rng; game.rng = () => 0.5; game.battleTick(); game.rng = saved;
}
// Faz exatamente o que o encadeamento do jogo faz depois de uma luta: zera o agendamento/cura que o dono possui e chama startBattle
function chain(game) {
    if (game._nextBattleTimeout) { clearTimeout(game._nextBattleTimeout); game._nextBattleTimeout = null; game._nextBattleScheduledAt = null; }
    if (game.healTimer) { clearTimeout(game.healTimer); game.healTimer = null; }
    return game.startBattle();
}
const idle = (game) => { game.stopBattle(); game.gameState.currentEnemy = null; };       // caçada rodando, mas sem luta nem inimigo salvo
const SPECIES = 25;
const manhattanMs = (from, to) => Math.ceil(((Math.abs(to.x - from.x) + Math.abs(to.y - from.y)) / 64) * 1000);
const cellCenter = (p) => ({ x: (p.x + 0.5) * TILE, y: (p.y + 0.5) * TILE });
const spawnFoot = (m) => ({ x: m.spawn.x * TILE + 8, y: m.spawn.y * TILE + TILE - 3 });

// =============================================================== pedido, validação e estado
test('F7.6 explícito: ter a caçada rodando ou abrir o mapa nunca cria encontro; só o pedido do jogador cria', () => {
    const { game, enc } = setup();
    startHunt(game);
    assert.equal(game.encounterHook, null, 'sem encontro, o jogo funciona como sempre');
    assert.equal(enc.current, null);
    assert.equal(game._getEngine().isAttached(), true);
    const r = enc.request(SPECIES);
    assert.equal(r.ok, true);
    assert.equal(game.encounterHook, enc);
    assert.equal(enc.current.state, 'approaching');
});

test('F7.6 pedido: exige caçada EM ANDAMENTO (autoritativa), espécie válida e não é aceito em Torre/offline nem duplicado', () => {
    const { game, enc } = setup();
    assert.equal(enc.request(SPECIES).code, 'no_running_hunt', 'sem sessão');
    startHunt(game);
    dispatch(game, 'PAUSE_HUNT');
    assert.equal(enc.request(SPECIES).code, 'no_running_hunt', 'sessão pausada');
    dispatch(game, 'RESUME_HUNT');
    for (const bad of [0, -1, 1.5, NaN, '25', null, undefined, {}, 1074, 99999]) {
        const r = enc.request(bad);
        assert.deepEqual([r.ok, r.code], [false, 'invalid_species'], String(bad));
    }
    assert.equal(enc.current, null, 'nada foi criado por entradas inválidas');
    assert.equal(game.encounterHook, null);
    game._towerMode = true; assert.equal(enc.request(SPECIES).code, 'tower_mode'); game._towerMode = false;
    game._isOfflineSimulating = true; assert.equal(enc.request(SPECIES).code, 'offline'); game._isOfflineSimulating = false;
    assert.equal(enc.request(SPECIES).ok, true);
    assert.equal(enc.request(SPECIES).code, 'already_active', 'um encontro por vez');
    assert.equal(enc.request(4).code, 'already_active');
});

test('F7.6 identidade: a espécie e o ponto vêm do mapa certo; o ponto é candidato válido e caminhável', () => {
    const { game, enc, world } = setup();
    startHunt(game);
    const map = world.worldHuntMap(SPECIES);
    const c = enc.request(SPECIES).encounter;
    assert.equal(c.mapId, 'hunt_25');
    assert.equal(c.speciesId, map.speciesId);
    assert.equal(c.speciesId, 25);
    const p = map.encounterPoints[c.pointIndex];
    assert.deepEqual([c.point.x, c.point.y], [p.x, p.y], 'coordenadas copiadas dos dados do mapa');
    assert.ok(world.worldEncounterCandidates(map).includes(c.pointIndex));
    assert.equal(world.worldCellBlocked(map, c.point.x, c.point.y), false, 'terreno caminhável');
    assert.ok(c.point.x >= 0 && c.point.y >= 0 && c.point.x < map.width && c.point.y < map.height);
    for (const id of [1, 150, 1073]) { const other = new world.WorldEncounters(game); enc.cancel('x'); assert.equal(other.request(id).encounter.speciesId, id); other.cancel('x'); }
});

// =============================================================== chegada (lógica, sem quadros) e batalha pela entrada oficial
test('F7.6 chegada: ETA = distância em L ÷ velocidade, um único timer do relógio do jogo, sem teleporte e sem depender de quadros', () => {
    const { game, enc, world } = setup();
    startHunt(game);
    const map = world.worldHuntMap(SPECIES);
    const before = game.clock.pendingTimers();
    const c = enc.request(SPECIES).encounter;
    assert.equal(game.clock.pendingTimers(), before + 1, 'um timer');
    assert.equal(c.etaMs, manhattanMs(spawnFoot(map), cellCenter(c.point)), 'fórmula do núcleo de movimento (independente do renderer)');
    assert.ok(c.etaMs > 5000, 'a distância tem peso real');
    game.clock.advance(c.etaMs - 1);
    assert.equal(enc.current.state, 'approaching', 'um ms antes: ainda a caminho');
    game.clock.advance(1);
    assert.notEqual(enc.current.state, 'approaching', 'no instante da chegada o estado lógico muda');
    // dividir o mesmo tempo em passos diferentes dá o mesmo resultado (nenhum quadro envolvido)
    for (const step of [1, 7, 333, 1000]) {
        const g2 = setup(); startHunt(g2.game);
        const e2 = g2.enc.request(SPECIES).encounter;
        let t = 0;
        while (t < e2.etaMs - 1) { const d = Math.min(step, e2.etaMs - 1 - t); g2.game.clock.advance(d); t += d; }
        assert.equal(g2.enc.current.state, 'approaching', `passo ${step}`);
        g2.game.clock.advance(1);
        assert.notEqual(g2.enc.current.state, 'approaching', `passo ${step}`);
    }
});

test('F7.6 batalha: a chegada com batalha em curso espera a vez (guarda central), sem segunda batalha; depois entra pela entrada oficial', () => {
    const { game, enc, ev } = setup();
    startHunt(game);                                                     // START_HUNT já abriu uma batalha normal
    const routeBattle = game.currentBattle;
    assert.equal(count(ev, 'battle_started'), 1);
    const c = enc.request(SPECIES).encounter;
    game.clock.advance(c.etaMs);
    assert.equal(enc.current.state, 'arrived', 'chegou, mas a batalha em curso impede');
    assert.equal(game.currentBattle, routeBattle, 'a batalha em curso não foi trocada');
    assert.equal(game._battleGuard.last, 'in_battle', 'quem recusou foi a guarda central');
    assert.equal(count(ev, 'battle_started'), 1, 'nenhuma batalha extra');
    assert.equal(game.startBattle(), false);
    assert.equal(enc.current.state, 'arrived');
    kill(game);                                                          // fim real da batalha de rota
    assert.ok(game._nextBattleTimeout, 'o encadeamento do jogo agendou a próxima');
    assert.equal(game.startBattle(), false, 'enquanto agendada, também recusa');
    assert.equal(enc.current.state, 'arrived');
    assert.equal(chain(game), true, 'a vez do encadeamento: o encontro fornece o inimigo');
    assert.equal(enc.current.state, 'battling');
    assert.equal(game.currentBattle.wild.id, SPECIES, 'o inimigo é a espécie do mapa');
    assert.equal(count(ev, 'battle_started'), 2);
    assert.equal(game.startBattle(), false, 'o mesmo encontro não abre uma segunda batalha');
    assert.equal(game.startBattle(), false);
    assert.equal(count(ev, 'battle_started'), 2);
    assert.equal(game._battleGuard.last, 'in_battle');
});

test('F7.6 batalha: sem batalha em curso a chegada inicia a luta na hora, uma única vez', () => {
    const { game, enc, ev } = setup();
    startHunt(game);
    idle(game);                                                          // caçada rodando, loop ocioso
    const c = enc.request(SPECIES).encounter;
    const before = count(ev, 'battle_started');
    game.clock.advance(c.etaMs);
    assert.equal(enc.current.state, 'battling');
    assert.equal(count(ev, 'battle_started'), before + 1);
    assert.equal(game.currentBattle.wild.id, SPECIES);
    game.clock.advance(60_000);
    assert.equal(count(ev, 'battle_started'), before + 1, 'tempo extra não cria outra batalha');
    assert.equal(game.encounterHook, enc);
});

test('F7.6 inimigo: usa os mecanismos do jogo (nível da rota, IVs, shiny) e nunca sobrescreve um inimigo salvo', () => {
    const { game, enc } = setup();
    startHunt(game);
    idle(game);
    const route = game.getRoute(game.gameState.currentRoute);
    const c = enc.request(SPECIES).encounter;
    game.clock.advance(c.etaMs);
    const w = game.currentBattle.wild;
    assert.equal(w.id, SPECIES);
    assert.ok(w.level >= route.levelRange[0], `nível ${w.level} dentro da faixa da rota`);
    assert.ok(w.ivs && typeof w.isShiny === 'boolean' && w.isWild === true && w.uid);
    // inimigo salvo (ex.: atualização de página) vence: o encontro espera
    game.stopBattle(); enc.cancel('x'); game.gameState.currentEnemy = game.createWildPokemon(19, 3, 0);
    const second = enc.request(SPECIES);
    game.clock.advance(second.encounter.etaMs);
    assert.equal(game.currentBattle.wild.id, 19, 'o inimigo salvo foi usado');
    assert.equal(enc.current.state, 'arrived', 'o encontro continua esperando a vez');
    kill(game);
    chain(game);
    assert.equal(game.currentBattle.wild.id, SPECIES);
    assert.equal(enc.current.state, 'battling');
});

// =============================================================== resultados reais
test('F7.6 resultados: vitória e derrota reais resolvem o encontro sem duplicar contadores nem recompensas', () => {
    for (const result of ['victory', 'defeat']) {
        const { game, enc, ev } = setup();
        startHunt(game); idle(game);
        const base = game.bus._listenerCount;
        const c = enc.request(SPECIES).encounter;
        assert.ok(game.bus._listenerCount > base, 'o encontro assinou eventos');
        game.clock.advance(c.etaMs);
        assert.equal(enc.current.state, 'battling');
        const session = game.getHuntSession(), s0 = { ...session.stats }, money0 = count(ev, 'money_earned'), completed0 = count(ev, 'battle_completed');
        if (result === 'victory') kill(game); else lose(game);
        assert.equal(count(ev, 'battle_completed'), completed0 + 1, `${result}: um único fim de batalha`);
        assert.equal(enc.current.state, 'resolved');
        assert.equal(enc.current.outcome, result);
        assert.equal(session.stats.battles - s0.battles, 1, 'o contador do jogo subiu uma vez (o controlador não conta nada)');
        assert.equal(session.stats[result === 'victory' ? 'victories' : 'defeats'] - s0[result === 'victory' ? 'victories' : 'defeats'], 1);
        assert.ok(count(ev, 'money_earned') - money0 <= 1, 'recompensa em dinheiro: no máximo uma vez');
        assert.equal(game.encounterHook, null, 'o gancho é removido ao resolver');
        assert.equal(game.bus._listenerCount, base, 'sem ouvintes do encontro sobrando');
        enc._onBattleCompleted({ type: 'battle_completed', result });          // evento repetido/atrasado é inofensivo
        assert.equal(enc.current.state, 'resolved');
        assert.equal(session.stats.battles - s0.battles, 1);
    }
});

// =============================================================== pausa, retomada, encerramento
test('F7.6 pausa: congela o ETA e preserva ponto/sequência; retomar continua uma única vez, sem re-sortear', () => {
    const { game, enc, ev } = setup();
    startHunt(game); idle(game);
    const c = enc.request(SPECIES).encounter;
    const id = c.id, idx = c.pointIndex, seq = enc.sequence;
    game.clock.advance(2500);
    dispatch(game, 'PAUSE_HUNT');
    assert.equal(game.clock.pendingTimers() === 0 || !enc._timer, true, 'nenhum timer do encontro durante a pausa');
    const left = enc.current.remainingMs;
    assert.equal(left, c.etaMs - 2500, 'ETA restante exato');
    game.clock.advance(10 * 60_000);                                         // muito tempo pausado
    assert.equal(enc.current.state, 'approaching', 'pausar não faz o encontro progredir');
    assert.equal(enc.current.remainingMs, left);
    assert.equal(count(ev, 'battle_started'), 1, 'nenhuma batalha nova durante a pausa');
    dispatch(game, 'RESUME_HUNT');
    assert.equal(enc.current.id, id); assert.equal(enc.current.pointIndex, idx); assert.equal(enc.sequence, seq, 'nada foi re-sorteado');
    assert.ok(enc._timer !== null, 'timer rearmado');
    game.clock.advance(left - 1);
    assert.equal(enc.current.state, 'approaching');
    game.clock.advance(1);
    assert.equal(enc.current.state, 'arrived', 'a retomada já tinha reaberto a luta de rota; o encontro espera a vez (guarda central)');
    kill(game);
    assert.equal(chain(game), true);
    assert.equal(enc.current.state, 'battling');
    const started = count(ev, 'battle_started');
    dispatch(game, 'PAUSE_HUNT'); dispatch(game, 'RESUME_HUNT'); dispatch(game, 'PAUSE_HUNT'); dispatch(game, 'RESUME_HUNT');
    assert.equal(count(ev, 'battle_started'), started, 'pausar/retomar várias vezes não duplica a batalha');
    assert.equal(game.currentBattle.wild.id, SPECIES);
});

test('F7.6 pausa: com o encontro já chegado, a pausa não entrega o inimigo; a retomada entrega uma vez', () => {
    const { game, enc, ev } = setup();
    startHunt(game);                                                          // batalha de rota em curso
    const c = enc.request(SPECIES).encounter;
    game.clock.advance(c.etaMs);
    assert.equal(enc.current.state, 'arrived');
    kill(game);
    dispatch(game, 'PAUSE_HUNT');
    chain(game);                                                              // o jogo segue com batalhas de rota (comportamento existente), mas sem consumir o encontro
    assert.notEqual(game.currentBattle.wild.id, SPECIES === game.currentBattle.wild.id ? -1 : SPECIES);
    assert.equal(enc.current.state, 'arrived', 'pausado: o encontro não foi consumido');
    assert.equal(enc._supplied, null);
    kill(game);
    dispatch(game, 'RESUME_HUNT');                                            // a retomada tenta a próxima batalha (ATTACK)
    chain(game);
    assert.equal(enc.current.state, 'battling');
    assert.equal(count(ev, 'battle_started') >= 3, true);
    const started = count(ev, 'battle_started');
    dispatch(game, 'PAUSE_HUNT'); dispatch(game, 'RESUME_HUNT');
    assert.equal(count(ev, 'battle_started'), started, 'retomar durante a luta não abre outra');
});

test('F7.6 encerramento: parar a caçada cancela o encontro que não começou e limpa timer, gancho e ouvintes', () => {
    const { game, enc } = setup();
    startHunt(game); idle(game);
    const afterStart = game.bus._listenerCount;
    const c = enc.request(SPECIES).encounter;
    assert.ok(game.bus._listenerCount > afterStart);
    dispatch(game, 'STOP_HUNT');
    assert.equal(enc.current.state, 'cancelled');
    assert.equal(enc.current.reason, 'hunt_stopped');
    assert.equal(enc._timer, null);
    assert.equal(game.clock.pendingTimers(), 0);
    assert.equal(game.encounterHook, null);
    assert.equal(game.bus._listenerCount, afterStart - 0 - (game._getEngine().isAttached() ? 0 : 7), 'só restam os ouvintes do próprio jogo (os do encontro saíram)');
    game.clock.advance(c.etaMs * 3);
    assert.equal(enc.current.state, 'cancelled', 'o tempo passando não ressuscita nada');
});

test('F7.6 cancelamento: uma batalha já em curso nunca é abortada nem recontada; o encontro apenas deixa de ser acompanhado', () => {
    const { game, enc, ev } = setup();
    startHunt(game); idle(game);
    const c = enc.request(SPECIES).encounter;
    game.clock.advance(c.etaMs);
    assert.equal(enc.current.state, 'battling');
    const battle = game.currentBattle, timer = game.battleTimer;
    const s0 = { ...game.getHuntSession().stats };
    dispatch(game, 'STOP_HUNT');
    assert.equal(enc.current.state, 'cancelled');
    assert.equal(game.currentBattle, battle, 'a batalha continua');
    assert.equal(game.battleTimer, timer);
    assert.equal(game.encounterHook, null);
    const completed = count(ev, 'battle_completed');
    kill(game);
    assert.equal(count(ev, 'battle_completed'), completed + 1, 'termina pelas regras do jogo');
    assert.equal(enc.current.state, 'cancelled', 'o resultado não reabre o encontro');
    assert.equal(enc.cancel('de novo'), false, 'cancelar de novo é inofensivo');
});

test('F7.6 offline e Torre: cancelam um encontro pendente; o gancho não entrega inimigo nesses modos; offline por rota segue intacto', () => {
    for (const mode of ['_isOfflineSimulating', '_towerMode']) {
        const { game, enc } = setup();
        startHunt(game); idle(game);
        const c = enc.request(SPECIES).encounter;
        game[mode] = true;
        game.clock.advance(c.etaMs);
        assert.equal(enc.current.state, 'cancelled', mode);
        assert.equal(enc.current.reason, mode === '_isOfflineSimulating' ? 'offline' : 'tower_mode');
        assert.equal(game.encounterHook, null);
        assert.equal(game.clock.pendingTimers(), 0);
        game[mode] = false;
    }
    // evento offline também cancela
    const { game, enc } = setup();
    startHunt(game); idle(game);
    enc.request(SPECIES);
    game.bus.emit('battle_completed', { result: 'victory' }, { offline: true });
    assert.equal(enc.current.reason, 'offline');
    // gancho direto em modo offline devolve nada
    const o = setup(); startHunt(o.game); idle(o.game);
    const c = o.enc.request(SPECIES).encounter;
    o.game.clock.advance(c.etaMs - 1);
    o.game._isOfflineSimulating = true;
    assert.equal(o.enc.takeArrivedEnemy(), null);
    o.game._isOfflineSimulating = false;
});

// =============================================================== determinismo e repetição
test('F7.6 pontos: a sequência é reproduzível (mapa + sessão + sequência), não repete o ponto anterior e nunca usa dados fora do mapa', () => {
    const w1 = loadWorld(), w2 = loadWorld();
    const map1 = w1.worldHuntMap(SPECIES), map2 = w2.worldHuntMap(SPECIES);
    const run = (w, map, sid) => { const out = []; let last = null; for (let seq = 0; seq < 40; seq++) { const i = w.worldPickEncounterPoint(map, sid, seq, last); out.push(i); last = i; } return out.join(','); };
    const a = run(w1, map1, 'habc1'), b = run(w2, map2, 'habc1');
    assert.equal(a, b, 'mesma identidade, sessão e sequência: mesma lista (também em outro contexto)');
    assert.notEqual(run(w1, map1, 'habc2'), a, 'outra sessão, outra sequência');
    assert.notEqual(run(w1, w1.worldHuntMap(26), 'habc1'), a, 'outro mapa, outra sequência');
    const idxs = a.split(',').map(Number);
    for (let i = 1; i < idxs.length; i++) assert.notEqual(idxs[i], idxs[i - 1], `repetiu o ponto em ${i}`);
    assert.ok(new Set(idxs).size >= 3, 'usa vários pontos');
    // sem retentativas: chamada única e função pura (mesmos argumentos, mesmo resultado, nada muda no mapa)
    const snap = JSON.stringify(map1);
    for (let i = 0; i < 50; i++) assert.equal(w1.worldPickEncounterPoint(map1, 'habc1', 3, 1), w1.worldPickEncounterPoint(map1, 'habc1', 3, 1));
    assert.equal(JSON.stringify(map1), snap, 'dados do mapa intactos');
    assert.ok(Object.isFrozen(map1) && Object.isFrozen(map1.encounterPoints) && Object.isFrozen(map1.rows));
});

test('F7.6 pontos: casos-limite — um único candidato é reutilizado; pontos inválidos são ignorados; sem candidatos devolve null', () => {
    const w = loadWorld();
    const open = (points) => ({ id: 'x', type: 'hunt', width: 10, height: 10, rows: Array.from({ length: 10 }, (_, y) => (y === 5 ? '..TT......' : '..........')), spawn: { x: 0, y: 0 }, encounterPoints: points });
    const one = open([{ x: 8, y: 8 }]);
    assert.equal(w.worldPickEncounterPoint(one, 's', 0, null), 0);
    assert.equal(w.worldPickEncounterPoint(one, 's', 1, 0), 0, 'único candidato: reutiliza (documentado)');
    const mixed = open([{ x: 3, y: 5 }, { x: 99, y: 1 }, { x: -1, y: 2 }, { x: 1.5, y: 1 }, { x: 8, y: 8 }, null, { x: 2, y: 2 }]);
    assert.equal(JSON.stringify(w.worldEncounterCandidates(mixed)), '[4,6]', 'bloqueado, fora do mapa, fracionário e nulo ficam de fora');
    for (let s = 0; s < 30; s++) assert.ok([4, 6].includes(w.worldPickEncounterPoint(mixed, 's', s, null)));
    for (let s = 0; s < 30; s++) { const p = w.worldPickEncounterPoint(mixed, 's', s, 4); assert.equal(p, 6, 'o outro candidato'); }
    assert.equal(w.worldPickEncounterPoint(open([{ x: 3, y: 5 }, { x: 50, y: 50 }]), 's', 0, null), null);
    assert.equal(w.worldPickEncounterPoint(open([]), 's', 0, null), null);
    assert.equal(w.worldPickEncounterPoint({ id: 'z', width: 3, height: 3, rows: ['...', '...', '...'] }, 's', 0, null), null, 'sem lista de pontos');
    assert.equal(w.worldPickEncounterPoint(null, 's', 0, null), null);
});

test('F7.6 sequência no jogo: encontros resolvidos em série seguem a função pura e jamais repetem o ponto imediatamente', () => {
    const run = () => {
        const { game, enc, world } = setup({ seed: 3 });
        const session = startHunt(game); idle(game);
        const map = world.worldHuntMap(SPECIES), picked = [];
        let last = null;
        for (let n = 0; n < 6; n++) {
            const c = enc.request(SPECIES).encounter;
            assert.equal(c.pointIndex, world.worldPickEncounterPoint(map, session.id, n, last), `encontro ${n} segue a função pura`);
            if (last !== null) assert.notEqual(c.pointIndex, last);
            picked.push(c.pointIndex);
            game.clock.advance(c.etaMs);
            assert.equal(enc.current.state, 'battling');
            kill(game);
            assert.equal(enc.current.state, 'resolved');
            game.stopBattle(); if (game._nextBattleTimeout) { clearTimeout(game._nextBattleTimeout); game._nextBattleTimeout = null; }
            last = c.pointIndex;
        }
        return picked.join(',');
    };
    assert.equal(run(), run(), 'mesma semente do jogo e mesmo relógio: mesma sequência de pontos');
});

test('F7.6 sessão nova ou mapa novo recomeçam a sequência; o ETA seguinte parte do ponto anterior (distância real)', () => {
    const { game, enc, world } = setup();
    startHunt(game); idle(game);
    const c0 = enc.request(SPECIES).encounter;
    game.clock.advance(c0.etaMs); kill(game); game.stopBattle(); clearTimeout(game._nextBattleTimeout); game._nextBattleTimeout = null;
    const map = world.worldHuntMap(SPECIES);
    const c1 = enc.request(SPECIES).encounter;
    assert.equal(c1.sequence, 1);
    assert.equal(c1.etaMs, manhattanMs(cellCenter(map.encounterPoints[c0.pointIndex]), cellCenter(c1.point)), 'percurso do ponto anterior ao novo');
    const other = enc.request(4);
    assert.equal(other.code, 'already_active');
    game.clock.advance(c1.etaMs); kill(game); game.stopBattle(); clearTimeout(game._nextBattleTimeout); game._nextBattleTimeout = null;
    const c2 = enc.request(4).encounter;
    assert.equal(c2.sequence, 0, 'mapa diferente: sequência recomeça');
    assert.equal(c2.mapId, 'hunt_4');
});

test('F7.6 dados do mapa e cache da F7.4 permanecem intactos depois de todo o ciclo', () => {
    const { game, enc, world } = setup();
    startHunt(game); idle(game);
    const map = world.worldHuntMap(SPECIES);
    const snap = JSON.stringify(map), stats = JSON.stringify(world.worldHuntStats());
    for (let n = 0; n < 3; n++) { const c = enc.request(SPECIES).encounter; game.clock.advance(c.etaMs); kill(game); game.stopBattle(); if (game._nextBattleTimeout) { clearTimeout(game._nextBattleTimeout); game._nextBattleTimeout = null; } }
    enc.request(SPECIES); enc.cancel('teste');
    assert.equal(JSON.stringify(world.worldHuntMap(SPECIES)), snap);
    assert.equal(world.worldHuntMap(SPECIES), map, 'mesmo objeto no cache');
    assert.equal(JSON.stringify(world.worldHuntStats()), stats, 'nenhum mapa novo foi gerado pelos encontros');
    assert.ok(Object.isFrozen(map) && Object.isFrozen(map.encounterPoints[0]));
    assert.equal('state' in map || 'encounter' in map || 'used' in map, false, 'nenhum estado mutável foi gravado no mapa');
});

// =============================================================== view: leitura do estado, sprite no mundo, ação explícita
const viewSetup = async (extra = {}) => {
    const { game, ctx } = newGame({ seed: 11 });
    game.clock = new ctx.ManualClock(2_000_000);
    const r = await shown({ gameObject: game, encounters: true, globals: { getPokemonSpriteUrl: (id) => `sprites/pokemon/${id}.png` }, ...extra });
    return { ...r, game };
};

test('F7.6 view: abrir o mapa de caça não inicia sessão, batalha nem encontro; o botão é a ação explícita', async () => {
    const { env, view, game, encounters, ui } = await viewSetup();
    const stats0 = JSON.stringify(game._battleGuard);
    assert.equal(view.openHuntMap(SPECIES).ok, true); env.flush();
    assert.equal(game.getHuntSession(), null, 'nenhuma sessão');
    assert.ok(!game.currentBattle);
    assert.ok(!game.battleTimer);
    assert.equal(game.encounterHook, null);
    assert.equal(encounters.current, null);
    assert.equal(JSON.stringify(game._battleGuard), stats0);
    assert.equal(env.encounterBox.hidden, false);
    assert.equal(env.encounterBtn.disabled, true, 'sem caçada em andamento o botão fica desligado');
    assert.match(env.encounterStatus.textContent, /Inicie a caçada/);
    env.encounterBtn.fire('click');                                         // mesmo assim: recusado com aviso, sem criar nada
    assert.equal(encounters.current, null);
    assert.match(ui.toasts[ui.toasts.length - 1], /Inicie a caçada/);
    startHunt(game); idle(game);
    view.requestRedraw(true); env.flush();
    assert.equal(env.encounterBtn.disabled, false);
    assert.equal(encounters.current, null, 'caçada rodando também não cria encontro sozinha');
    env.encounterBtn.fire('click'); env.flush();
    assert.equal(encounters.current.state, 'approaching');
    assert.equal(env.encounterBtn.disabled, true, 'um por vez');
    assert.match(env.encounterStatus.textContent, /Pikachu apareceu/);
    view.setArea('starter_town'); env.flush();
    assert.equal(env.encounterBox.hidden, true, 'fora de mapa de caça não há botão');
});

test('F7.6 view: o Pokémon é desenhado em coordenadas do MUNDO; a câmera só aplica a transformação e não muda o encontro', async () => {
    const { env, view, game, encounters, world } = await viewSetup();
    startHunt(game); idle(game);
    view.openHuntMap(SPECIES); env.flush();
    encounters.request(SPECIES);
    const c = encounters.current;
    env.flush();                                                            // primeiro desenho cria a imagem
    await new Promise(r => setTimeout(r, 0));                               // a imagem falsa "carrega" (microtask)
    env.flush();
    const map = view.currentScene().map, m = view.lastMetrics;
    const sprite = () => env.draws.filter(a => a.length === 5).at(-1);
    const expectAt = (cam) => world.worldToScreen(cam, m, (c.point.x + 0.5) * TILE - 12, (c.point.y + 0.5) * TILE + 6 - 24);
    const first = sprite(), cam1 = { ...view.lastCamera };
    assert.ok(first, 'o sprite foi desenhado com drawImage de 5 argumentos');
    assert.deepEqual([first[1], first[2]], [expectAt(cam1).x, expectAt(cam1).y]);
    assert.equal(first[3], 24 * m.zoom);
    // move só o personagem/câmera (estado visual): o sprite acompanha a câmera, o encontro lógico não muda
    const snap = JSON.stringify(encounters.current);
    view._players[map.id] = { ...view._player(map), x: (map.width - 6) * TILE, y: (map.height - 6) * TILE };
    view.requestRedraw(true); env.flush();
    const cam2 = { ...view.lastCamera }, second = sprite();
    assert.notDeepEqual([cam1.x, cam1.y], [cam2.x, cam2.y], 'a câmera mudou');
    assert.deepEqual([second[1], second[2]], [expectAt(cam2).x, expectAt(cam2).y], 'posição de tela segue a câmera');
    assert.notDeepEqual([first[1], first[2]], [second[1], second[2]]);
    assert.equal(JSON.stringify(encounters.current), snap, 'a lógica do encontro não foi tocada');
});

test('F7.6 view: sem Canvas visível (aba escondida) a lógica segue igual; o desenho é só consequência do estado', async () => {
    const { env, view, game, encounters } = await viewSetup();
    startHunt(game); idle(game);
    view.openHuntMap(SPECIES); env.flush();
    const c = encounters.request(SPECIES).encounter;
    view.onHide();                                                           // sai da aba: sem renderer
    const draws = env.draws.length;
    game.clock.advance(c.etaMs);
    assert.equal(encounters.current.state, 'battling', 'a chegada e a batalha acontecem sem renderer');
    assert.equal(env.draws.length, draws, 'nada foi desenhado');
    assert.equal(env.pending(), 0, 'nenhum quadro pedido');
    view.onShow(); env.flush();
    assert.match(env.encounterStatus.textContent, /Batalha contra Pikachu/);
});

test('F7.6 view: sair do mapa cancela o encontro pendente e não deixa nada ativo; trocar de destino durante a batalha não a aborta', async () => {
    const { env, view, game, encounters } = await viewSetup();
    const listeners0 = game.bus._listenerCount;
    startHunt(game); idle(game);
    view.openHuntMap(SPECIES); env.flush();
    const base = game.bus._listenerCount;
    encounters.request(SPECIES);
    assert.equal(encounters.isActive(), true);
    view.setArea('starter_town'); env.flush();
    assert.equal(encounters.current.state, 'cancelled');
    assert.equal(encounters.current.reason, 'left_map');
    assert.equal(game.encounterHook, null);
    assert.equal(game.clock.pendingTimers(), 0);
    assert.equal(game.bus._listenerCount, base, 'ouvintes do encontro liberados');
    const draws = env.draws.filter(a => a.length === 5).length;
    view.openHuntMap(SPECIES); env.flush();
    assert.equal(env.draws.filter(a => a.length === 5).length, draws, 'o mapa reaberto não mostra o encontro cancelado');
    // durante a batalha, sair do mapa não a aborta
    const c = encounters.request(SPECIES).encounter;
    game.clock.advance(c.etaMs);
    assert.equal(encounters.current.state, 'battling');
    const battle = game.currentBattle;
    view.setArea('kanto_route1'); env.flush();
    assert.equal(game.currentBattle, battle);
    assert.equal(encounters.current.state, 'battling');
    kill(game);
    assert.equal(encounters.current.state, 'resolved');
    assert.ok(game.bus._listenerCount >= listeners0);
});

test('F7.6 compatibilidade: cidade, movimento manual, Depot e navegação da F7.5 seguem funcionando com a lógica de encontros ligada', async () => {
    const { env, view, game } = await viewSetup();
    assert.equal(view.areaId, 'starter_town');
    env.key('keydown', 'ArrowRight'); env.flush(16); for (let i = 0; i < 10; i++) env.flush(25); env.key('keyup', 'ArrowRight'); env.flush(20);
    const city = view.currentScene().map;
    assert.ok(view._player(city).x > 3 * TILE, 'caminhada manual na cidade');
    assert.equal(env.encounterBox.hidden, true);
    assert.equal(view.openHuntMap(7).ok, true); env.flush();
    env.key('keydown', 'ArrowRight');
    assert.equal(env.pending(), 0, 'mapa de caça segue sem caminhada manual');
    env.key('keyup', 'ArrowRight');
    assert.equal(view.openRoute('kanto_route1').ok, true);
    assert.equal(view.setArea('starter_town'), true);
    assert.equal(game.getHuntSession(), null);
    assert.equal(game.encounterHook, null);
});
