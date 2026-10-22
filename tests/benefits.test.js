'use strict';
// F9.7: camada de benefícios (VIP), bloqueio da reposição automática e captura que não gasta bola quando não teria efeito.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { newGame, mulberry32, createMemoryStorage } = require('./helpers/game');
const { runOnline, runFast, digest } = require('./helpers/capture-golden');
const { makeFakeDom, makeUi } = require('./helpers/fake-dom');

const plain = (o) => JSON.parse(JSON.stringify(o));
const KEY = 'pokemon_idle_save';
const VIP = { benefits: ['autoRestock'] };
const on = (opts = {}) => newGame({ balls: true, ...opts });                    // captura com bola ligada; SEM benefício (padrão)
const wild = (id, shiny = false, v = 1) => ({ id, level: 5, isShiny: shiny, ivs: { hp: v, atk: v, def: v, spAtk: v, spDef: v, speed: v } });
function setBalls(game, balls) { const inv = game.ensureInventory(); inv.ballsGranted = true; if (Object.keys(balls).length) inv.balls = { ...balls }; else delete inv.balls; }
function setRestock(game, patch) { const p = plain(game.getAutomationPolicy()); Object.assign(p.ballPolicy.restock, patch); assert.equal(game.setAutomationPolicy(p).ok, true); }
function setFlag(ctx, name, v) { vm.runInContext(`${name} = ${v}`, ctx.sandbox); }
const ballSpent = (game) => ((game.gameState.economy && game.gameState.economy.byReason.ball_purchase) || { spent: 0 }).spent;
// F9.9: resumos REGENERADOS DE PROPÓSITO (o sorteio de 5% da duplicata passou a vir antes da bola; só o caminho de duplicata na política padrão muda: com a política
// de duplicatas off ou "better" os resumos antigos continuam idênticos — provado em tests/duplicate-first.test.js). Resumos antigos (eb17ca5 == cfff232):
//   online1 4698e071…  fast1 fb9550c7…  online2 83c11d7b…  fast2 7cc36e56…  online3 1f2e53c5…  fast3 27eac00b…
const GOLDEN = {   // cenário capture-golden com bolas { pokeball: 12, greatball: 6, ultraball: 3 }, reposição desligada
    online1: 'c25c99afeb8c9fe544d245a74d4b87a67c3c5248', fast1: 'c1ed15e99fb60b6b73757dbc7cff3518c6e78b85',
    online2: '29d6f5bb05d316463a7eb1b141d173b9f1f7d7e6', fast2: 'f257c5cf6f713ef6d7b13d1191a06e7b83d9c82b',
    online3: 'ae8c84b5629edf806929a797e25a7eada705d26d', fast3: '3b63cd6946292ebf4a25d49113b93de31ad2c651',
};
const BALLS = { pokeball: 12, greatball: 6, ultraball: 3 };

// =============================================================== A. hasBenefit (pura)
test('F9.7 A: hasBenefit — só o id conhecido no save vale; ids desconhecidos, estados malformados e ausentes não; BENEFIT_IDS = [autoRestock]', () => {
    const { ctx } = on();
    assert.deepEqual(plain(ctx.BENEFIT_IDS), ['autoRestock']);
    assert.equal(ctx.hasBenefit({ account: VIP }, 'autoRestock'), true);
    for (const st of [null, undefined, {}, { account: null }, { account: {} }, { account: { benefits: null } }, { account: { benefits: 'autoRestock' } }, { account: { benefits: {} } },
        { account: { benefits: [] } }, { account: { benefits: ['outro'] } }, { account: { benefits: [1, null, true] } }, { account: { benefits: ['AUTORESTOCK'] } }, 'x', 5])
        assert.equal(ctx.hasBenefit(st, 'autoRestock'), false, JSON.stringify(st));
    for (const id of ['outro', '', null, undefined, 'constructor', '__proto__', 5]) assert.equal(ctx.hasBenefit({ account: { benefits: ['autoRestock', 'outro'] } }, id), false, String(id));
    const st = { account: { benefits: ['autoRestock'] } }, before = JSON.stringify(st);
    ctx.hasBenefit(st, 'autoRestock'); assert.equal(JSON.stringify(st), before, 'pura: não altera o estado');
});

