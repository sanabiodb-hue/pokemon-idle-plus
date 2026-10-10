'use strict';
// F7.10: robustez do ciclo de caça. Só o que as fases anteriores não provavam: (A) duração da sessão através de salvar/recarregar (defeito
// reproduzido: o trecho em andamento era descartado), (B) nenhuma batalha de rota durante a caminhada, por todas as portas de entrada,
// (C) geração do inimigo igual online × offline, com o mesmo consumo de RNG, (D) recarga + offline sem aplicar o mesmo intervalo duas vezes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, runOffline, plain } = require('./helpers/game');
const { loadWorld } = require('./helpers/world-env');

const SPECIES = 25, MIN = 60_000;
const dispatch = (game, type, extra = {}) => game.dispatchAutomationAction({ type, ...extra });
const session = (game) => game.getHuntSession();

function boot(opts = {}) {
    const g = newGame({ seed: opts.seed ?? 9, load: opts.load, storage: opts.storage });
    g.game.clock = new g.ctx.ManualClock(opts.clock ?? 10_000_000);
    const enc = new (loadWorld().WorldEncounters)(g.game);
    return { ...g, enc };
}

// =============================================================== A. duração da sessão através de salvar/recarregar
test('F7.10 A: a duração de uma caçada ativa sobrevive a salvar e recarregar (antes o trecho em andamento era perdido)', () => {
    const a = boot();
    assert.equal(dispatch(a.game, 'START_HUNT').ok, true);
    a.game.clock.advance(60 * MIN);
    const before = a.ctx.huntSessionDurationMs(session(a.game), a.game.clock.now());
    assert.equal(before, 60 * MIN);
    a.game.saveNow();
    const b = boot({ load: true, storage: a.storage, clock: a.game.clock.now() });
    const s = session(b.game);
    assert.equal(s.state, 'paused');
    assert.equal(s.pausedByReload, true);
    assert.equal(b.ctx.huntSessionDurationMs(s, b.game.clock.now()), before, 'a hora já caçada continua contando');
});

test('F7.10 A: salvar é idempotente — a duração calculada não muda com um, dois ou vários salvamentos, e a caçada segue contando', () => {
    const a = boot();
    dispatch(a.game, 'START_HUNT');
    const dur = () => a.ctx.huntSessionDurationMs(session(a.game), a.game.clock.now());
    a.game.clock.advance(10 * MIN);
    const d0 = dur();
    a.game.saveNow(); a.game.saveNow();
    assert.equal(dur(), d0, 'salvar não altera a duração');
    a.game.clock.advance(5 * MIN);
    a.game.saveNow();
    assert.equal(dur(), 15 * MIN);
    assert.equal(session(a.game).state, 'running', 'salvar não pausa nem para a caçada');
    // sessão pausada: nada é fixado (o tempo pausado não conta) e o salvamento não mexe nos campos
    dispatch(a.game, 'PAUSE_HUNT');
    const snap = JSON.stringify({ ms: session(a.game).activeMs, r: session(a.game).resumedAt });
    a.game.clock.advance(30 * MIN);
    a.game.saveNow();
    assert.equal(JSON.stringify({ ms: session(a.game).activeMs, r: session(a.game).resumedAt }), snap);
});

test('F7.10 A: o limite de tempo da caçada conta o tempo de antes da recarga (40 min + recarga + offline de 30 min → para aos 60 min)', async () => {
    const a = boot();
    assert.equal(a.game.setAutomationPolicy({ stopConditions: { timeLimitMinutes: 60 } }).ok, true);
    dispatch(a.game, 'START_HUNT');
    a.game.clock.advance(40 * MIN);
    a.game.saveNow();
    const gap = 30 * MIN;
    const b = boot({ load: true, storage: a.storage, clock: a.game.clock.now() + gap });
    b.game.gameState.lastSave = b.game.clock.now() - gap;
    const data = await runOffline(b.game, gap);
    const s = session(b.game);
    assert.equal(s.state, 'stopped', 'o limite de 60 min foi atingido (40 antes + 20 do offline)');
    assert.equal(s.stopReason, 'time_limit');
    const report = data.summary && data.summary.hunt;
    assert.ok(report, 'o offline devolve o relatório da caçada');
    assert.ok(Math.abs(report.huntMs - 20 * MIN) < 5000, `só os 20 min que faltavam foram caçados (${report.huntMs} ms), não os 30 min do intervalo`);
    assert.ok(s.activeMs >= 60 * MIN && s.activeMs < 60 * MIN + 5000, `a duração total fecha nos 60 min do limite (${s.activeMs} ms)`);
});

