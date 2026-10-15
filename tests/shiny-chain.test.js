'use strict';
// F9.1: cadeia de shiny na caçada. Vitórias seguidas contra a MESMA espécie na mesma sessão aumentam (com teto ×3) a taxa de shiny dessa espécie.
// Regras puras (hunt-session.js), integração com o jogo real (engine + createWildPokemon), save e paridade online × Fast Driver.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, runOffline } = require('./helpers/game');
const { loadWorld } = require('./helpers/world-env');
const { makeFakeDom, makeUi } = require('./helpers/fake-dom');

const dispatch = (game, type, extra = {}) => game.dispatchAutomationAction({ type, ...extra });
const session = (game) => game.getHuntSession();
const plain = (o) => JSON.parse(JSON.stringify(o));

function boot(opts = {}) {
    const g = newGame({ seed: opts.seed ?? 5, storage: opts.storage, load: opts.load });
    g.game.clock = new g.ctx.ManualClock(opts.clock ?? 10_000_000);
    return g;
}
const win = (game, id = 19) => game._emit('battle_completed', { result: 'victory', enemyId: id, xp: 1, gold: 1, route: game.gameState.currentRoute });
const lose = (game, id = 19) => game._emit('battle_completed', { result: 'defeat', enemyId: id, xp: 0, gold: 0, route: game.gameState.currentRoute, tower: false });
const chain = (game) => { const c = session(game) && session(game).shinyChain; return c === undefined ? undefined : plain(c); };
// RNG fixo: o sorteio de shiny é a PRIMEIRA chamada de createWildPokemon depois dos IVs (6 chamadas), então devolvemos `v` só nela
function shinyAt(game, v, id = 19) {
    const saved = game.rng;
    let n = 0;
    game.rng = () => (++n === 7 ? v : 0.5);                 // 6 IVs + 1 sorteio de shiny
    const w = game.createWildPokemon(id, 5);
    game.rng = saved;
    return { shiny: w.isShiny, calls: n };
}

// =============================================================== A. regras puras
test('F9.1 A: multiplicador = min(3, 1 + 0,05 × vitórias); teto exato em 40 vitórias e nunca acima', () => {
    const { ctx } = boot();
    const m = (n) => ctx.huntShinyChainMultiplier(n);
    assert.equal(m(0), 1);
    assert.ok(Math.abs(m(1) - 1.05) < 1e-12 && Math.abs(m(10) - 1.5) < 1e-12 && Math.abs(m(20) - 2) < 1e-12);
    assert.ok(Math.abs(m(39) - 2.95) < 1e-12);
    assert.equal(m(40), 3);
    for (const n of [41, 100, 1e6, 1e9]) assert.equal(m(n), 3, `n=${n}`);
    assert.equal(ctx.SHINY_CHAIN_MAX_MULT, 3);
    assert.equal(m(-5), 1, 'contador negativo não reduz a taxa');
});

test('F9.1 A: registro — soma na mesma espécie, recomeça em 1 em outra, zera na derrota, ignora sessão que não está rodando e entradas inválidas', () => {
    const { ctx } = boot();
    const rec = (s, r, id) => ctx.huntSessionShinyChainRecord(s, r, id);
    const s = { state: 'running' };
    assert.equal(rec(s, 'victory', 25), true); assert.equal(JSON.stringify(s.shinyChain), '{"speciesId":25,"count":1}');
    rec(s, 'victory', 25); rec(s, 'victory', 25);
    assert.equal(s.shinyChain.count, 3);
    rec(s, 'victory', 4);
    assert.equal(JSON.stringify(s.shinyChain), '{"speciesId":4,"count":1}', 'outra espécie: recomeça em 1 (a nova espécie)');
    assert.equal(rec(s, 'defeat', 4), true); assert.equal(s.shinyChain, undefined);
    assert.equal(rec(s, 'defeat', 4), false, 'derrota sem cadeia: nada a fazer');
    for (const bad of [undefined, null, 'x', 0, -1, 1.5, NaN]) { const t = { state: 'running' }; assert.equal(rec(t, 'victory', bad), false); assert.equal(t.shinyChain, undefined); }
    for (const state of ['paused', 'stopped', 'finished', 'idle']) { const t = { state, shinyChain: { speciesId: 25, count: 4 } }; assert.equal(rec(t, 'victory', 25), false); assert.equal(t.shinyChain.count, 4, state); assert.equal(rec(t, 'defeat', 25), false); assert.equal(t.shinyChain.count, 4); }
    assert.equal(rec(null, 'victory', 25), false);
    const cap = { state: 'running', shinyChain: { speciesId: 25, count: ctx.SHINY_CHAIN_MAX_COUNT } };
    rec(cap, 'victory', 25); assert.equal(cap.shinyChain.count, ctx.SHINY_CHAIN_MAX_COUNT, 'contador salvo tem guarda de sanidade');
});