test('F9.7 A: BENEFITS_DEV_OVERRIDE concede os benefícios conhecidos sem o save; desligado (padrão) o benefício vem só do save', () => {
    const { ctx, game } = on();
    assert.equal(vm.runInContext('BENEFITS_DEV_OVERRIDE', ctx.sandbox), false, 'padrão desligado');
    assert.equal(ctx.hasBenefit(game.gameState, 'autoRestock'), false);
    setFlag(ctx, 'BENEFITS_DEV_OVERRIDE', true);
    assert.equal(ctx.hasBenefit(game.gameState, 'autoRestock'), true);
    assert.equal(ctx.hasBenefit(null, 'autoRestock'), true);
    assert.equal(ctx.hasBenefit(game.gameState, 'outro'), false, 'o override não inventa ids');
    setFlag(ctx, 'BENEFITS_DEV_OVERRIDE', false);
    assert.equal(ctx.hasBenefit(game.gameState, 'autoRestock'), false);
});

// =============================================================== B. sem o benefício a reposição não executa
test('F9.7 B: sem o benefício a reposição nunca executa — estoque, ouro, eventos e RNG iguais a um jogo com a reposição desligada', () => {
    const price = (() => { const { game } = on(); return game.getShopItems().find(i => i.id === 'pokeball').price; })();
    const { game, ctx } = on({ seed: 3 });
    setBalls(game, { pokeball: 1 }); game.gameState.gold = 5000;
    const ev = []; game.bus.on('*', (e) => ev.push(e.type || e));
    const c = { n: 0 }; game.rng = () => { c.n++; return 0.5; };
    const snapBefore = JSON.stringify({ g: game.gameState.gold, i: game.gameState.inventory });
    for (let i = 0; i < 20; i++) assert.equal(game._restockBalls(), null);
    assert.equal(JSON.stringify({ g: game.gameState.gold, i: game.gameState.inventory }), snapBefore);
    assert.equal(ballSpent(game), 0); assert.equal(c.n, 0);
    assert.ok(!ev.some(t => /restock/.test(String(t))), 'nenhum evento de reposição');
    assert.deepEqual(plain(game.getRestockStatus()), { failed: null });
    assert.ok(price >= 1);
    game.gameState.account = VIP;
    assert.ok(game._restockBalls(), 'com o benefício a mesma situação repõe');
    assert.ok(game.getBallCount('pokeball') > 1);
});

test('F9.7 B: sem o benefício — resumos do capture-golden idênticos ao baseline (online e Fast Driver, 3 sementes), com ouro de sobra e a configuração de reposição ligada', () => {
    for (const seed of [1, 2, 3]) for (const [name, run] of [['online', runOnline], ['fast', runFast]]) {
        const gate = { setup: (t) => { t.game.gameState.gold = 5000; } };      // com o benefício esse ouro faria compras
        assert.equal(digest(run(on, { seed, balls: BALLS, ...gate })).length, 40);
        const t = run(on, { seed, balls: BALLS, setup: gate.setup });
        assert.equal(ballSpent(t.game), 0, `${name}/${seed}: nenhuma compra`);
        const off = run(on, { seed, balls: BALLS, setup: (tt) => { tt.game.gameState.gold = 5000; setFlag(tt.ctx, 'BALL_RESTOCK_ENABLED', false); } });
        assert.equal(digest(t), digest(off), `${name}/${seed}: igual a um jogo com a reposição desligada`);
    }
    for (const seed of [1, 2, 3]) {      // e com a configuração padrão (sem ouro extra) bate com o baseline da F9.5/F9.6
        assert.equal(digest(runOnline(on, { seed, balls: BALLS })), GOLDEN['online' + seed], `online ${seed}`);
        assert.equal(digest(runFast(on, { seed, balls: BALLS })), GOLDEN['fast' + seed], `fast ${seed}`);
    }
});

