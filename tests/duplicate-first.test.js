'use strict';
// F9.9: o sorteio de 5% da duplicata vem ANTES do consumo da bola. Ordem exata do RNG por categoria, bola só quando o sorteio passa, restante idêntico ao baseline,
// sem enxurrada de eventos e paridade online × Fast Driver.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { newGame, mulberry32 } = require('./helpers/game');
const { runOnline, runFast, digest } = require('./helpers/capture-golden');

const plain = (o) => JSON.parse(JSON.stringify(o));
const wild = (id, shiny = false, v = 1) => ({ id, level: 5, isShiny: shiny, ivs: { hp: v, atk: v, def: v, spAtk: v, spDef: v, speed: v } });
const iv = (v) => ({ hp: v, atk: v, def: v, spAtk: v, spDef: v, speed: v });
const on = (opts = {}) => { const g = newGame({ balls: true, ...opts }); vm.runInContext('BALL_RESTOCK_ENABLED = false', g.ctx.sandbox); return g; };
function hunt(opts = {}) {
    const g = on(opts); const inv = g.game.ensureInventory(); inv.ballsGranted = true; inv.balls = { pokeball: 10 };
    g.game.dispatchAutomationAction({ type: 'START_HUNT' }); g.game.stopBattle(); return g;
}
const own = (game, id, v) => game.catchPokemonWithIvs(id, 1, iv(v));
const policy = (game, p) => { game.gameState.settings = Object.assign({}, game.gameState.settings, { captureDuplicates: p }); };
// um processDefeat com valores de RNG roteirizados; devolve os valores consumidos, a ordem relativa rng × consumo de bola e o resultado
function once(game, w, values) {
    const trace = []; let i = 0; const used = [];
    game.rng = () => { const v = values[Math.min(i++, values.length - 1)]; used.push(v); trace.push('rng'); return v; };
    const cb = game.consumeBall.bind(game); game.consumeBall = (id, n) => { trace.push('ball'); return cb(id, n); };
    const out = game.processDefeat(w);
    return { out, used, trace, balls: game.getBalls().pokeball || 0 };
}

// =============================================================== A. ordem exata por categoria
test('F9.9 A: duplicata sem ganho de IV (política padrão) — o sorteio de 5% vem PRIMEIRO; recusado: 1 sorteio, nenhuma bola; aprovado: sorteio da duplicata → bola → traços', () => {
    // recusado (0,05 não é < 0,05; 0,9 também): 1 sorteio, sem bola, não captura
    for (const dice of [0.05, 0.5, 0.9999]) {
        const { game } = hunt(); own(game, 16, 25);
        const r = once(game, wild(16, false, 5), [dice, 0.5, 0.5, 0.5, 0.5, 0.5]);
        assert.equal(r.out, null, `dado ${dice}: não captura`); assert.deepEqual(r.used, [dice], 'só o sorteio da duplicata'); assert.equal(r.balls, 10, 'bola intacta'); assert.deepEqual(r.trace, ['rng']);
        assert.equal(game.getDuplicatesDeclined(), 1);
    }
    // aprovado (< 0,05) e bola pega: dado, bola, depois os 4 traços do indivíduo novo; a bola é consumida DEPOIS do sorteio da duplicata
    const { game } = hunt(); own(game, 16, 25);
    const r = once(game, wild(16, false, 5), [0.049, 0.5, 0.11, 0.22, 0.33, 0.44]);
    assert.ok(r.out && r.out.uid, 'captura o indivíduo novo'); assert.equal(r.used.length, 6); assert.deepEqual(r.used.slice(0, 2), [0.049, 0.5], 'dado primeiro, bola depois');
    assert.deepEqual(r.trace.slice(0, 3), ['rng', 'ball', 'rng'], 'o sorteio da duplicata antecede o consumo da bola, que antecede o sorteio da bola');
    assert.equal(r.balls, 9); assert.equal(game.getDuplicatesDeclined(), 0);
    // aprovado, mas a bola escapa (chance 0,95): a bola foi gasta, não captura, e ninguém sorteia a duplicata de novo
    const b = hunt(); own(b.game, 16, 25);
    const r2 = once(b.game, wild(16, false, 5), [0.01, 0.9999, 0.5]);
    assert.equal(r2.out, null); assert.deepEqual(r2.used, [0.01, 0.9999], 'dado + bola, nada mais'); assert.equal(r2.balls, 9);
});