// =============================================================== B. nenhuma batalha de rota durante a caminhada
test('F7.10 B: durante o trajeto nenhuma porta de entrada cria uma batalha de rota (início direto, agendamento, visibilidade, poção, retomada)', () => {
    const a = boot();
    a.enc.begin(SPECIES);
    a.game.clock.advance(1500);
    const started = [];
    a.game.bus.on('battle_started', (e) => started.push(e));
    const leg = () => a.enc.cycle.leg;
    const assertQuiet = (how) => {
        assert.equal(started.length, 0, `${how}: nenhuma batalha começou`);
        assert.ok(!a.game.currentBattle, `${how}: sem batalha em curso`);
        assert.ok(!a.game.battleTimer, `${how}: sem timer de batalha`);
        assert.equal(leg().state, 'approaching', `${how}: o personagem segue andando`);
    };
    a.game.startBattle(); a.game.startBattle(); a.game.startBattle();
    assertQuiet('startBattle repetido');
    a.game._nextBattleScheduledAt = a.game.now() - 1;                     // um agendamento de "próxima batalha" que já venceu
    a.game._nextBattleTimeout = setTimeout(() => {}, 1e6);
    a.game._onPageHidden(); a.game.clock.advance(1000); a.game._onPageVisible();
    clearTimeout(a.game._nextBattleTimeout); a.game._nextBattleTimeout = null;
    assertQuiet('volta de aba escondida (≤ 2 s)');
    a.game.usePotion('manual');
    assertQuiet('poção sem batalha');
    dispatch(a.game, 'START_HUNT');
    dispatch(a.game, 'RESUME_HUNT');
    assertQuiet('START/RESUME redundantes');
    a.game.changeRoute(a.game.gameState.currentRoute);
    assertQuiet('trocar para a mesma rota');
    // ao chegar, a ÚNICA batalha é a do encontro, com a espécie do mapa
    a.game.clock.advance(a.enc.current.remainingMs + 1000);
    assert.equal(started.length, 1, 'uma batalha, só na chegada');
    assert.equal(a.game.currentBattle.wild.id, SPECIES);
});

// =============================================================== C. geração do inimigo online × offline
test('F7.10 C: o inimigo do encontro é o mesmo e consome o mesmo RNG online (sem cache) e no Fast Driver (com cache)', () => {
    for (let seed = 1; seed <= 60; seed++) {
        const run = (fast) => {
            const a = boot({ seed });
            a.enc.begin(SPECIES);
            let calls = 0;
            const base = a.game.rng;
            a.game.rng = () => { calls++; return base.call(a.game); };
            const cache = fast ? a.game._buildFastSimState(60_000, 60_000).spawnCache : null;
            const calls0 = calls;
            const e = fast ? a.enc.fastEnemy(cache) : a.enc._makeEnemy(null);      // entrada do Fast Driver × geração online (takeArrivedEnemy → _makeEnemy)
            return { calls: calls - calls0, enemy: JSON.stringify({ id: e.id, level: e.level, shiny: e.isShiny, ivs: e.ivs, nature: e.nature, gender: e.gender, ability: e.ability }) };
        };
        const online = run(false), fast = run(true);
        assert.equal(fast.enemy, online.enemy, `semente ${seed}: mesmo inimigo`);
        assert.equal(fast.calls, online.calls, `semente ${seed}: mesma quantidade de sorteios`);
        assert.ok(online.calls > 0);
    }
});

test('F7.10 C: a escolha dos pontos de encontro não usa o RNG do jogo nem o relógio (função pura de sessão, sequência e último ponto)', () => {
    const a = boot();
    const w = a.enc.begin(SPECIES);
    assert.equal(w.ok, true);
    const map = a.enc._map();
    const base = a.game.rng;
    let calls = 0;
    a.game.rng = () => { calls++; return base.call(a.game); };
    const sid = session(a.game).id, seqs = [];
    for (let seq = 0, last = null; seq < 50; seq++) {
        const picked = loadWorld().worldPickEncounterPoint(map, sid, seq, last, []);
        seqs.push(picked); last = picked;
    }
    assert.equal(calls, 0, 'nenhum sorteio do jogo');
    const again = [];
    for (let seq = 0, last = null; seq < 50; seq++) { const picked = loadWorld().worldPickEncounterPoint(map, sid, seq, last, []); again.push(picked); last = picked; }
    assert.deepEqual(again, seqs, 'mesma sequência para a mesma sessão');
});

// =============================================================== D. recarga + offline sem aplicar o intervalo duas vezes
test('F7.10 D: recarregar com a caçada do mundo ativa e rodar o offline uma vez; uma segunda recarga logo depois não repete batalhas nem progresso', async () => {
    const a = boot();
    a.enc.begin(SPECIES);
    a.game.clock.advance(3000);
    a.game.saveNow();
    const gap = 20 * MIN;
    const b = boot({ load: true, storage: a.storage, clock: a.game.clock.now() + gap });
    b.game.gameState.lastSave = b.game.clock.now() - gap;
    assert.equal(b.enc.cycle.leg.progressPx, 192, 'a perna volta de onde parou (64 px/s × 3 s)');
    const r = await runOffline(b.game, gap);
    assert.ok(r.battles > 30, `a caçada offline rendeu batalhas (${r.battles})`);
    const sb = session(b.game);
    assert.equal(sb.state, 'paused', 'voltou pausada, aguardando a retomada explícita');
    assert.equal(sb.stats.victories + sb.stats.defeats, r.battles, 'contadores da sessão = batalhas simuladas, uma vez');
    const worldB = JSON.stringify(sb.world);
    b.game.saveNow();
    const c = boot({ load: true, storage: b.storage, clock: b.game.clock.now() + 500 });
    const sc = session(c.game);
    assert.equal(sc.stats.victories, sb.stats.victories, 'a segunda recarga não soma batalhas');
    assert.equal(JSON.stringify(sc.world), worldB, 'nem altera o progresso da perna');
    assert.equal(c.ctx.huntSessionDurationMs(sc, c.game.clock.now()), c.ctx.huntSessionDurationMs(sb, b.game.clock.now()), 'nem a duração');
});