test('F9.7 B: com o benefício a reposição funciona nos dois drivers (compras no livro-caixa, estoque abastecido, ouro acima da reserva)', () => {
    for (const [name, run] of [['online', runOnline], ['fast', runFast]]) {
        const t = run(on, { seed: 2, balls: { pokeball: 6 }, setup: (tt) => { tt.game.gameState.account = VIP; tt.game.gameState.gold = 500; } });
        assert.ok(ballSpent(t.game) > 0, `${name}: houve compras`);
        assert.ok(t.game.getMoney() >= 40 || ballSpent(t.game) === 0, 'nunca abaixo da reserva depois de comprar');
    }
});

test('F9.7 B: a configuração da reposição continua salva e volta a valer quando o benefício é concedido depois', () => {
    const a = on({ seed: 4 });
    setRestock(a.game, { minStock: 9, targetStock: 50, goldReserve: 7 });
    a.game.saveNow();
    const b = on({ seed: 4, load: true, storage: a.storage });
    b.game.gameState.account = undefined; delete b.game.gameState.account;
    assert.deepEqual(plain(b.game.getAutomationPolicy().ballPolicy.restock), { enabled: true, minStock: 9, targetStock: 50, goldReserve: 7 });
    setBalls(b.game, { pokeball: 2 }); b.game.gameState.gold = 1000;
    assert.equal(b.game._restockBalls(), null, 'sem o benefício: não age, mas a configuração está lá');
    b.game.gameState.account = VIP;
    assert.equal(b.game._restockBalls().qty, 48, 'com o benefício: usa a configuração salva (alvo 50)');
});

// =============================================================== C. save
test('F9.7 C: account.benefits — ausente, malformado e desconhecido viram "sem benefício"; ida e volta; v1, v2 e v3 antigos sem benefício; versão 3', () => {
    const a = newGame({ seed: 4 }); a.game.saveNow();
    const rawOf = (g) => g.ctx.SaveCodec.decodePayload(g.storage.getItem(KEY));
    assert.equal(rawOf(a).account, undefined, 'sem benefício o campo nem é gravado (save idêntico ao de antes)');
    const reload = (mutate) => { const raw = rawOf(a); mutate(raw); a.storage.setItem(KEY, a.ctx.SaveCodec.encodePayload(JSON.stringify(raw))); return on({ seed: 9, load: true, storage: a.storage }); };
    const cases = [['ausente', (r) => { delete r.account; }, false], ['nulo', (r) => { r.account = null; }, false], ['texto', (r) => { r.account = 'autoRestock'; }, false],
        ['lista no lugar do objeto', (r) => { r.account = ['autoRestock']; }, false], ['benefits texto', (r) => { r.account = { benefits: 'autoRestock' }; }, false],
        ['benefits objeto', (r) => { r.account = { benefits: { autoRestock: true } }, r.x = 1; }, false], ['ids desconhecidos', (r) => { r.account = { benefits: ['vip', 'ultra', 1, null, '__proto__'] }; }, false],
        ['id válido', (r) => { r.account = { benefits: ['autoRestock'] }; }, true], ['válido + lixo', (r) => { r.account = { benefits: ['x', 'autoRestock', 'autoRestock', 5] }; }, true]];
    for (const [name, mutate, expected] of cases) {
        const g = reload(mutate);
        assert.equal(g.game.loadReport.ok, true, name); assert.equal(g.game.loadReport.source, 'main', `${name}: leu o save principal`);
        assert.equal(g.ctx.hasBenefit(g.game.gameState, 'autoRestock'), expected, name);
        if (expected) assert.deepEqual(plain(g.game.gameState.account), { benefits: ['autoRestock'] }, `${name}: saneado (sem lixo nem repetição)`);
        else assert.equal(g.game.gameState.account, undefined, `${name}: nenhum resto no estado`);
    }
    // ida e volta
    const b = on({ seed: 4 }); b.game.gameState.account = VIP; b.game.saveNow();
    assert.deepEqual(plain(rawOf(b).account), VIP); assert.equal(rawOf(b).schemaVersion, 3); assert.equal(b.ctx.SAVE_SCHEMA_VERSION, 3);
    const c = on({ seed: 4, load: true, storage: b.storage });
    assert.equal(c.ctx.hasBenefit(c.game.gameState, 'autoRestock'), true);
    // v1 e v2 antigos
    const FIX = path.join(__dirname, 'fixtures');
    for (const f of ['legacy-localstorage.txt', 'legacy-v2-localstorage.txt']) {
        const g = on({ storage: createMemoryStorage({ [KEY]: fs.readFileSync(path.join(FIX, f), 'utf8') }), load: true });
        assert.equal(g.game.loadReport.ok, true, f); assert.equal(g.ctx.hasBenefit(g.game.gameState, 'autoRestock'), false, f);
    }
});