test('F9.9 A: categorias que NÃO mudam — espécie nova, shiny, IV melhor e políticas better/off seguem a ordem do baseline (bola → duplicata → traços)', () => {
    // espécie nova: bola, depois 4 traços
    let g = hunt(); let r = once(g.game, wild(16, false, 5), [0.5, 0.1, 0.2, 0.3, 0.4, 0.9]);
    assert.ok(r.out); assert.deepEqual(r.used, [0.5, 0.1, 0.2, 0.3, 0.4], 'bola + 4 traços'); assert.deepEqual(r.trace.slice(0, 2), ['rng', 'rng'].slice(0, 0).concat(['ball', 'rng']));
    // shiny de espécie possuída: bola, traços (sem sorteio de duplicata)
    g = hunt(); own(g.game, 16, 25); r = once(g.game, wild(16, true, 5), [0.5, 0.1, 0.2, 0.3, 0.4, 0.9]);
    assert.ok(r.out); assert.deepEqual(r.used, [0.5, 0.1, 0.2, 0.3, 0.4]);
    // IV melhor (política all): bola PRIMEIRO, depois o sorteio da duplicata (a ordem antiga)
    g = hunt(); own(g.game, 16, 5); r = once(g.game, wild(16, false, 25), [0.5, 0.9, 0.1, 0.2, 0.3, 0.4]);
    assert.ok(r.out, 'captura (a atualização de IV vale)'); assert.deepEqual(r.used, [0.5, 0.9], 'bola, depois o sorteio da duplicata (recusado)'); assert.equal(r.balls, 9);
    assert.equal(g.game.gameState.caughtPokemon[16].ivs.hp, 25, 'IV atualizado');
    g = hunt(); own(g.game, 16, 5); r = once(g.game, wild(16, false, 25), [0.5, 0.01, 0.1, 0.2, 0.3, 0.4]);
    assert.deepEqual(r.used, [0.5, 0.01, 0.1, 0.2, 0.3, 0.4], 'IV melhor + dado aprovado: bola, dado, 4 traços');
    // better aceita (IV total maior): sem sorteio de duplicata
    g = hunt(); policy(g.game, 'better'); own(g.game, 16, 5); r = once(g.game, wild(16, false, 25), [0.5, 0.1, 0.2, 0.3, 0.4]);
    assert.ok(r.out); assert.deepEqual(r.used, [0.5, 0.1, 0.2, 0.3, 0.4], 'bola + 4 traços');
    // better/off rejeitada sem ganho: nem bola nem sorteio (F9.7)
    for (const p of ['better', 'off']) { g = hunt(); policy(g.game, p); own(g.game, 16, 25); r = once(g.game, wild(16, false, 5), [0.5]); assert.equal(r.out, null); assert.deepEqual(r.used, []); assert.equal(r.balls, 10); }
});

test('F9.9 A: com a flag das bolas desligada o sorteio da duplicata fica onde estava (dentro de _applyCapture, sem bola)', () => {
    const { game, ctx } = hunt();
    vm.runInContext('BALL_CAPTURE_ENABLED = false', ctx.sandbox);
    own(game, 16, 25);
    const r = once(game, wild(16, false, 5), [0.01, 0.1, 0.2, 0.3, 0.4]);
    assert.ok(r.out); assert.deepEqual(r.used, [0.01, 0.1, 0.2, 0.3, 0.4], 'dado + 4 traços (sem sorteio de bola)'); assert.equal(r.balls, 10, 'sem bolas: nada consumido');
    const r2 = once(game, wild(16, false, 5), [0.9]);
    assert.equal(r2.out.uid, null, 'sem indivíduo novo (o resultado de _applyCapture só atualiza IVs)'); assert.deepEqual(r2.used, [0.9]);
});

