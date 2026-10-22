'use strict';
// F9.6: reposição automática de Poké Bolas e captura que poupa bola (capture.skipOwnedSpecies).
// Modelos independentes para o plano de compra, atomicidade, ausência de RNG, avisos sem enchente, saves e paridade online × Fast Driver.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { newGame, mulberry32, createMemoryStorage } = require('./helpers/game');
const { runOnline, runFast, digest } = require('./helpers/capture-golden');

const plain = (o) => JSON.parse(JSON.stringify(o));
const KEY = 'pokemon_idle_save';
const RES = 40;                                                                  // F9.7: reserva de ouro padrão (era 100)
// captura com bola ligada; reposição ligada; F9.7: a reposição é um benefício VIP, então estes testes ativam o benefício autoRestock (o bloqueio tem arquivo próprio)
const on = (opts = {}) => { const g = newGame({ balls: true, ...opts }); g.game.gameState.account = { benefits: ['autoRestock'] }; return g; };
const offRestock = (g) => { vm.runInContext('BALL_RESTOCK_ENABLED = false', g.ctx.sandbox); return g; };
const wild = (id, shiny = false) => ({ id, level: 5, isShiny: shiny, ivs: { hp: 1, atk: 1, def: 1, spAtk: 1, spDef: 1, speed: 1 } });
function setBalls(game, balls) { const inv = game.ensureInventory(); inv.ballsGranted = true; if (Object.keys(balls).length) inv.balls = { ...balls }; else delete inv.balls; }
function setGold(game, v) { game.gameState.gold = v; }
function setRestock(game, patch) { const p = plain(game.getAutomationPolicy()); Object.assign(p.ballPolicy.restock, patch); const r = game.setAutomationPolicy(p); assert.equal(r.ok, true, JSON.stringify(r.errors)); }
function setCapture(game, patch) { const p = plain(game.getAutomationPolicy()); Object.assign(p.capture, patch); const r = game.setAutomationPolicy(p); assert.equal(r.ok, true, JSON.stringify(r.errors)); }
function startHunt(game) { game.dispatchAutomationAction({ type: 'START_HUNT' }); game.stopBattle(); }
const ballSpent = (game) => ((game.gameState.economy && game.gameState.economy.byReason.ball_purchase) || { spent: 0 }).spent;
const unitPrice = (game) => game.getShopItems().find(i => i.id === 'pokeball').price;
const snap = (game) => JSON.stringify({ gold: game.gameState.gold, inv: game.gameState.inventory, eco: game.gameState.economy, totalGold: game.gameState.stats.totalGold });

// modelo independente do plano (não usa planRestock)
function modelPlan(stock, price, gold, cfg) {
    if (stock >= cfg.minStock) return 0;
    const room = 99 - stock; if (room <= 0) return 0;
    let qty = 0;
    for (let q = 1; q <= Math.min(cfg.targetStock - stock, room); q++) if (gold - q * price >= cfg.goldReserve) qty = q; else break;
    return qty;
}

// =============================================================== A. plano puro
test('F9.6 A: planRestock bate com o modelo independente (varredura de estoque, ouro, preço, mínimo, alvo e reserva)', () => {
    const { ctx } = on();
    let n = 0, bought = 0;
    for (const price of [1, 2, 7]) for (const reserve of [0, 100]) for (const [min, target] of [[1, 1], [5, 30], [5, 99], [30, 99], [99, 99]])
        for (const stock of [0, 1, 4, 5, 29, 30, 94, 98, 99]) for (const gold of [0, 1, 99, 100, 101, 105, 160, 1000, 5000]) {
            const cfg = { minStock: min, targetStock: target, goldReserve: reserve };
            const p = ctx.planRestock(stock, price, gold, cfg);
            const m = modelPlan(stock, price, gold, cfg);
            assert.equal(p.qty, m, `stock=${stock} price=${price} gold=${gold} cfg=${JSON.stringify(cfg)}`);
            if (p.qty > 0) { bought++; assert.equal(p.total, p.qty * price); assert.ok(gold - p.total >= reserve && stock + p.qty <= Math.min(99, Math.max(target, stock))); }
            else assert.ok(['not_needed', 'no_gold'].includes(p.reason));
            n++;
        }
    assert.ok(n > 2000 && bought > 200);
    assert.equal(ctx.planRestock(3, 1, 0, { minStock: 5, targetStock: 30, goldReserve: 100 }).reason, 'no_gold');
    assert.equal(ctx.planRestock(99, 1, 9999, { minStock: 99, targetStock: 99, goldReserve: 0 }).reason, 'not_needed', 'com 99 (limite) nunca falta espaço: mínimo ≤ 99');
    assert.equal(ctx.planRestock(5, 1, 9999, { minStock: 5, targetStock: 30, goldReserve: 100 }).reason, 'not_needed');
});