test('F9.1 A: o multiplicador só vale para a espécie da cadeia, com a sessão rodando', () => {
    const { ctx } = boot();
    const mult = (s, id) => ctx.huntSessionShinyMult(s, id);
    const chainOf = { speciesId: 25, count: 20 };
    assert.equal(mult({ state: 'running', shinyChain: chainOf }, 25), 2);
    assert.equal(mult({ state: 'running', shinyChain: chainOf }, 4), 1, 'outra espécie');
    for (const state of ['paused', 'stopped', 'finished']) assert.equal(mult({ state, shinyChain: chainOf }, 25), 1, state);
    assert.equal(mult({ state: 'running' }, 25), 1);
    assert.equal(mult(null, 25), 1);
    assert.equal(mult({ state: 'running', shinyChain: { speciesId: 25, count: 0 } }, 25), 1);
});

// =============================================================== B. integração com o jogo real (engine + sessão)
test('F9.1 B: na sessão real a cadeia cresce com vitórias seguidas, reinicia em outra espécie, zera na derrota e a pausa preserva', () => {
    const { game } = boot();
    assert.equal(dispatch(game, 'START_HUNT').ok, true);
    assert.equal(chain(game), undefined, 'sessão nova: cadeia zerada');
    win(game, 19); win(game, 19); win(game, 19);
    assert.deepEqual(chain(game), { speciesId: 19, count: 3 });
    win(game, 25);
    assert.deepEqual(chain(game), { speciesId: 25, count: 1 });
    win(game, 25);
    dispatch(game, 'PAUSE_HUNT');
    win(game, 25);                                              // pausada: nada é contado
    assert.deepEqual(chain(game), { speciesId: 25, count: 2 }, 'pausar preserva e não conta');
    dispatch(game, 'RESUME_HUNT');
    win(game, 25);
    assert.deepEqual(chain(game), { speciesId: 25, count: 3 });
    lose(game, 25);
    assert.equal(chain(game), undefined, 'o líder caiu: zera');
});

test('F9.1 B: parar e iniciar nova sessão começa sem cadeia; batalha da Torre nunca conta nem zera; sem sessão nada acontece', () => {
    const { game } = boot();
    win(game, 19);                                              // sem sessão: nenhum efeito, nenhum erro
    assert.equal(session(game), null);
    dispatch(game, 'START_HUNT');
    win(game, 19); win(game, 19);
    game._emit('battle_completed', { result: 'victory', enemyId: 19, xp: 0, gold: 0, route: 'x', tower: true });
    game._emit('battle_completed', { result: 'defeat', enemyId: 19, xp: 0, gold: 0, route: 'x', tower: true });
    assert.deepEqual(chain(game), { speciesId: 19, count: 2 }, 'eventos da Torre são ignorados');
    dispatch(game, 'STOP_HUNT');
    win(game, 19);
    assert.deepEqual(chain(game), { speciesId: 19, count: 2 }, 'sessão parada não muda');
    dispatch(game, 'START_HUNT');
    assert.equal(chain(game), undefined, 'nova sessão: cadeia zerada');
});