test('F9.9 A: um sorteio de duplicata por candidata, sempre antes de qualquer consumo de bola (400 candidatas, ordem verificada uma a uma)', () => {
    const { game } = hunt(); own(game, 16, 25);
    const inv = game.ensureInventory(); inv.balls = { pokeball: 99, greatball: 99, ultraball: 99 };
    const base = mulberry32(21); let declined = 0, accepted = 0;
    for (let i = 0; i < 400; i++) {
        game.rng = base;
        const trace = []; const rng0 = game.rng; game.rng = () => { trace.push('rng'); return rng0(); };
        const cb = game.consumeBall.bind(game); game.consumeBall = (id, n) => { trace.push('ball'); return cb(id, n); };
        const w = wild(16, false, 1); const out = game.processDefeat(w);
        game.consumeBall = cb;
        assert.equal(trace[0], 'rng', 'o primeiro RNG é o sorteio da duplicata');
        const bi = trace.indexOf('ball');
        if (bi === -1) { declined++; assert.deepEqual(trace, ['rng']); assert.equal(out, null); }
        else { accepted++; assert.equal(bi, 1, 'a bola só é gasta depois do sorteio da duplicata'); assert.equal(trace.filter(t => t === 'ball').length, 1); assert.equal(typeof w._dupDice, 'boolean'); assert.equal(w._dupDice, true); }
        game.ensureInventory().balls = { pokeball: 99, greatball: 99, ultraball: 99 };
    }
    assert.equal(declined + accepted, 400); assert.ok(declined > 330 && accepted > 5, `≈95% recusadas (${declined}/${accepted})`);
    assert.equal(game.getDuplicatesDeclined(), declined);
});

// =============================================================== B. eventos
test('F9.9 B: duplicatas recusadas pelo sorteio não emitem um evento por tentativa (só um contador agregado)', () => {
    const { game } = hunt(); own(game, 16, 25);
    const seen = { skipped: 0, failed: 0, depleted: 0, captured: 0, attempted: 0 };
    game.bus.on('capture_skipped', () => seen.skipped++); game.bus.on('capture_failed', () => seen.failed++); game.bus.on('balls_depleted', () => seen.depleted++);
    game.bus.on('pokemon_captured', () => seen.captured++); game.bus.on('capture_attempted', () => seen.attempted++);
    game.rng = () => 0.5;                                              // sempre recusa
    for (let i = 0; i < 200; i++) game.processDefeat(wild(16, false, 1));
    assert.equal(game.getDuplicatesDeclined(), 200);
    assert.equal(seen.skipped, 0, 'nenhum capture_skipped por duplicata recusada no sorteio'); assert.equal(seen.failed, 0); assert.equal(seen.depleted, 0); assert.equal(seen.captured, 0);
    assert.equal(seen.attempted, 200, 'capture_attempted segue como antes (um por vitória)');
    assert.equal(game.getBalls().pokeball, 10, 'nenhuma bola gasta');
    // os eventos de política desligada, limite e PC cheio continuam como estão (F9.7)
    const g2 = hunt(); own(g2.game, 16, 25); policy(g2.game, 'off');
    const ev = []; g2.game.bus.on('capture_skipped', (e) => ev.push(e.reason));
    g2.game.processDefeat(wild(16, false, 1)); assert.deepEqual(ev, ['duplicate_policy_off']);
});