// =============================================================== D. rejeição antes do gasto
// modelo independente do veredito
function modelVerdict(c) {
    if (!c.hasLive) return c.policy === 'off' ? 'reject' : 'accept';
    if (c.policy === 'off') return 'reject';
    if (c.shiny) return 'accept';
    if (c.count >= c.cap) return 'reject';
    if (c.policy === 'better') { let all = true; for (const t of c.ownedTotals) if (!(c.wildTotal > t)) all = false; return all ? 'accept' : 'reject'; }
    return 'roll';
}
test('F9.7 D: duplicateVerdict bate com o modelo independente (política × shiny × espécie ativa × limite × IV)', () => {
    const { ctx } = on();
    let n = 0;
    for (const policy of ['all', 'better', 'off']) for (const hasLive of [true, false]) for (const shiny of [false, true]) for (const count of [0, 1, 19, 20, 25])
        for (const wildTotal of [0, 50, 100]) for (const ownedTotals of [[], [40], [60], [40, 60], [10, 20, 30]]) {
            const c = { policy, hasLive, shiny, count, cap: 20, wildTotal, ownedTotals };
            assert.equal(ctx.duplicateVerdict(c).verdict, modelVerdict(c), JSON.stringify(c)); n++;
        }
    assert.ok(n > 500);
    assert.equal(ctx.duplicateVerdict({ policy: 'all', hasLive: true, shiny: false, count: 1, cap: 20, wildTotal: 1, ownedTotals: [1] }).verdict, 'roll');
});

function huntGame(seed = 5) { const g = on({ seed }); g.game.dispatchAutomationAction({ type: 'START_HUNT' }); g.game.stopBattle(); return g; }
function ownSpecies(game, id, v = 20) { game.catchPokemonWithIvs(id, 1, { hp: v, atk: v, def: v, spAtk: v, spDef: v, speed: v }); }
const attemptOnce = (game, w, rv = 0) => {
    const c = { n: 0 }; game.rng = () => { c.n++; return rv; };
    const ev = []; const off = game.bus.on('capture_skipped', (e) => ev.push(e.reason));
    const b0 = JSON.stringify(game.getBalls());
    const out = game.processDefeat(w);
    return { out, n: c.n, balls: JSON.stringify(game.getBalls()), b0, skipped: ev };
};

test('F9.7 D: duplicata rejeitada (política off, "better" sem ganho, limite de 20) e PC cheio NÃO gastam bola nem sorteio; emitem capture_skipped com o motivo', () => {
    const cases = [
        ['política off', (g) => { g.gameState.settings = { captureDuplicates: 'off' }; }, 'duplicate_policy_off'],
        ['better sem ganho', (g) => { g.gameState.settings = { captureDuplicates: 'better' }; ownSpecies(g, 16, 25); }, 'duplicate_not_better'],
        ['limite de 20', (g) => { for (let i = 0; i < 19; i++) g._captureDuplicate(wild(16, false, 20)); }, 'duplicate_species_cap'],
        ['PC cheio', (g) => { g.roster.hasRoom = () => false; }, 'pc_full'],
    ];
    for (const [name, setup, reason] of cases) for (const offline of [false, true]) {
        const { game } = huntGame(); ownSpecies(game, 16, 25); setup(game);
        if (offline) game._isOfflineSimulating = true;
        const r = attemptOnce(game, wild(16, false, 1));            // IVs piores que os guardados: a captura não teria efeito algum
        assert.equal(r.out, null, `${name}: não captura`); assert.equal(r.n, 0, `${name}: sem sorteio`);
        assert.equal(r.balls, r.b0, `${name}: sem bola gasta`);
        assert.deepEqual(r.skipped, [reason], `${name}: um capture_skipped com o motivo`);
    }
});