test('F9.1 B: encontro cancelado do mundo não conta nem zera a cadeia (não há battle_completed)', () => {
    const { game } = boot();
    const enc = new (loadWorld().WorldEncounters)(game);
    assert.equal(enc.begin(25).ok, true);
    session(game).shinyChain = { speciesId: 25, count: 7 };
    game.clock.advance(3000);
    enc.cancel('probe');
    assert.deepEqual(chain(game), { speciesId: 25, count: 7 });
    dispatch(game, 'STOP_HUNT');
});

test('F9.1 B: fluxo real do mundo e da fila — a cadeia cresce com as vitórias do alvo e o próximo alvo começa numa sessão nova, sem cadeia', () => {
    const { game, ctx } = boot({ seed: 9 });
    const enc = new (loadWorld().WorldEncounters)(game);
    const hq = new ctx.HuntQueue(game, enc);
    const killNow = () => { const b = game.currentBattle; b.wildCurrentHp = 1; b.playerTimer = b.playerNextAttack; b.enemyTimer = 0; const sv = game.rng; game.rng = () => 0.99; game.battleTick(); game.rng = sv; };
    assert.equal(hq.add(25, 1).ok, true); assert.equal(hq.add(16, 1).ok, true);
    assert.equal(hq.start().ok, true);
    const first = session(game).id;
    game.clock.advance(60_000 + 5000);                          // chega e a batalha do encontro começa
    if (game.battleTimer) { clearInterval(game.battleTimer); game.battleTimer = null; }
    assert.ok(game.currentBattle, 'batalha do alvo 1');
    assert.equal(game.currentBattle.wild.id, 25);
    killNow();                                                  // vitória real: pokemon_defeated → battle_completed → engine
    assert.deepEqual(chain(game), { speciesId: 25, count: 1 }, 'a vitória real contra o alvo inicia a cadeia');
    game.clock.advance(5000);
    const s2 = session(game);
    if (s2 && s2.id !== first) assert.equal(s2.shinyChain, undefined, 'o próximo alvo começa numa sessão nova, sem cadeia herdada');
    else if (s2) assert.ok(!s2.shinyChain || s2.shinyChain.speciesId === 25);
});

// =============================================================== C. taxa de shiny (determinística)
test('F9.1 C: a taxa base é 1/4096 e a cadeia multiplica no sorteio; ainda é UMA chamada ao RNG', () => {
    const { game, ctx } = boot();
    const base = 1 / 4096;
    assert.equal(game.getShinyRate(), base, 'taxa atual (sem insígnia, talento ou Torre)');
    dispatch(game, 'START_HUNT');
    assert.equal(shinyAt(game, base * 0.999).shiny, true);
    assert.equal(shinyAt(game, base * 1.001).shiny, false, 'sem cadeia: só abaixo da taxa base');
    for (const [count, mult] of [[10, 1.5], [20, 2], [40, 3], [500, 3]]) {
        session(game).shinyChain = { speciesId: 19, count };
        const r = shinyAt(game, base * mult * 0.999), r2 = shinyAt(game, base * mult * 1.001);
        assert.equal(r.shiny, true, `count ${count}: abaixo do limiar ×${mult}`);
        assert.equal(r2.shiny, false, `count ${count}: acima do limiar ×${mult}`);
        assert.equal(r.calls, 7, 'IVs (6) + um único sorteio de shiny: o consumo de RNG não mudou');
    }
    session(game).shinyChain = { speciesId: 19, count: 500 };
    assert.equal(shinyAt(game, base * 3.001).shiny, false, 'o teto é ×3, nunca mais');
    assert.equal(shinyAt(game, base * 1.5, 25).shiny, false, 'outra espécie: taxa base');
});