// =============================================================== B. reposição pelo jogo
test('F9.6 B: dispara só abaixo do mínimo e leva exatamente ao alvo, debitando só o preço × quantidade (ledger "ball_purchase")', () => {
    const { game } = on({ seed: 2 });
    setBalls(game, { pokeball: 5 }); setGold(game, 1000);
    const price = unitPrice(game);
    assert.equal(game._restockBalls(), null, 'estoque igual ao mínimo: não compra');
    assert.equal(game.getBallCount('pokeball'), 5); assert.equal(game.getMoney(), 1000);
    setBalls(game, { pokeball: 4 });
    const spent0 = ballSpent(game);
    const r = game._restockBalls();
    assert.deepEqual(plain(r), { qty: 26, total: 26 * price });
    assert.equal(game.getBallCount('pokeball'), 30);
    assert.equal(game.getMoney(), 1000 - 26 * price);
    assert.equal(ballSpent(game) - spent0, 26 * price);
    assert.equal(game._restockBalls(), null, 'já no alvo: nada a fazer');
});

test('F9.6 B: respeita a reserva de ouro, compra parcial correta e nunca passa do limite de 99', () => {
    const { game } = on({ seed: 2 });
    const price = unitPrice(game);
    setBalls(game, { pokeball: 0 }); setBalls(game, {});
    setGold(game, RES + 10 * price);                                   // ouro acima da reserva paga só 10 bolas
    assert.equal(game._restockBalls().qty, 10);
    assert.equal(game.getMoney(), RES); assert.equal(game.getBallCount('pokeball'), 10);
    setBalls(game, { pokeball: 1 }); setGold(game, RES + price - 1);   // falta 1 de ouro para uma bola
    assert.equal(game._restockBalls(), null);
    assert.equal(game.getBallCount('pokeball'), 1); assert.equal(game.getMoney(), RES + price - 1);
    setRestock(game, { minStock: 99, targetStock: 99 });
    setBalls(game, { pokeball: 90 }); setGold(game, 1_000_000);
    assert.equal(game._restockBalls().qty, 9); assert.equal(game.getBallCount('pokeball'), 99);
    setBalls(game, { pokeball: 99 }); assert.equal(game._restockBalls(), null);
    setRestock(game, { minStock: 5, targetStock: 30, goldReserve: 0 });
    setBalls(game, {}); setGold(game, 3 * price);
    assert.equal(game._restockBalls().qty, 3); assert.equal(game.getMoney(), 0, 'reserva 0 permite gastar tudo, nunca negativo');
});

test('F9.6 B: varredura aleatória — nunca ouro abaixo da reserva nem estoque acima do limite; ledger fecha', () => {
    const rnd = mulberry32(5);
    for (let i = 0; i < 300; i++) {
        const { game } = on({ seed: 2 });
        const reserve = Math.floor(rnd() * 300), min = 1 + Math.floor(rnd() * 30), target = min + Math.floor(rnd() * (99 - min + 1));
        setRestock(game, { goldReserve: reserve, minStock: min, targetStock: target });
        const stock = Math.floor(rnd() * 100), gold = Math.floor(rnd() * 800);
        setBalls(game, stock ? { pokeball: stock } : {}); setGold(game, gold);
        const spentBefore = ballSpent(game);
        const r = game._restockBalls();
        const now = game.getBallCount('pokeball');
        assert.ok(now <= 99 && now >= stock);
        if (r) { assert.ok(game.getMoney() >= reserve, `reserva ${reserve} ouro ${game.getMoney()}`); assert.equal(gold - game.getMoney(), r.total); assert.equal(now - stock, r.qty); }
        else { assert.equal(game.getMoney(), gold); assert.equal(now, stock); }
        const spent = ballSpent(game) - spentBefore;
        assert.equal(spent, r ? r.total : 0);
    }
});

