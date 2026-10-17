'use strict';
// F9.5: captura com chance e consumo de Poké Bolas. Fórmulas conferidas por modelos independentes, um sorteio por tentativa, consumo exato,
// pacote inicial uma vez por save, paridade online × Fast Driver e a prova de que a flag desligada restaura o baseline.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { newGame, mulberry32, createMemoryStorage } = require('./helpers/game');
const { runOnline, runFast } = require('./helpers/capture-golden');

const plain = (o) => JSON.parse(JSON.stringify(o));
// F9.6: os testes da F9.5 verificam a mecânica de captura SEM reposição (o estoque acaba de verdade); a reposição tem arquivo próprio (ball-restock.test.js)
const on = (opts = {}) => { const g = newGame({ balls: true, ...opts }); vm.runInContext('BALL_RESTOCK_ENABLED = false', g.ctx.sandbox); return g; };
const KEY = 'pokemon_idle_save';

// ---- modelos independentes (não usam as funções do jogo) ----
const bstOf = (d) => Object.values(d.baseStats).reduce((a, b) => a + b, 0);
const modelRate = (d) => { const r = 1 - (bstOf(d) - 300) / 600; return r > 1 ? 1 : r < 0 ? 0 : r; };
const MULT = { pokeball: 1, greatball: 1.5, ultraball: 2 };
const modelChance = (rate, id) => id === 'masterball' ? 1 : Math.max(0.10, Math.min(0.95, rate * MULT[id]));
function modelChoose(inv, shiny) {                 // cheapest of the three; shiny → best of the three; never the Master
    const order = ['pokeball', 'greatball', 'ultraball'].filter(id => (inv[id] || 0) > 0);
    if (!order.length) return null;
    return shiny ? order[order.length - 1] : order[0];
}
const wild = (id, shiny = false) => ({ id, level: 5, isShiny: shiny, ivs: { hp: 1, atk: 1, def: 1, spAtk: 1, spDef: 1, speed: 1 } });
function setBalls(game, balls) { const inv = game.ensureInventory(); inv.ballsGranted = true; if (Object.keys(balls).length) inv.balls = { ...balls }; else delete inv.balls; }
function setFlag(ctx, v) { vm.runInContext(`BALL_CAPTURE_ENABLED = ${v}`, ctx.sandbox); }
function countingRng(value, counter) { return () => { counter.n++; return value; }; }

// =============================================================== A. chance
test('F9.5 A: taxa e chance por espécie × bola batem com a fórmula independente (todas as espécies, todas as bolas)', () => {
    const { ctx } = on();
    const MIN = ctx.CAPTURE_CHANCE_MIN, MAX = ctx.CAPTURE_CHANCE_MAX;
    assert.equal(MIN, 0.10); assert.equal(MAX, 0.95);
    let n = 0, lo = 0, hi = 0;
    for (const id of Object.keys(ctx.POKEMON_DATA)) {
        const d = ctx.POKEMON_DATA[id], rate = ctx.speciesCatchRate(d);
        assert.ok(Math.abs(rate - modelRate(d)) < 1e-12, `taxa #${id}`);
        assert.ok(rate >= 0 && rate <= 1);
        for (const b of ctx.BALL_TYPES) {
            const c = ctx.captureChance(rate, b);
            assert.ok(Math.abs(c - modelChance(rate, b.id)) < 1e-12, `chance #${id} ${b.id}`);
            assert.ok(c >= (b.id === 'masterball' ? 1 : MIN) && c <= (b.id === 'masterball' ? 1 : MAX));
            n++; if (b.id !== 'masterball') { if (c === MIN) lo++; if (c === MAX) hi++; }
        }
    }
    assert.ok(n > 1000 && hi > 0, 'a tabela exercita o teto');
    assert.equal(lo, 0, 'com o BST do dado (taxa mínima 0,2) o piso nunca atua nas bolas comuns; ele existe como salvaguarda e é testado com taxas sintéticas');
    for (const [rate, bi, exp] of [[0.05, 0, 0.10], [0.0, 2, 0.10], [0.04, 1, 0.10], [1, 0, 0.95], [1, 2, 0.95], [0.6, 1, 0.9], [0.3, 2, 0.6]]) assert.ok(Math.abs(ctx.captureChance(rate, ctx.BALL_TYPES[bi]) - exp) < 1e-12, `${rate}/${bi}`);
    assert.equal(ctx.captureChance(0.5, null), 0);
    assert.equal(ctx.speciesCatchRate(null), 0);
    assert.equal(ctx.captureChance(0, ctx.BALL_TYPES[3]), 1, 'Master = 1 mesmo com taxa 0');
    assert.ok(ctx.captureChance(0.4, ctx.BALL_TYPES[2]) > ctx.captureChance(0.4, ctx.BALL_TYPES[1]) && ctx.captureChance(0.4, ctx.BALL_TYPES[1]) > ctx.captureChance(0.4, ctx.BALL_TYPES[0]));
});