test('F9.1 C: compõe com os multiplicadores existentes (insígnia × talento × Torre) e com o teto', () => {
    const { game } = boot();
    dispatch(game, 'START_HUNT');
    game.getBadgeEffectValue = (t) => (t === 'shiny_bonus' ? 1.0 : null);       // insígnia de Sinnoh: +100%
    game.getTalentValue = (t) => (t === 'shiny_bonus' ? 50 : 0);                // talento: +50%
    game.getTowerBonus = () => 0;
    const composed = (1 / 4096) * 2 * 1.5;
    assert.ok(Math.abs(game.getShinyRate() - composed) < 1e-15);
    session(game).shinyChain = { speciesId: 19, count: 20 };                    // ×2
    assert.equal(shinyAt(game, composed * 2 * 0.999).shiny, true);
    assert.equal(shinyAt(game, composed * 2 * 1.001).shiny, false);
    session(game).shinyChain = { speciesId: 19, count: 40 };                    // ×3 (teto)
    assert.equal(shinyAt(game, composed * 3 * 0.999).shiny, true);
    assert.equal(shinyAt(game, composed * 3 * 1.001).shiny, false);
});

test('F9.1 C: na Torre e fora de sessão rodando a cadeia não tem efeito', () => {
    const { game } = boot();
    dispatch(game, 'START_HUNT');
    session(game).shinyChain = { speciesId: 19, count: 40 };
    const base = 1 / 4096;
    game._towerMode = true;
    assert.equal(shinyAt(game, base * 2).shiny, false, 'Torre: sem bônus');
    game._towerMode = false;
    dispatch(game, 'PAUSE_HUNT');
    assert.equal(shinyAt(game, base * 2).shiny, false, 'sessão pausada: sem bônus (a cadeia só é guardada)');
    dispatch(game, 'RESUME_HUNT');
    assert.equal(shinyAt(game, base * 2).shiny, true, 'rodando: bônus');
});

test('F9.1 C: o valor do sorteio sem cadeia é idêntico ao anterior à fase (multiplicar por 1 não é feito)', () => {
    const { game } = boot();
    dispatch(game, 'START_HUNT');
    const base = game.getShinyRate();
    for (const v of [0, base / 2, base - Number.EPSILON, base, base * 1.0000001, 0.5]) {
        const expected = v < base;
        assert.equal(shinyAt(game, v).shiny, expected, `v=${v}`);
    }
});

// =============================================================== D. save
test('F9.1 D: ida e volta no save; save antigo sem o campo carrega zerado; valores inválidos são sanitizados sem derrubar a sessão', () => {
    const a = boot({ seed: 3 });
    dispatch(a.game, 'START_HUNT');
    win(a.game, 25); win(a.game, 25); win(a.game, 25);
    a.game.saveNow();
    const b = boot({ seed: 4, load: true, storage: a.storage });
    assert.deepEqual(chain(b.game), { speciesId: 25, count: 3 }, 'a cadeia sobrevive ao recarregar (a sessão volta pausada)');
    assert.equal(session(b.game).state, 'paused');
    // save antigo: sem o campo
    const raw = plain(session(a.game)); delete raw.shinyChain;
    const old = b.ctx.sanitizeHuntSession(raw);
    assert.ok(old && old.shinyChain === undefined);
    // inválidos: só a cadeia é descartada
    for (const bad of [null, 5, 'x', [], {}, { speciesId: 0, count: 3 }, { speciesId: -1, count: 3 }, { speciesId: 1.5, count: 3 }, { speciesId: '25', count: 3 },
        { speciesId: 25, count: 0 }, { speciesId: 25, count: -4 }, { speciesId: 25, count: 2.5 }, { speciesId: 25, count: '3' }, { speciesId: 25, count: 1e12 },
        { speciesId: 25, count: Infinity }, { speciesId: 25, count: NaN }, { speciesId: 25 }, { count: 3 }, { speciesId: 1e12, count: 3 }]) {
        const r = plain(session(a.game)); r.shinyChain = bad;
        const s = b.ctx.sanitizeHuntSession(r);
        assert.ok(s, `a sessão continua válida: ${JSON.stringify(bad)}`);
        assert.equal(s.shinyChain, undefined, JSON.stringify(bad));
    }
    const ok = plain(session(a.game)); ok.shinyChain = { speciesId: 25, count: 7, extra: 'x' };
    assert.equal(JSON.stringify(b.ctx.sanitizeHuntSession(ok).shinyChain), '{"speciesId":25,"count":7}', 'só os campos conhecidos');
    assert.equal(a.ctx.SAVE_SCHEMA_VERSION, 3, 'a versão do save não mudou');
});