test('F9.7 D: mantêm a tentativa: IV melhor (a atualização de IV ainda vale), shiny e espécie nova; a duplicata sem ganho recusada no sorteio de 5% não gasta bola (F9.9: o sorteio vem ANTES da bola)', () => {
    // IV melhor, mesmo com política off e PC cheio: gasta a bola e atualiza os IVs
    const a = huntGame(); ownSpecies(a.game, 16, 10); a.game.gameState.settings = { captureDuplicates: 'off' }; a.game.roster.hasRoom = () => false;
    const r1 = attemptOnce(a.game, wild(16, false, 25));
    assert.equal(r1.n >= 1, true, 'sorteio da bola'); assert.notEqual(r1.balls, r1.b0, 'bola gasta');
    assert.equal(a.game.gameState.caughtPokemon[16].ivs.hp, 25, 'IV atualizado');
    // shiny: tenta sempre (para valer o aviso de PC cheio)
    const b = huntGame(); ownSpecies(b.game, 16, 25); b.game.roster.hasRoom = () => false; b.game.gameState.settings = { captureDuplicates: 'off' };
    const r2 = attemptOnce(b.game, wild(16, true, 1)); assert.equal(r2.n >= 1, true); assert.notEqual(r2.balls, r2.b0);
    // espécie nova com PC cheio: tenta
    const c = huntGame(); c.game.roster.hasRoom = () => false;
    const r3 = attemptOnce(c.game, wild(19, false, 1)); assert.equal(r3.n >= 1, true); assert.notEqual(r3.balls, r3.b0);
    // política padrão (all) e PC com espaço, duplicata sem ganho de IV: F9.9 — o sorteio de 5% vem ANTES da bola. Recusado (0,5): 1 sorteio, sem bola.
    const d = huntGame(); ownSpecies(d.game, 16, 25);
    const r4 = attemptOnce(d.game, wild(16, false, 1), 0.5);
    assert.equal(r4.n, 1, 'só o sorteio da duplicata'); assert.equal(r4.balls, r4.b0, 'sem bola gasta'); assert.equal(r4.out, null);
});

test('F9.7 D: resumos do capture-golden com PC não cheio e duplicatas permitidas (padrão) idênticos ao baseline (regenerado na F9.9) — online e Fast Driver, 3 sementes', () => {
    for (const seed of [1, 2, 3]) {
        assert.equal(digest(runOnline(on, { seed, balls: BALLS })), GOLDEN['online' + seed], `online ${seed}`);
        assert.equal(digest(runFast(on, { seed, balls: BALLS })), GOLDEN['fast' + seed], `fast ${seed}`);
    }
});

test('F9.7 D: online × Fast Driver — com PC cheio e com duplicata rejeitada, nenhuma bola é gasta em captura sem efeito (modelo independente por tentativa)', () => {
    for (const [label, tweak] of [['PC cheio', (g) => { g.roster.hasRoom = () => false; }], ['duplicatas off', (g) => { g.gameState.settings = { captureDuplicates: 'off' }; }]])
        for (const [name, run] of [['online', runOnline], ['fast', runFast]]) {
            const spent = [], skippedWaste = [];
            let attempts = 0;
            const t = run(on, { seed: 2, balls: { pokeball: 99 }, setup: (tt) => {
                tweak(tt.game);
                const orig = tt.game._ballCaptureAttempt.bind(tt.game);
                tt.game._ballCaptureAttempt = (w) => {
                    attempts++;
                    const st = tt.game.gameState.caughtPokemon[w.id];
                    const improves = !!st && Object.keys(w.ivs).some(k => w.ivs[k] > st.ivs[k]);
                    const noEffect = !!st && !improves && !w.isShiny;       // modelo: duplicata sem melhora de IV e sem shiny
                    if (noEffect) spent.push({ id: w.id });                // chegou aqui = gastaria bola em captura sem efeito
                    return orig(w);
                };
                tt.game.bus.on('capture_skipped', (e) => { if (/^(pc_full|duplicate_)/.test(e.reason)) skippedWaste.push(e.reason); });
            } });
            assert.equal(spent.length, 0, `${label}/${name}: nenhuma bola gasta em captura sem efeito (${spent.length})`);
            assert.ok(skippedWaste.length > 0, `${label}/${name}: houve capturas puladas (${skippedWaste.length})`);
            assert.ok(attempts > 0, `${label}/${name}: e as capturas com efeito seguiram tentando`);
            assert.ok(t.game.getBallCount('pokeball') <= 99);
        }
});