// =============================================================== B. escolha de bola
test('F9.5 B: escolha automática — mais barata; shiny usa a melhor; Master nunca; função pura', () => {
    const { ctx } = on();
    const pick = (b, s) => { const r = ctx.chooseBall(b, s); return r ? r.id : null; };
    const invs = [{}, { pokeball: 3 }, { greatball: 2 }, { ultraball: 1 }, { masterball: 5 }, { pokeball: 1, greatball: 1 }, { pokeball: 1, greatball: 1, ultraball: 1 },
        { pokeball: 1, ultraball: 1, masterball: 1 }, { greatball: 1, masterball: 2 }, { pokeball: 99, greatball: 99, ultraball: 99, masterball: 99 }];
    for (const inv of invs) for (const shiny of [false, true]) {
        const frozen = JSON.stringify(inv);
        assert.equal(pick(inv, shiny), modelChoose(inv, shiny), `${frozen} shiny=${shiny}`);
        assert.equal(JSON.stringify(inv), frozen, 'não altera o inventário');
        assert.notEqual(pick(inv, shiny), 'masterball');
    }
    assert.equal(pick({ masterball: 9 }, true), null, 'só Master: sem tentativa');
});

// =============================================================== C. consumo e sorteios
test('F9.5 C: cada tentativa gasta exatamente 1 bola e faz exatamente 1 sorteio; falha não captura', () => {
    for (const [r, label] of [[0, 'sucesso'], [0.999, 'falha']]) {
        const { game, ctx } = on({ seed: 3 });
        setBalls(game, { pokeball: 5, greatball: 4, ultraball: 3 });
        const c = { n: 0 }; game.rng = countingRng(r, c);
        const rate = ctx.speciesCatchRate(ctx.POKEMON_DATA[1]);
        const before = game.getBalls(), caughtBefore = game.gameState.stats.totalCatches;
        const res = game._ballCaptureAttempt(wild(1));
        assert.equal(c.n, 1, `${label}: um sorteio`);
        assert.equal(game.getBallCount('pokeball'), before.pokeball - 1, `${label}: gastou 1 Poké Bola`);
        assert.equal(game.getBallCount('greatball'), 4); assert.equal(game.getBallCount('ultraball'), 3);
        assert.equal(res.ok, r === 0, label);
        assert.equal(game.gameState.stats.totalCatches, caughtBefore, 'a tentativa em si não cria indivíduo');
        assert.ok(Math.abs(res.chance - modelChance(rate, 'pokeball')) < 1e-12);
    }
});