test('F9.6 B: atômica — compra recusada deixa dinheiro, inventário, ledger e estatísticas idênticos', () => {
    const { game } = on({ seed: 2 });
    setBalls(game, { pokeball: 2 }); setGold(game, RES);              // ouro igual à reserva
    game.getProgressLevel();                                           // aquece o cache derivado economy.progressLevel (escrito na 1ª consulta de preço, com ou sem compra)
    const before = snap(game);
    assert.equal(game._restockBalls(), null);
    assert.equal(snap(game), before, 'sem ouro acima da reserva');
    setRestock(game, { goldReserve: 0 }); setBalls(game, { pokeball: 99 }); setGold(game, 50);
    const b2 = snap(game); game._restockBalls(); assert.equal(snap(game), b2, 'estoque cheio');
    // falha do portão de dinheiro: spendMoney recusa → nenhuma bola entra
    setBalls(game, { pokeball: 1 }); setGold(game, 500);
    const real = game.spendMoney.bind(game); game.spendMoney = () => ({ ok: false, code: 'insufficient_funds' });
    const b3 = snap(game); assert.equal(game._restockBalls(), null); assert.equal(snap(game), b3, 'gasto recusado: bolas não entram');
    game.spendMoney = real;
});

// =============================================================== C. sem RNG
test('F9.6 C: a reposição não consome sorteio; o resto da tentativa é igual ao de um jogo que já tinha as bolas', () => {
    const attempt = (setup) => {
        const { game } = on({ seed: 4 });
        setup(game);
        const c = { n: 0 }, base = mulberry32(77); game.rng = () => { c.n++; return base(); };
        const out = game.processDefeat(wild(16));
        return { n: c.n, ok: !!out, balls: plain(game.getBalls()), catches: game.gameState.stats.totalCatches };
    };
    const price = (() => unitPrice(on({ seed: 4 }).game))();
    const viaRestock = attempt((g) => { setBalls(g, { pokeball: 2 }); setGold(g, RES + 28 * price); });
    const alreadyHad = attempt((g) => { setBalls(g, { pokeball: 30 }); setGold(g, RES); });
    assert.deepEqual(viaRestock, alreadyHad, 'mesmo número de sorteios e mesmo resultado');
    const { game } = on({ seed: 4 }); setBalls(game, { pokeball: 1 }); setGold(game, 5000);
    const c = { n: 0 }; game.rng = () => { c.n++; return 0.5; };
    game._restockBalls(); assert.equal(c.n, 0, 'comprar bolas não sorteia');
});

// =============================================================== D. desligada = baseline da F9.5
// F9.9: resumos REGENERADOS DE PROPÓSITO (o sorteio de 5% da duplicata passou a vir antes da bola; só o caminho de duplicata na política padrão muda: com a política
// de duplicatas off ou "better" os resumos antigos continuam idênticos — provado em tests/duplicate-first.test.js). Resumos antigos (eb17ca5 == cfff232):
//   online1 4698e071…  fast1 fb9550c7…  online2 83c11d7b…  fast2 7cc36e56…  online3 1f2e53c5…  fast3 27eac00b…
const GOLDEN = {   // cenário capture-golden com bolas { pokeball: 12, greatball: 6, ultraball: 3 }, reposição desligada
    online1: 'c25c99afeb8c9fe544d245a74d4b87a67c3c5248', fast1: 'c1ed15e99fb60b6b73757dbc7cff3518c6e78b85',
    online2: '29d6f5bb05d316463a7eb1b141d173b9f1f7d7e6', fast2: 'f257c5cf6f713ef6d7b13d1191a06e7b83d9c82b',
    online3: 'ae8c84b5629edf806929a797e25a7eada705d26d', fast3: '3b63cd6946292ebf4a25d49113b93de31ad2c651',
};
const BALLS = { pokeball: 12, greatball: 6, ultraball: 3 };

test('F9.6 D: reposição desligada (flag global OU configuração do jogador) — resumos idênticos ao baseline (regenerado na F9.9), online e Fast Driver', () => {
    for (const seed of [1, 2, 3]) {
        for (const [label, mode] of [['flag global', (t) => vm.runInContext('BALL_RESTOCK_ENABLED = false', t.ctx.sandbox)], ['configuração do jogador', (t) => setRestock(t.game, { enabled: false })]]) {
            const hook = { setup: mode };
            assert.equal(digest(runOnline(on, { seed, balls: BALLS, ...hook })), GOLDEN['online' + seed], `online ${seed} (${label})`);
            assert.equal(digest(runFast(on, { seed, balls: BALLS, ...hook })), GOLDEN['fast' + seed], `Fast Driver ${seed} (${label})`);
        }
    }
});