test('F9.7 D: paridade online × offline da checagem — mesma sequência de capturas dá os mesmos resultados, bolas, estado e contagem de RNG nos dois modos', () => {
    const run = (offline) => {
        const { game } = huntGame(6); ownSpecies(game, 16, 25); ownSpecies(game, 19, 5);
        game.gameState.settings = { captureDuplicates: 'better' };
        if (offline) game._isOfflineSimulating = true;
        const vals = []; const base = mulberry32(99); game.rng = () => { const v = base(); vals.push(v); return v; };
        const res = [];
        for (let i = 0; i < 80; i++) res.push(!!game.processDefeat(wild([16, 19, 21][i % 3], i % 13 === 0, (i * 7) % 31)));
        return JSON.stringify({ res, vals, balls: game.getBalls(), owned: Object.keys(game.gameState.caughtPokemon), ivs: game.gameState.caughtPokemon[16].ivs });
    };
    const a = run(false), b = run(true);
    assert.equal(a, b);
    assert.ok(JSON.parse(a).res.some(Boolean) && JSON.parse(a).res.some(r => !r));
});

// =============================================================== E. reserva padrão 40
test('F9.7 E: reserva de ouro padrão 40 (constante, política padrão e valores inválidos voltando a ela)', () => {
    const { ctx } = on();
    assert.equal(ctx.BALL_RESTOCK_GOLD_RESERVE, 40);
    assert.equal(ctx.defaultAutomationPolicy().ballPolicy.restock.goldReserve, 40);
    assert.equal(plain(ctx.sanitizeAutomationPolicy({ ballPolicy: { type: 'none', restock: { goldReserve: -5 } } })).ballPolicy.restock.goldReserve, 40);
    assert.equal(plain(ctx.sanitizeAutomationPolicy({ ballPolicy: { type: 'none', restock: { minStock: 50, targetStock: 10 } } })).ballPolicy.restock.goldReserve, 40);
});

// =============================================================== F. interface (fake dom)
test('F9.7 F: sem o benefício os controles da reposição ficam bloqueados com frase neutra; com o benefício ficam ativos', () => {
    const g = on({ seed: 3 });
    const dom = makeFakeDom(g.ctx), ui = makeUi(g.game), view = new g.ctx.HuntView(ui);
    view.render();
    const html = () => dom.html('hunt-settings');
    const restockInputs = () => (html().match(/<input[^>]*data-hunt-policy="ballPolicy\.restock\.[a-zA-Z]+"[^>]*>/g) || []);
    assert.equal(restockInputs().length, 4);
    assert.ok(restockInputs().every(i => /\bdisabled\b/.test(i)), 'todos bloqueados sem o benefício');
    assert.match(html(), /Benefício VIP: a reposição automática de bolas não está ativa nesta conta/);
    assert.match(html(), /Bloqueada: a reposição automática é um benefício VIP\./);
    assert.doesNotMatch(html(), /comprar agora|assine|R\$|US\$|preço do plano|http/i, 'sem texto de venda, preço ou link');
    assert.match(dom.html('hunt-settings'), /data-hunt-policy="capture\.skipOwnedSpecies"(?![^>]*disabled)/, 'poupar bolas segue disponível');
    g.game.gameState.account = VIP; view.render();
    assert.ok(restockInputs().every(i => !/\bdisabled\b/.test(i)), 'ativos com o benefício');
    assert.doesNotMatch(html(), /data-hunt-restock-locked/);
    assert.match(html(), /Ligada: repõe até 30 quando houver menos de 5, sem usar os \$40 de reserva\./);
    // aviso de sem bolas
    setBalls(g.game, {}); view.render();
    assert.match(dom.html('hunt-status'), /Sem Poké Bolas: nenhuma captura é tentada\. Compre bolas na Loja\./);
    delete g.game.gameState.account; view.render();
    assert.match(dom.html('hunt-status'), /Compre bolas manualmente na Loja\./);
});