test('F9.5 C: Master Bola também faz 1 sorteio e sempre captura (chance 1) quando é a bola usada', () => {
    const { game, ctx } = on({ seed: 3 });
    setBalls(game, { masterball: 2 });
    const real = vm.runInContext('chooseBall', ctx.sandbox);
    vm.runInContext('chooseBall = (balls) => BALL_TYPES.find(b => b.id === "masterball")', ctx.sandbox);   // força a Master só neste teste
    try {
        const c = { n: 0 }; game.rng = countingRng(0.9999999, c);
        const res = game._ballCaptureAttempt(wild(150));
        assert.equal(c.n, 1); assert.equal(res.ok, true); assert.equal(res.chance, 1);
        assert.equal(game.getBallCount('masterball'), 1);
    } finally { ctx.chooseBall = real; vm.runInContext('chooseBall = __real', Object.assign(ctx.sandbox, { __real: real })); }
});

test('F9.5 C: processDefeat com bola — sucesso cria o indivíduo (+1 sorteio sobre o baseline), falha não mexe em captura nem XP/ouro', () => {
    const run = (flag, rv) => {
        const { game, ctx } = on({ seed: 7 });
        setFlag(ctx, flag);
        const c = { n: 0 }; game.rng = countingRng(rv, c);
        const gs = game.gameState, g0 = gs.gold, st = gs.stats.totalCatches;
        const out = game.processDefeat(wild(16));
        return { n: c.n, out, caught: gs.stats.totalCatches - st, gold: gs.gold - g0, balls: game.getBalls(), game };
    };
    const base = run(false, 0), win = run(true, 0), lose = run(true, 0.9999);
    assert.equal(win.n, base.n + 1, 'um sorteio a mais que o baseline');
    assert.ok(base.caught >= 1 && win.caught === base.caught);
    assert.equal(lose.n, 1, 'falha: só o sorteio da bola (sem traços/IVs)');
    assert.equal(lose.caught, 0);
    assert.equal(lose.gold, base.gold, 'ouro/recompensas não mudam na falha');
    assert.equal(lose.balls.pokeball, 29);
});

test('F9.5 C: sem bolas não há tentativa nem sorteio; o aviso "sem bolas" sai uma vez por episódio', () => {
    const { game } = on({ seed: 7 });
    setBalls(game, {});
    const c = { n: 0 }; game.rng = countingRng(0, c);
    const ev = []; game.bus.on('balls_depleted', (e) => ev.push(e));
    const toasts = []; game.onBattleEvent = (t) => toasts.push(t);
    const caught0 = game.gameState.stats.totalCatches;
    for (let i = 0; i < 25; i++) assert.equal(game.processDefeat(wild(16)), null);
    assert.equal(c.n, 0, 'nenhum sorteio sem tentativa');
    assert.equal(game.gameState.stats.totalCatches, caught0);
    assert.equal(ev.length, 1, 'uma vez por episódio');
    assert.equal(toasts.filter(t => t === 'ballsDepleted').length, 1);
    game.addBalls('pokeball', 1);                                    // volta a haver bola → novo episódio possível
    assert.ok(game.processDefeat(wild(16)));
    assert.equal(game.getBallCount('pokeball'), 0);
    for (let i = 0; i < 5; i++) game.processDefeat(wild(16));
    assert.equal(ev.length, 2, 'segundo episódio avisa de novo, uma vez');
});

test('F9.5 C: política que não capturaria não gasta bola nem sorteio', () => {
    const { game } = on({ seed: 7 });
    const pol = game.getAutomationPolicy(); pol.capture = { ...pol.capture, minQualityPercent: 100, alwaysNewSpecies: false, alwaysShiny: false };
    game.setAutomationPolicy(pol);
    game.catchPokemonWithIvs(16, 1, { hp: 0, atk: 0, def: 0, spAtk: 0, spDef: 0, speed: 0 });
    const c = { n: 0 }; game.rng = countingRng(0, c);
    const b0 = JSON.stringify(game.getBalls());
    const evs = []; game.bus.on('capture_failed', e => evs.push(e)); game.bus.on('balls_depleted', e => evs.push(e));
    game.dispatchAutomationAction({ type: 'START_HUNT' }); game.stopBattle();
    c.n = 0;
    const out = game.processDefeat(wild(16));
    if (out === null) { assert.equal(c.n, 0); assert.equal(JSON.stringify(game.getBalls()), b0); assert.equal(evs.length, 0); }
});