// =============================================================== E. paridade online × offline com reposição ligada
// Cada execução grava, a cada chamada de processDefeat: wild (cópia), o ouro de entrada, os valores de RNG consumidos e o resultado. A mesma sequência é
// reexecutada num jogo novo no modo OPOSTO (online ↔ offline) e tudo tem de coincidir: resultados, capturas, inventário, ouro, livro-caixa, RNG e contagem.
function recorder(rec) {
    return (t) => {
        const { game } = t; const orig = game.processDefeat.bind(game);
        const base = game.rng;
        game.processDefeat = (w) => {
            const vals = []; const r0 = game.rng; game.rng = () => { const v = r0.call(game); vals.push(v); return v; };
            const gold0 = game.gameState.gold, inv0 = plain(game.gameState.inventory), copy = plain(w);
            const out = orig(w); game.rng = r0;
            rec.push({ w: copy, gold0, inv0, vals, out: !!out, gold1: game.gameState.gold, balls1: plain(game.getBalls()), spent: ballSpent(game), catches: game.gameState.stats.totalCatches });
            return out;
        };
    };
}
function replayAll(rec, offline, policyPatch) {
    const { game, ctx } = on({ seed: 1 });
    if (policyPatch) policyPatch(game);
    if (offline) game._isOfflineSimulating = true;
    const log = [];
    for (const r of rec) {
        game.gameState.gold = r.gold0; game.gameState.inventory = plain(r.inv0);
        let i = 0; const c = { n: 0 }; game.rng = () => { c.n++; return r.vals[i++]; };
        const w = plain(r.w); const out = game.processDefeat(w);
        log.push({ out: !!out, n: c.n, used: i, gold1: game.gameState.gold, balls1: plain(game.getBalls()), spent: ballSpent(game) });
    }
    return log;
}

test('F9.6 E: online × Fast Driver com reposição ligada — 3 sementes × 80 batalhas, ouro que acaba no meio; mesma função, mesmos resultados', () => {
    for (const seed of [1, 2, 3]) for (const [name, run] of [['online', runOnline], ['fast', runFast]]) {
        const rec = [], events = { restocked: 0, failed: 0, restockedQty: 0, restockedTotal: 0 };
        const t = run(on, { seed, balls: { pokeball: 6 }, setup: (tt) => {
            tt.game.getPricingLevel = () => 1500; tt.game.getBallPricingLevel = () => 1500;      // rota fraca com nível alto: bola cara (~9) para ganhos de ~3 por vitória → o ouro acaba (F9.9: o preço da bola tem a sua própria função de nível)
            setGold(tt.game, 160); setRestock(tt.game, { minStock: 5, targetStock: 12, goldReserve: 100 });
            recorder(rec)(tt);
            tt.game.bus.on('balls_restocked', (e) => { events.restocked++; events.restockedQty += e.qty; events.restockedTotal += e.total; });
            tt.game.bus.on('balls_restock_failed', () => events.failed++);
        } });
        assert.ok(rec.length >= 20, `${name}/${seed}: vitórias (${rec.length})`);
        assert.ok(events.restocked >= 1, `${name}/${seed}: houve reposição`);
        assert.ok(events.failed >= 1, `${name}/${seed}: o ouro acabou e a reposição parou`);
        assert.ok(events.failed <= 3, `${name}/${seed}: avisos sem enchente (${events.failed})`);
        assert.equal(events.restockedTotal, ballSpent(t.game), 'ledger = soma das reposições');
        assert.ok(t.game.getMoney() >= 0);
        const asIs = rec.map(r => ({ out: r.out, n: r.vals.length, used: r.vals.length, gold1: r.gold1, balls1: r.balls1, spent: r.spent }));
        for (const offline of [false, true]) {
            const replay = replayAll(rec, offline, (g) => { g.getPricingLevel = () => 1500; g.getBallPricingLevel = () => 1500; setRestock(g, { minStock: 5, targetStock: 12, goldReserve: 100 }); });
            assert.deepEqual(replay, asIs, `${name}/${seed}: reexecução ${offline ? 'offline' : 'online'} idêntica (resultado, RNG, inventário, ouro, livro-caixa)`);
        }
        assert.ok(rec.every(r => r.gold1 >= 0), 'nunca ouro negativo');
        for (const r of rec) assert.ok(Object.values(r.balls1).every(v => v <= 99));
    }
});