// =============================================================== E. paridade online × Fast Driver
// Mesma semente, mesmo estado, mesma rota (espécie A comum e fácil; espécie B rara e fortíssima, que derrota o líder): o caminho online
// (battleTick) e o Fast Driver (_fastBattleStep) precisam gerar os MESMOS inimigos (espécie e shiny), a MESMA sequência de chamadas ao RNG
// e terminar com a MESMA cadeia, passando por vitórias seguidas, troca de espécie e derrotas.
const TICK = 50;
function parityGame(seed) {
    const g = boot({ seed });
    const { game } = g;
    const route = { id: 'kanto_route1', name: 'Parity', levelRange: [3, 3], pokemon: [{ id: 19, weight: 18, levelRange: [3, 3] }, { id: 150, weight: 2, levelRange: [3000, 3000] }] };
    game.getRoute = () => route;
    game.getShinyRate = () => 0.05;                              // alto, para o bônus da cadeia aparecer nos sorteios
    const inst = game._partyInstance(0); inst.level = 400; game._touchInstance(inst);
    const pol = game.getAutomationPolicy(); pol.heal = { ...pol.heal, enabled: false };      // sem poção automática: a derrota segue o mesmo caminho nos dois motores
    assert.equal(game.setAutomationPolicy(pol).ok, true);
    assert.equal(dispatch(game, 'START_HUNT').ok, true);        // START_HUNT já abre a 1ª batalha: descarta-a para os dois caminhos partirem do mesmo ponto
    game.stopBattle(); game.gameState.currentEnemy = null; delete game.gameState.battleHp;
    if (game._nextBattleTimeout) { clearTimeout(game._nextBattleTimeout); game._nextBattleTimeout = null; game._nextBattleScheduledAt = null; }
    if (game.healTimer) { clearTimeout(game.healTimer); clearInterval(game.healTimer); game.healTimer = null; }
    delete session(game).shinyChain;
    const log = { rng: [], enemies: [], results: [] };
    const baseRng = game.rng;
    game.rng = () => { const v = baseRng.call(game); log.rng.push(v); return v; };
    const make = game.createWildPokemon.bind(game);
    game.createWildPokemon = (...a) => { const w = make(...a); log.enemies.push([w.id, !!w.isShiny]); return w; };
    game.bus.on('battle_completed', (e) => log.results.push(e.result));
    return { ...g, log, route };
}
function runOnlineSeq(seed, n) {
    const t = parityGame(seed), { game, log } = t;
    for (let i = 0; i < n; i++) {
        assert.equal(game.startBattle(), true, `batalha ${i}`);
        game._stopBattleTimer();
        game.currentBattle.lastTick = game.now();
        const before = log.results.length;
        for (let k = 0; k < 200000 && log.results.length === before; k++) { game.clock.advance(TICK); game.battleTick(); }
        if (game._nextBattleTimeout) { clearTimeout(game._nextBattleTimeout); game._nextBattleTimeout = null; game._nextBattleScheduledAt = null; }
        if (game.healTimer) { clearTimeout(game.healTimer); clearInterval(game.healTimer); game.healTimer = null; }
        game.stopBattle(); game.gameState.currentEnemy = null; delete game.gameState.battleHp;
    }
    return t;
}
function runFastSeq(seed, n) {
    const t = parityGame(seed), { game } = t;
    const total = 24 * 3600 * 1000;
    const s = game._buildFastSimState(total, total);
    game._getNextBattleDelay = () => 0;
    for (let i = 0; i < n; i++) assert.equal(game._fastBattleStep(s), true, `passo ${i}`);
    return t;
}
const snapshot = (t) => ({ enemies: t.log.enemies, results: t.log.results, rngCalls: t.log.rng.length, chain: chain(t.game) });