// =============================================================== D. flag desligada
test('F9.5 D: flag desligada — inventário sem pacote nem marca, captura sem bola e sem sorteio extra', () => {
    const { game } = newGame({ seed: 7 });                                  // helper liga BALL_CAPTURE_ENABLED=false por padrão
    assert.equal(JSON.stringify(game.gameState.inventory), JSON.stringify({ potions: 10 }));
    assert.equal(game.getTotalBalls(), 0);
    const c = { n: 0 }; const base = game.rng; game.rng = () => { c.n++; return base(); };
    const out = game.processDefeat(wild(16));
    assert.ok(out && game.gameState.stats.totalCatches >= 1, 'captura garantida como antes');
    assert.equal(game.gameState.inventory.balls, undefined); assert.equal(game.gameState.inventory.ballsGranted, undefined);
});

// =============================================================== E. pacote inicial e saves
test('F9.5 E: pacote inicial — 30 Poké Bolas num jogo novo, uma vez só (mesmo com o inventário zerado, mesmo depois de salvar e recarregar)', () => {
    const a = on({ seed: 4 });
    assert.deepEqual(plain(a.game.getBalls()), { pokeball: 30 });
    assert.equal(a.game.gameState.inventory.ballsGranted, true);
    assert.equal(a.ctx.SAVE_SCHEMA_VERSION, 3);
    for (let i = 0; i < 30; i++) a.game.consumeBall('pokeball', 1);
    assert.deepEqual(plain(a.game.getBalls()), {});
    a.game.saveNow();
    const b = on({ seed: 4, load: true, storage: a.storage });
    assert.deepEqual(plain(b.game.getBalls()), {}, 'zerado + recarregado: não volta');
    assert.equal(b.game.gameState.inventory.ballsGranted, true);
    b.game.saveNow();
    const c = on({ seed: 4, load: true, storage: b.storage });
    assert.deepEqual(plain(c.game.getBalls()), {});
    assert.equal(c.ctx.SaveCodec.decodePayload(c.storage.getItem(KEY)).schemaVersion, 3);
});

test('F9.5 E: saves antigos sem a marca (v1, v2, v3) ganham o pacote ao carregar, uma única vez', () => {
    const FIX = path.join(__dirname, 'fixtures');
    for (const f of ['legacy-localstorage.txt', 'legacy-v2-localstorage.txt']) {
        const storage = createMemoryStorage({ pokemon_idle_save: fs.readFileSync(path.join(FIX, f), 'utf8') });
        const g = on({ storage, load: true });
        assert.equal(g.game.loadReport.ok, true, f);
        assert.deepEqual(plain(g.game.getBalls()), { pokeball: 30 }, f);
        g.game.saveNow();
        const g2 = on({ storage, load: true });
        assert.deepEqual(plain(g2.game.getBalls()), { pokeball: 30 }, `${f}: segunda carga não soma`);
    }
    const a = newGame({ seed: 4 }); a.game.saveNow();                       // v3 salvo SEM a marca (flag desligada)
    const raw = a.ctx.SaveCodec.decodePayload(a.storage.getItem(KEY));
    assert.equal(raw.schemaVersion, 3); assert.equal(raw.inventory.ballsGranted, undefined);
    const b = on({ seed: 4, load: true, storage: a.storage });
    assert.deepEqual(plain(b.game.getBalls()), { pokeball: 30 });
});