// =============================================================== F. skipOwnedSpecies
function huntGame(seed = 6) { const g = on({ seed }); offRestock(g); startHunt(g.game); return g; }
test('F9.6 F: skipOwnedSpecies — possuída não gasta bola nem sorteio; nova e shiny sempre tentam (online e offline)', () => {
    for (const offline of [false, true]) {
        const { game } = huntGame();
        setCapture(game, { skipOwnedSpecies: true });
        if (offline) game._isOfflineSimulating = true;
        game.catchPokemonWithIvs(16, 1, { hp: 1, atk: 1, def: 1, spAtk: 1, spDef: 1, speed: 1 });
        const skipped = [], attempted = [];
        game.bus.on('capture_skipped', (e) => skipped.push(e)); game.bus.on('capture_attempted', (e) => attempted.push(e));
        const c = { n: 0 }; game.rng = () => { c.n++; return 0; };
        const b0 = plain(game.getBalls());
        assert.equal(game.processDefeat(wild(16)), null, 'espécie possuída: não captura');
        assert.equal(c.n, 0, 'sem sorteio'); assert.deepEqual(plain(game.getBalls()), b0, 'sem bola gasta');
        assert.equal(skipped.length, 1); assert.equal(skipped[0].reason, 'owned_species');
        assert.ok(game.processDefeat(wild(19)), 'espécie nova tenta e captura'); assert.ok(c.n >= 1);
        assert.equal(game.getBallCount('pokeball'), b0.pokeball - 1);
        const n1 = c.n; assert.ok(game.processDefeat(wild(16, true)), 'shiny sempre tenta, mesmo de espécie possuída');
        assert.ok(c.n > n1); assert.equal(game.getBallCount('pokeball'), b0.pokeball - 2);
    }
});

test('F9.6 F: shiny de espécie possuída tenta mesmo com "Capturar Shiny sempre" desligado (a regra de poupar não o barra)', () => {
    const { game } = huntGame();
    setCapture(game, { skipOwnedSpecies: true, alwaysShiny: false });
    game.catchPokemonWithIvs(16, 1, { hp: 1, atk: 1, def: 1, spAtk: 1, spDef: 1, speed: 1 });
    const attempted = []; game.bus.on('capture_attempted', (e) => attempted.push(e));
    const c = { n: 0 }; game.rng = () => { c.n++; return 0; };
    const b0 = game.getBallCount('pokeball');
    assert.ok(game.processDefeat(wild(16, true)));
    assert.equal(attempted[0].decision, true); assert.notEqual(attempted[0].reason, 'owned_species');
    assert.equal(game.getBallCount('pokeball'), b0 - 1); assert.ok(c.n >= 1);
    assert.equal(game.processDefeat(wild(16, false)), null, 'a mesma espécie sem shiny continua pulada');
});

test('F9.6 F: skipOwnedSpecies desligado (padrão) mantém o comportamento da F9.5; e é determinístico: mesma sequência de RNG online e offline', () => {
    assert.equal(on({ seed: 1 }).game.getAutomationPolicy().capture.skipOwnedSpecies, false);
    const seqs = [];
    for (const offline of [false, true]) {
        const { game } = huntGame(8);
        setCapture(game, { skipOwnedSpecies: true });
        if (offline) game._isOfflineSimulating = true;
        const vals = []; const base = mulberry32(31); game.rng = () => { const v = base(); vals.push(v); return v; };
        const res = [];
        for (let i = 0; i < 60; i++) res.push(!!game.processDefeat(wild([16, 19, 21, 16, 19][i % 5], i % 11 === 0)));
        seqs.push(JSON.stringify({ res, vals, balls: game.getBalls(), caught: Object.keys(game.gameState.caughtPokemon) }));
    }
    assert.equal(seqs[0], seqs[1]);
    const off = (() => { const { game } = huntGame(8); const vals = []; const base = mulberry32(31); game.rng = () => { const v = base(); vals.push(v); return v; };
        for (let i = 0; i < 60; i++) game.processDefeat(wild([16, 19, 21, 16, 19][i % 5], i % 11 === 0)); return vals.length; })();
    assert.ok(JSON.parse(seqs[0]).vals.length < off, 'com a opção ligada há menos sorteios (duplicatas não tentadas)');
});