// =============================================================== C. resumos do capture-golden
const OLD = {   // árvore cfff232 (F9.8): política de duplicatas off e better (sem sorteio de duplicata) — idênticos antes e depois da F9.9
    'off/online1': '65ccf619f125', 'off/fast1': '12d185366eb6', 'off/online2': '0a202e980dcf', 'off/fast2': '4dfb648d807f', 'off/online3': '614f395b4cf2', 'off/fast3': '7080625cacf4',
    'better/online1': 'dc99b3858135', 'better/fast1': 'fe08affd8707', 'better/online2': '0832c0049347', 'better/fast2': '4bae9a261dd7', 'better/online3': '7f8b1e848b69', 'better/fast3': '589a6b8cb9c4',
};
const BALLS = { pokeball: 12, greatball: 6, ultraball: 3 };
test('F9.9 C: resumos do capture-golden — com a política de duplicatas off ou better (sem sorteio de duplicata) idênticos ao baseline (regeneração só no caminho da duplicata)', () => {
    for (const pol of ['off', 'better']) for (const seed of [1, 2, 3]) for (const [name, run] of [['online', runOnline], ['fast', runFast]]) {
        const d = digest(run(on, { seed, balls: BALLS, setup: (t) => policy(t.game, pol) }));
        assert.equal(d.slice(0, 12), OLD[`${pol}/${name}${seed}`], `${pol}/${name}${seed}`);
    }
});

// =============================================================== D. paridade online × Fast Driver (reexecução no modo oposto)
function recorder(rec) {
    return (t) => {
        const { game } = t; const orig = game.processDefeat.bind(game);
        game.processDefeat = (w) => {
            const vals = []; const r0 = game.rng; game.rng = () => { const v = r0.call(game); vals.push(v); return v; };
            const gold0 = game.gameState.gold, inv0 = plain(game.gameState.inventory), caught0 = plain(game.gameState.caughtPokemon), copy = plain(w);
            const out = orig(w); game.rng = r0;
            rec.push({ w: copy, gold0, inv0, caught0, vals, out: !!out, balls1: plain(game.getBalls()), gold1: game.gameState.gold, declined: game.getDuplicatesDeclined(), catches: game.gameState.stats.totalCatches });
            return out;
        };
    };
}
function replayAll(rec, offline, restock) {
    const { game, ctx } = on({ seed: 1 });
    game.dispatchAutomationAction({ type: 'START_HUNT' }); game.stopBattle();
    if (restock) { vm.runInContext('BALL_RESTOCK_ENABLED = true', ctx.sandbox); game.gameState.account = { benefits: ['autoRestock'] }; }
    if (offline) game._isOfflineSimulating = true;
    const log = [];
    for (const r of rec) {
        game.gameState.gold = r.gold0; game.gameState.inventory = plain(r.inv0);
        for (const id of Object.keys(r.caught0)) if (!game.gameState.caughtPokemon[id]) game.catchPokemonWithIvs(Number(id), 1, r.caught0[id].ivs);
        let i = 0; const c = { n: 0 }; game.rng = () => { c.n++; return r.vals[i++]; };
        const out = game.processDefeat(plain(r.w));
        log.push({ out: !!out, n: c.n, balls1: plain(game.getBalls()), declined: game.getDuplicatesDeclined() });
    }
    return log;
}
test('F9.9 D: online × Fast Driver — 3 sementes × 80 batalhas, com a reposição ligada e desligada; cada processDefeat reexecutado no modo oposto dá o mesmo (resultado, RNG, bolas, contador)', () => {
    for (const restock of [false, true]) for (const seed of [1, 2, 3]) for (const [name, run] of [['online', runOnline], ['fast', runFast]]) {
        const rec = [];
        const t = run(on, { seed, balls: { pokeball: 8 }, setup: (tt) => {
            if (restock) { tt.game.gameState.account = { benefits: ['autoRestock'] }; vm.runInContext('BALL_RESTOCK_ENABLED = true', tt.ctx.sandbox); tt.game.gameState.gold = 400; }
            recorder(rec)(tt);
        } });
        assert.ok(rec.length >= 20, `${name}/${seed}: vitórias (${rec.length})`);
        assert.ok(t.game.getDuplicatesDeclined() > 0, `${name}/${seed}: houve duplicatas recusadas no sorteio`);
        const asIs = rec.map(r => ({ out: r.out, n: r.vals.length, balls1: r.balls1, declined: r.declined }));
        for (const offline of [false, true]) {
            const replay = replayAll(rec, offline, restock);
            assert.deepEqual(replay, asIs, `${name}/${seed}: reexecução ${offline ? 'offline' : 'online'} idêntica (${restock ? 'com' : 'sem'} reposição)`);
        }
    }
});