test('F9.5 E: save com bolas existentes e sem marca recebe o pacote respeitando o limite de 99; marca inválida é ignorada', () => {
    const a = newGame({ seed: 4 }); a.game.saveNow();
    const rewrite = (mut) => { const raw = a.ctx.SaveCodec.decodePayload(a.storage.getItem(KEY)); mut(raw); a.storage.setItem(KEY, a.ctx.SaveCodec.encodePayload(JSON.stringify(raw))); return on({ seed: 9, load: true, storage: a.storage }); };
    assert.deepEqual(plain(rewrite(r => { r.inventory.balls = { pokeball: 90, greatball: 5 }; }).game.getBalls()), { pokeball: 99, greatball: 5 });
    for (const bad of ['true', 1, 'yes', {}, [], null]) {
        const g = rewrite(r => { r.inventory.ballsGranted = bad; r.inventory.balls = { greatball: 1 }; });
        assert.equal(g.game.getBallCount('pokeball'), 30, `marca ${JSON.stringify(bad)} não vale`);
    }
    const kept = rewrite(r => { r.inventory.ballsGranted = true; delete r.inventory.balls; });
    assert.deepEqual(plain(kept.game.getBalls()), {}, 'marca verdadeira: nunca de novo');
});

// =============================================================== F. paridade online × Fast Driver
function instrument(rec) {
    return (t) => {
        const { game, log } = t;
        const orig = game._ballCaptureAttempt.bind(game);
        game._ballCaptureAttempt = (w) => {
            const n0 = log.rng.length, inv0 = plain(game.getBalls());
            const r = orig(w);
            if (r.reason === 'no_balls') { rec.noBalls = (rec.noBalls || 0) + 1; return r; }
            rec.push({ id: w.id, shiny: !!w.isShiny, calls: log.rng.length - n0, inv0, inv1: plain(game.getBalls()), r, value: log.rng[n0] });
            return r;
        };
        game.bus.on('balls_depleted', (e) => rec.depleted = (rec.depleted || 0) + 1);
        game.bus.on('capture_failed', (e) => rec.failed = (rec.failed || 0) + 1);
    };
}

test('F9.5 F: online e Fast Driver — mesmas funções, 1 sorteio por tentativa, consumo e escolha iguais ao modelo (3 sementes × 80 batalhas, estoque acaba)', () => {
    const totals = { online: { succ: 0, fail: 0 }, fast: { succ: 0, fail: 0 } };
    for (const seed of [1, 2, 3]) for (const [name, run] of [['online', runOnline], ['fast', runFast]]) {
        const rec = []; rec.depleted = 0; rec.failed = 0;
        const t = run(on, { seed, balls: { pokeball: 12, greatball: 6, ultraball: 3 }, setup: instrument(rec) });
        const ctx = t.ctx;
        assert.ok(rec.length >= 15, `${name}/${seed}: tentativas suficientes (${rec.length})`);
        let succ = 0, fail = 0;
        for (const a of rec) {
            const expected = modelChoose(a.inv0, a.shiny);
            assert.ok(expected, 'só há tentativa quando existe bola');
            assert.equal(a.calls, 1, `${name}/${seed}: exatamente 1 sorteio por tentativa`);
            const used = Object.keys(a.inv0).filter(k => (a.inv1[k] || 0) !== a.inv0[k]);
            assert.deepEqual(used, [expected], 'bola escolhida = modelo');
            assert.equal(a.inv0[expected] - (a.inv1[expected] || 0), 1, 'gastou exatamente 1');
            const chance = modelChance(modelRate(ctx.POKEMON_DATA[a.id]), expected);
            assert.equal(a.r.ok, a.value < chance, 'resultado = sorteio < chance (modelo)');
            a.r.ok ? succ++ : fail++;
        }
        totals[name].succ += succ; totals[name].fail += fail;
        assert.equal(rec.failed, fail, 'um evento capture_failed por falha');
        assert.ok(rec.depleted >= 1, `${name}/${seed}: o estoque acabou e avisou`);
        assert.ok(rec.depleted <= 3, 'sem enchente de avisos');
        assert.equal(t.game.getTotalBalls(), 0);
    }
    for (const name of ['online', 'fast']) assert.ok(totals[name].succ > 20 && totals[name].fail > 0, `${name}: sucessos e falhas nas 3 sementes ${JSON.stringify(totals[name])}`);
});