test('F9.6 F: skipOwnedSpecies nos dois drivers — nenhuma tentativa em espécie já possuída, e as novas e shinies seguem tentando', () => {
    for (const [name, run] of [['online', runOnline], ['fast', runFast]]) {
        const attempts = [], skipped = [];
        run(on, { seed: 2, balls: { pokeball: 60 }, setup: (t) => {
            offRestock(t); setCapture(t.game, { skipOwnedSpecies: true });
            const orig = t.game._ballCaptureAttempt.bind(t.game);
            t.game._ballCaptureAttempt = (w) => { attempts.push({ id: w.id, shiny: !!w.isShiny, owned: !!t.game.gameState.caughtPokemon[w.id] }); return orig(w); };
            t.game.bus.on('capture_skipped', (e) => skipped.push(e.reason));
        } });
        assert.ok(attempts.length > 0 && skipped.includes('owned_species'), `${name}: tentou e pulou`);
        assert.ok(attempts.every(a => !a.owned || a.shiny), `${name}: só tenta espécie possuída se for shiny`);
    }
});

// =============================================================== G. eventos e avisos
test('F9.6 G: um evento por reposição; a falha avisa uma vez por episódio e o aviso some quando a reposição volta', () => {
    const { game } = on({ seed: 3 });
    const price = unitPrice(game);
    const ok = [], bad = [];
    game.bus.on('balls_restocked', (e) => ok.push(e)); game.bus.on('balls_restock_failed', (e) => bad.push(e));
    setBalls(game, {}); setGold(game, RES);                          // sem ouro acima da reserva
    for (let i = 0; i < 30; i++) game._restockBalls();
    assert.equal(bad.length, 1, 'uma falha por episódio'); assert.equal(bad[0].reason, 'no_gold');
    assert.deepEqual(plain(game.getRestockStatus()), { failed: 'no_gold' });
    setGold(game, RES + 40 * price);
    game._restockBalls();
    assert.equal(ok.length, 1, 'um evento por reposição'); assert.equal(ok[0].qty, 30); assert.equal(ok[0].total, 30 * price);
    assert.deepEqual(plain(game.getRestockStatus()), { failed: null }, 'aviso limpo');
    setBalls(game, {}); setGold(game, RES);
    for (let i = 0; i < 10; i++) game._restockBalls();
    assert.equal(bad.length, 2, 'novo episódio, novo (único) aviso');
    setRestock(game, { minStock: 1, targetStock: 1 }); setBalls(game, { pokeball: 99 });
    assert.equal(game._restockBalls(), null); assert.deepEqual(plain(game.getRestockStatus()), { failed: null });
});

// =============================================================== H. configuração e save
test('F9.6 H: padrões e validação da configuração (inválidos voltam ao padrão; mínimo ≤ alvo ≤ 99; reserva ≥ 0; inteiros)', () => {
    const { ctx } = on();
    const d = plain(ctx.defaultAutomationPolicy());
    assert.deepEqual(d.ballPolicy.restock, { enabled: true, minStock: 5, targetStock: 30, goldReserve: RES });
    assert.equal(d.capture.skipOwnedSpecies, false);
    const san = (patch) => plain(ctx.sanitizeAutomationPolicy({ ballPolicy: { type: 'none', restock: patch } })).ballPolicy.restock;
    assert.deepEqual(san({ minStock: 8, targetStock: 50, goldReserve: 0, enabled: false }), { enabled: false, minStock: 8, targetStock: 50, goldReserve: 0 });
    for (const bad of [{ minStock: 0 }, { minStock: 100 }, { minStock: 2.5 }, { minStock: 'x' }, { minStock: -1 }, { targetStock: 0 }, { targetStock: 1000 }, { goldReserve: -1 }, { goldReserve: 1.5 }, { goldReserve: 2e9 }, { enabled: 'sim' }, { foo: 1 }])
        assert.deepEqual(san(bad), d.ballPolicy.restock, JSON.stringify(bad));
    assert.deepEqual(san({ minStock: 40, targetStock: 10 }), d.ballPolicy.restock, 'mínimo > alvo volta aos padrões');
    assert.deepEqual(san({ minStock: 20, targetStock: 20 }), { ...d.ballPolicy.restock, minStock: 20, targetStock: 20 }, 'mínimo = alvo é válido');
    assert.deepEqual(plain(ctx.sanitizeAutomationPolicy({ ballPolicy: { type: 'none', restock: 'x' } })).ballPolicy.restock, d.ballPolicy.restock);
    assert.equal(plain(ctx.sanitizeAutomationPolicy({ capture: { skipOwnedSpecies: 'x' } })).capture.skipOwnedSpecies, false);
    assert.equal(plain(ctx.sanitizeAutomationPolicy({ capture: { skipOwnedSpecies: true } })).capture.skipOwnedSpecies, true);
    const v = ctx.validateAutomationPolicy({ ballPolicy: { type: 'none', restock: { minStock: 40, targetStock: 10 } } });
    assert.equal(v.ok, false); assert.ok(v.errors.some(e => e.code === 'min_above_target'));
});