test('F9.1 E: Fast Driver e online geram os mesmos inimigos, a mesma sequência de RNG e a mesma cadeia (vitórias seguidas, troca de espécie e derrotas)', () => {
    let sawDefeat = false, sawLongChain = false, sawShiny = false, sawSwitch = false;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
        const on = runOnlineSeq(seed, 70), fast = runFastSeq(seed, 70);
        const a = snapshot(on), b = snapshot(fast);
        assert.deepEqual(b.enemies, a.enemies, `seed ${seed}: espécie e shiny de cada inimigo`);
        assert.deepEqual(b.results, a.results, `seed ${seed}: sequência de vitórias/derrotas`);
        assert.equal(b.rngCalls, a.rngCalls, `seed ${seed}: quantidade de chamadas ao RNG`);
        assert.deepEqual(fast.log.rng, on.log.rng, `seed ${seed}: sequência de valores do RNG`);
        assert.equal(JSON.stringify(b.chain), JSON.stringify(a.chain), `seed ${seed}: cadeia final`);
        sawDefeat ||= a.results.includes('defeat');
        sawShiny ||= a.enemies.some(e => e[1]);
        // cadeia longa: maior sequência de vitórias seguidas contra a mesma espécie
        let run = 0, best = 0, prev = null;
        a.enemies.forEach((e, i) => { run = a.results[i] === 'victory' && e[0] === prev ? run + 1 : (a.results[i] === 'victory' ? 1 : 0); prev = a.results[i] === 'victory' ? e[0] : null; best = Math.max(best, run); });
        sawLongChain ||= best >= 8;
        sawSwitch ||= a.enemies.some((e, i) => i > 0 && e[0] !== a.enemies[i - 1][0]);
    }
    assert.ok(sawDefeat && sawLongChain && sawSwitch && sawShiny, `cenário cobre derrota, cadeia longa, troca de espécie e shiny: ${JSON.stringify({ sawDefeat, sawLongChain, sawSwitch, sawShiny })}`);
});

test('F9.1 E: o bônus muda o resultado do sorteio mas não o consumo de RNG (com e sem cadeia, mesmas chamadas)', () => {
    const run = (withChain) => {
        const { game } = boot({ seed: 7 });
        dispatch(game, 'START_HUNT');
        if (withChain) session(game).shinyChain = { speciesId: 19, count: 40 };
        let calls = 0; const base = game.rng; game.rng = () => { calls++; return base.call(game); };
        const out = []; for (let i = 0; i < 400; i++) out.push(game.createWildPokemon(19, 5, 0.1).isShiny);
        return { calls, shinies: out.filter(Boolean).length };
    };
    const a = run(false), b = run(true);
    assert.equal(a.calls, b.calls, 'mesmo número de chamadas');
    assert.ok(b.shinies > a.shinies, `com a cadeia no teto saem mais shinies (${a.shinies} → ${b.shinies})`);
});

// =============================================================== F. Central de Caça
function bootUi(opts = {}) {
    const g = boot(opts);
    const dom = makeFakeDom(g.ctx);
    const ui = makeUi(g.game);
    ui.worldEncounters = new (loadWorld().WorldEncounters)(g.game);
    ui.worldView = { openHuntMap: () => ({ ok: true }) };
    const view = new g.ctx.HuntView(ui);
    view.render();
    return { ...g, dom, view, ui };
}