test('F9.5 F: nenhuma lógica paralela — toda tentativa, online ou no Fast Driver, passa por processDefeat → _ballCaptureAttempt', () => {
    for (const [name, run] of [['online', runOnline], ['fast', runFast]]) {
        let defeats = 0, attempts = 0;
        const t = run(on, { seed: 5, balls: { pokeball: 40 }, setup: ({ game }) => {
            const pd = game.processDefeat.bind(game), at = game._ballCaptureAttempt.bind(game);
            game.processDefeat = (w, ...r) => { defeats++; return pd(w, ...r); };
            game._ballCaptureAttempt = (w) => { const r = at(w); if (r.reason !== 'no_balls') attempts++; return r; };
        } });
        assert.ok(defeats > 0 && attempts > 0 && attempts <= defeats, `${name}: ${attempts} tentativas em ${defeats} vitórias`);
        assert.equal(40 - t.game.getBallCount('pokeball'), attempts, `${name}: bolas gastas = tentativas`);
    }
});

// =============================================================== G. frequência
test('F9.5 G: amostra grande — a frequência de captura por bola fica perto da teórica (4 desvios)', () => {
    const { game, ctx } = on({ seed: 1 });
    const id = Object.keys(ctx.POKEMON_DATA).map(Number).find(i => { const r = modelRate(ctx.POKEMON_DATA[i]); return r > 0.45 && r < 0.6; });
    assert.ok(id, 'espécie de taxa intermediária');
    const rate = modelRate(ctx.POKEMON_DATA[id]);
    game.rng = mulberry32(2024);
    const N = 20000;
    for (const ball of ['pokeball', 'greatball', 'ultraball']) {
        let ok = 0;
        for (let i = 0; i < N; i++) {
            setBalls(game, { [ball]: 1 });
            if (game._ballCaptureAttempt(wild(id)).ok) ok++;
        }
        const p = modelChance(rate, ball), sd = Math.sqrt(p * (1 - p) / N);
        assert.ok(Math.abs(ok / N - p) < 4 * sd, `${ball}: ${(ok / N).toFixed(4)} vs ${p.toFixed(4)}`);
    }
});

// =============================================================== H. interface
test('F9.5 H: contador na barra de recursos, aviso sem bolas e linhas do registro de atividade', () => {
    const { makeFakeDom, makeUi } = require('./helpers/fake-dom');
    const g = on({ seed: 3 });
    const dom = makeFakeDom(g.ctx), ui = makeUi(g.game), view = new g.ctx.HuntView(ui);
    view.render();
    assert.match(dom.html('hunt-resources'), /data-eco-balls[^>]*>30</, 'contador com o pacote inicial');
    assert.match(dom.html('hunt-resources'), /class="hunt-res" data-eco-balls-wrap/, 'sem a marca de vazio');
    const warn = () => /<div class="hunt-warn" data-hunt-noballs[^>]*>/.exec(dom.html('hunt-status') || dom.html('hunt-root') || '');
    const w0 = warn();
    if (w0) assert.match(w0[0], /\bhidden\b/, 'com bolas o aviso está oculto');
    setBalls(g.game, {});
    view.render();
    assert.match(dom.html('hunt-resources'), /hunt-res empty/, 'sem bolas: contador marcado como vazio');
    assert.match(dom.html('hunt-resources'), /data-eco-balls[^>]*>0</);
    const l1 = view._activityLine({ type: 'capture_failed', id: 16, ball: 'pokeball', chance: 0.95 });
    const l2 = view._activityLine({ type: 'balls_depleted', id: 16 });
    assert.match(l1, /escapou da Poké Bola \(95%\)/); assert.match(l2, /Sem bolas/);
});