test('F9.6 H: ida e volta no save; versão do save segue 3; saves sem o campo (v1, v2, v3) carregam com os padrões', () => {
    const a = on({ seed: 4 });
    setRestock(a.game, { enabled: false, minStock: 7, targetStock: 44, goldReserve: 250 }); setCapture(a.game, { skipOwnedSpecies: true });
    a.game.saveNow();
    const b = on({ seed: 4, load: true, storage: a.storage });
    assert.deepEqual(plain(b.game.getAutomationPolicy().ballPolicy.restock), { enabled: false, minStock: 7, targetStock: 44, goldReserve: 250 });
    assert.equal(b.game.getAutomationPolicy().capture.skipOwnedSpecies, true);
    assert.equal(b.ctx.SAVE_SCHEMA_VERSION, 3);
    assert.equal(b.ctx.SaveCodec.decodePayload(a.storage.getItem(KEY)).schemaVersion, 3);
    // adulterado: valores inválidos no save
    const raw = a.ctx.SaveCodec.decodePayload(a.storage.getItem(KEY));
    raw.automation.policy.ballPolicy.restock = { enabled: 'x', minStock: 500, targetStock: -3, goldReserve: 1.5 };
    raw.automation.policy.capture.skipOwnedSpecies = 'talvez';
    a.storage.setItem(KEY, a.ctx.SaveCodec.encodePayload(JSON.stringify(raw)));
    const c = on({ seed: 4, load: true, storage: a.storage });
    assert.equal(c.game.loadReport.ok, true); assert.equal(c.game.loadReport.source, 'main');
    assert.deepEqual(plain(c.game.getAutomationPolicy().ballPolicy.restock), { enabled: true, minStock: 5, targetStock: 30, goldReserve: RES });
    assert.equal(c.game.getAutomationPolicy().capture.skipOwnedSpecies, false);
    // v1, v2 e v3 sem o campo
    const FIX = path.join(__dirname, 'fixtures');
    for (const f of ['legacy-localstorage.txt', 'legacy-v2-localstorage.txt']) {
        const g = on({ storage: createMemoryStorage({ [KEY]: fs.readFileSync(path.join(FIX, f), 'utf8') }), load: true });
        assert.equal(g.game.loadReport.ok, true, f);
        assert.deepEqual(plain(g.game.getAutomationPolicy().ballPolicy.restock), { enabled: true, minStock: 5, targetStock: 30, goldReserve: RES }, f);
        assert.equal(g.game.getAutomationPolicy().capture.skipOwnedSpecies, false, f);
    }
    const v3 = on({ seed: 4 }); v3.game.saveNow();
    const r3 = v3.ctx.SaveCodec.decodePayload(v3.storage.getItem(KEY)); delete r3.automation;
    v3.storage.setItem(KEY, v3.ctx.SaveCodec.encodePayload(JSON.stringify(r3)));
    const g3 = on({ seed: 4, load: true, storage: v3.storage });
    assert.equal(g3.game.loadReport.ok, true);
    assert.deepEqual(plain(g3.game.getAutomationPolicy().ballPolicy.restock), { enabled: true, minStock: 5, targetStock: 30, goldReserve: RES });
});