test('F9.1 F: a linha "Cadeia: N · +X% shiny" só aparece com N > 0 e sessão ativa; mostra "(máx.)" no teto', () => {
    const t = bootUi();
    const line = () => /Cadeia: \d+ · \+\d+% shiny/.exec(t.dom.text('hunt-target-live'));
    assert.equal(line(), null, 'sem sessão');
    dispatch(t.game, 'START_HUNT'); t.view.render();
    assert.equal(line(), null, 'sessão sem cadeia (N = 0)');
    win(t.game, 25); t.view.renderTarget();
    assert.equal(line()[0], 'Cadeia: 1 · +5% shiny');
    for (let i = 0; i < 9; i++) win(t.game, 25);
    t.view.renderTarget();
    assert.equal(line()[0], 'Cadeia: 10 · +50% shiny');
    assert.doesNotMatch(t.dom.text('hunt-target-live'), /máx/);
    for (let i = 0; i < 30; i++) win(t.game, 25);
    t.view.renderTarget();
    assert.match(t.dom.text('hunt-target-live'), /Cadeia: 40 · \+200% shiny \(máx\.\)/);
    for (let i = 0; i < 5; i++) win(t.game, 25);
    t.view.renderTarget();
    assert.match(t.dom.text('hunt-target-live'), /Cadeia: 45 · \+200% shiny \(máx\.\)/, 'o contador segue, o bônus fica no teto');
    dispatch(t.game, 'PAUSE_HUNT'); t.view.renderTarget();
    assert.ok(line(), 'pausada: a cadeia guardada continua visível');
    dispatch(t.game, 'RESUME_HUNT'); lose(t.game, 25); t.view.renderTarget();
    assert.equal(line(), null, 'derrota: some');
    dispatch(t.game, 'STOP_HUNT'); t.view.renderTarget();
    assert.equal(line(), null, 'parada: some');
});

test('F9.1 F: o snapshot da Central expõe a cadeia (ou null) sem alterar o resto do retrato', () => {
    const t = bootUi();
    assert.equal(t.ctx.huntCenterSnapshot(t.game, t.ui.worldEncounters).shinyChain, null);
    dispatch(t.game, 'START_HUNT'); win(t.game, 25); win(t.game, 25);
    const snap = t.ctx.huntCenterSnapshot(t.game, t.ui.worldEncounters);
    assert.equal(JSON.stringify(snap.shinyChain), '{"speciesId":25,"count":2,"bonusPct":10,"capped":false}');
    assert.equal(snap.sessionState, 'running');
});

test('F9.1 E: pelo pipeline offline REAL (_processOfflineBattles) a cadeia da sessão é exatamente a dobra dos eventos battle_completed emitidos', async () => {
    const { game, ctx } = boot({ seed: 21 });
    const route = { id: 'kanto_route1', name: 'Parity', levelRange: [3, 3], pokemon: [{ id: 19, weight: 18, levelRange: [3, 3] }, { id: 150, weight: 2, levelRange: [3000, 3000] }] };
    game.getRoute = () => route;
    const inst = game._partyInstance(0); inst.level = 400; game._touchInstance(inst);
    const pol = game.getAutomationPolicy(); pol.heal = { ...pol.heal, enabled: false }; game.setAutomationPolicy(pol);
    dispatch(game, 'START_HUNT');
    game.stopBattle(); game.gameState.currentEnemy = null;
    const ev = [];
    game.bus.on('battle_completed', (e) => ev.push({ r: e.result, id: e.enemyId, off: !!e.offline }));
    const res = await runOffline(game, 20 * 60 * 1000);
    assert.ok(ev.length > 30 && ev.every(e => e.off), `eventos offline emitidos (${ev.length})`);
    assert.ok(ev.some(e => e.r === 'defeat') && ev.some(e => e.id === 150), 'houve derrota e troca de espécie no período');
    const fold = { state: 'running' };
    for (const e of ev) ctx.huntSessionShinyChainRecord(fold, e.r, e.id);
    assert.equal(JSON.stringify(chain(game) || null), JSON.stringify(fold.shinyChain || null), 'cadeia salva = dobra dos eventos');
    assert.ok(res && session(game), 'a simulação terminou com a sessão presente');
});
