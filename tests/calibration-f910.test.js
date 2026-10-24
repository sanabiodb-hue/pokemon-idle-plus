'use strict';
// F9.10: calibração numérica — shiny (M1), lendários (M2), bolas premium (M3), preço das bolas (M5). A poção (M4) não muda (ver o relatório da fase).
// Provas: (1) o número de sorteios de RNG não mudou; (2) com as flags desligadas, o capture-golden é idêntico ao do HEAD da F9.8b; (3) as taxas derivadas
// batem com as metas; (4) as espécies comuns mantêm exatamente as proporções entre si. As medições por simulação ficam em tools/calibrate-f910.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { newGame, plain } = require('./helpers/game');
const { runOnline, runFast, digest } = require('./helpers/capture-golden');

const cal = (opts = {}) => newGame({ calibration: true, balls: true, ...opts });
const flag = (ctx, name, value) => vm.runInContext(`${name} = ${value}`, ctx.sandbox);
const stub = (game, { badge = null, talent = 0, tower = 0 } = {}) => {
    game.getBadgeEffectValue = (k) => (k === 'shiny_bonus' ? badge : null);
    game.getTalentValue = (k) => (k === 'shiny_bonus' ? talent : 0);
    game.getTowerBonus = () => tower;
};

// =============================================================== M1 · shiny
test('M1: a taxa base é derivada da meta — mediana de 72 h com cadeia ×2 e 180 encontros/h', () => {
    const { ctx } = cal();
    const n = ctx.SHINY_TARGET_MEDIAN_HOURS * ctx.SHINY_REFERENCE_WINS_PER_HOUR;
    const p = ctx.BASE_SHINY_RATE_CALIBRATED * ctx.SHINY_REFERENCE_CHAIN_MULT;
    assert.ok(Math.abs(Math.pow(1 - p, n) - 0.5) < 1e-9, `P(sem shiny em ${n} encontros) = ${Math.pow(1 - p, n)}`);
    assert.ok(Math.abs(1 / ctx.BASE_SHINY_RATE_CALIBRATED - 37396) < 1, `1/${(1 / ctx.BASE_SHINY_RATE_CALIBRATED).toFixed(1)}`);
    assert.equal(ctx.SHINY_SOURCES_MAX_MULT, 4);
    assert.equal(ctx.SHINY_CHAIN_MAX_MULT_CALIBRATED, 2);
});

test('M1: a cadeia chega ao teto ×2 em 40 vitórias; sem a flag, é a cadeia anterior (passo 0,05, teto ×3)', () => {
    const on = cal().ctx, off = newGame().ctx;
    const mult = (ctx, c) => ctx.huntShinyChainMultiplier(c);
    assert.equal(mult(on, 0), 1);
    assert.ok(Math.abs(mult(on, 20) - 1.5) < 1e-12);
    assert.ok(Math.abs(mult(on, 39) - 1.975) < 1e-12);
    assert.equal(mult(on, 40), 2);
    assert.equal(mult(on, 41), 2); assert.equal(mult(on, 1e9), 2, 'teto');
    assert.equal(on.SHINY_CHAIN_FULL_WINS, 40);
    assert.equal(mult(off, 40), 3); assert.equal(mult(off, 10), 1.5);
});

test('M1: as fontes fixas são SOMADAS e limitadas a ×4 (antes eram multiplicadas, sem teto)', () => {
    const { game, ctx } = cal(), B = ctx.BASE_SHINY_RATE_CALIBRATED;
    const rate = (s) => { stub(game, s); return game.getShinyRate(); };
    assert.equal(rate({}), B, 'sem fontes: taxa base');
    assert.ok(Math.abs(rate({ badge: 1.0 }) - 2 * B) < 1e-15, 'Sinnoh (+100%) = ×2');
    assert.ok(Math.abs(rate({ badge: 1.0, talent: 100 }) - 3 * B) < 1e-15, 'Sinnoh + talento (+100%) = ×3 (somado; o produto antigo daria ×4)');
    assert.ok(Math.abs(rate({ badge: 1.0, talent: 100, tower: 100 }) - 4 * B) < 1e-15, 'no teto: ×4');
    assert.ok(Math.abs(rate({ badge: 1.0, talent: 100, tower: 5000 }) - 4 * B) < 1e-15, 'além do teto continua ×4');
    assert.ok(Math.abs(rate({ talent: 30 }) - 1.3 * B) < 1e-15);
});

test('M1: gemas, frutas, melhorias, VIP e a política não entram na taxa de shiny', () => {
    const { game, ctx } = cal();
    const before = game.getShinyRate();
    const gs = game.gameState;
    gs.gems = ctx.GEM_QUALITIES.map(q => game.generateGemByQuality(q.id));
    gs.berryBag = { atk_berry: 9 }; gs.berryFed = { 25: { atk_berry: 3 } };
    gs.upgrades = { hunt_xp: 5, hunt_profit: 5, hunt_speed: 5 }; game._invalidateModifiers();
    gs.account = { benefits: ['autoRestock'] };
    assert.equal(game.getShinyRate(), before);
});

test('M1: a taxa base, a cadeia e as fontes calibradas só valem com a flag; desligada, o cálculo é o de antes', () => {
    const off = newGame().game;
    assert.equal(off.getShinyRate(), off.getShinyRate.call({ ...off, getBadgeEffectValue: () => null, getTalentValue: () => 0, getTowerBonus: () => 0 }));
    stub(off, { badge: 1.0, talent: 100 });
    assert.ok(Math.abs(off.getShinyRate() - (1 / 4096) * 2 * 2) < 1e-15, 'produto das fontes, base 1/4096');
});

test('M1: pior caso (cadeia ×2 e fontes no teto ×4) — a mediana medida pelo caminho real cai para ≈ 18 h', () => {
    const { game, ctx } = cal({ seed: 4242 });
    stub(game, { badge: 1.0, talent: 100, tower: 300 });
    game.dispatchAutomationAction({ type: 'START_HUNT' });
    game.getHuntSession().shinyChain = { speciesId: 25, count: ctx.SHINY_CHAIN_FULL_WINS * 5 };
    const counts = [];
    for (let i = 0; i < 40; i++) { let n = 0; do { n++; } while (!game.createWildPokemon(25, 50).isShiny); counts.push(n); }
    counts.sort((a, b) => a - b);
    const median = (counts[19] + counts[20]) / 2, hours = median / ctx.SHINY_REFERENCE_WINS_PER_HOUR;
    assert.ok(hours > 18 * 0.6 && hours < 18 * 1.6, `mediana ${hours.toFixed(1)} h (N=40; a tabela completa, com N=400, está em tools/calibrate-f910.js shiny)`);
});

// =============================================================== RNG: o número de sorteios não mudou
test('RNG: a escolha da espécie e a criação do inimigo consomem o MESMO número de sorteios com a calibração ligada ou desligada', () => {
    const calls = (opts) => {
        const { game } = opts ? cal({ seed: 5 }) : newGame({ seed: 5, balls: true });
        let n = 0; const base = game.rng; game.rng = () => { n++; return base.call(game); };
        for (const id of ['kanto_cerulean_cave', 'hoenn_sealed_chamber', 'alola_route12', 'kanto_route1']) {
            const route = game.getRoute(id);
            for (let i = 0; i < 150; i++) game.generateWildPokemon(route);
        }
        return n;
    };
    assert.equal(calls(true), calls(false));
    assert.ok(calls(true) > 0);
});

test('RNG: 1 sorteio por tentativa de captura (Poké Bola ou premium, shiny ou lendário), com a calibração ligada ou desligada', () => {
    for (const calibration of [true, false]) {
        const { game } = calibration ? cal({ seed: 8 }) : newGame({ seed: 8, balls: true });
        game.dispatchAutomationAction({ type: 'START_HUNT' }); game.stopBattle();
        let n = 0; const base = game.rng; game.rng = () => { n++; return base.call(game); };
        for (const [id, shiny] of [[150, false], [25, true], [16, false], [249, true]]) {
            game.ensureInventory().balls = { pokeball: 5, ultraball: 5 };
            const before = n;
            game._ballCaptureAttempt({ id, level: 50, isShiny: shiny, ivs: { hp: 1, atk: 1, def: 1, spAtk: 1, spDef: 1, speed: 1 } });
            assert.equal(n - before, 1, `calibração ${calibration}: espécie ${id} shiny=${shiny}`);
        }
    }
});

// capture-golden: digests do HEAD da F9.8b (a8fcef8), calculados com a árvore anterior à F9.10
const HEAD = {
    'plain/online1': 'c25c99afeb8c', 'plain/fast1': 'c1ed15e99fb6', 'plain/online2': '29d6f5bb05d3', 'plain/fast2': 'f257c5cf6f71', 'plain/online3': 'ae8c84b5629e', 'plain/fast3': '3b63cd694629',
    'restock/online1': '40b91e0ebda1', 'restock/fast1': '145e70aa61f9', 'restock/online2': '9440bddf5e27', 'restock/fast2': '8cd0de19262d', 'restock/online3': 'b0fdd367eebb', 'restock/fast3': '5bf476a963aa',
};
test('capture-golden: com as flags da F9.10 desligadas, os resumos são IDÊNTICOS aos do HEAD (3 sementes × online/Fast Driver × com e sem reposição)', () => {
    const BALLS = { pokeball: 12, greatball: 6, ultraball: 3 };
    const mk = (restock) => (opts = {}) => {
        const g = newGame({ balls: true, ...opts });
        flag(g.ctx, 'BALL_RESTOCK_ENABLED', restock);
        if (restock) g.game.gameState.account = { benefits: ['autoRestock'] };
        return g;
    };
    for (const restock of [false, true]) for (const seed of [1, 2, 3]) for (const [name, run] of [['online', runOnline], ['fast', runFast]]) {
        const key = `${restock ? 'restock' : 'plain'}/${name}${seed}`;
        assert.equal(digest(run(mk(restock), { seed, balls: BALLS })).slice(0, 12), HEAD[key], key);
    }
});

// =============================================================== M2 · lendários (multiplicador POR ROTA, tabela estática gerada por tools/calibrate-f910.js)
// Probabilidade de cada espécie da rota pelo caminho real: o rng() da escolha é varrido por bisseção (as fronteiras dos intervalos são os pesos normalizados).
function speciesProbs(game, route) {
    const pick = (x) => { let k = 0; game.rng = () => (k++ === 0 ? x : 0.5); const w = game.generateWildPokemon(route); return route.pokemon.findIndex(p => p.id === w.id); };
    const bounds = [];
    for (let i = 0; i < route.pokemon.length - 1; i++) {
        let lo = 0, hi = 1;
        for (let it = 0; it < 60; it++) { const mid = (lo + hi) / 2; if (pick(mid) <= i) lo = mid; else hi = mid; }
        bounds.push(lo);
    }
    bounds.push(1);
    return bounds.map((b, i) => b - (i ? bounds[i - 1] : 0));
}
const fs = require('node:fs');
const path = require('node:path');
const tool = () => require('../tools/calibrate-f910');
const tableRows = (ctx) => tool().legendaryRows(ctx.LEGENDARY_ROUTE_E);             // linhas derivadas da tabela de E guardada (sem simular)
const configSource = () => fs.readFileSync(path.join(__dirname, '..', 'js', 'game-config.js'), 'utf8').split(String.fromCharCode(13)).join('');
const allRoutes = (ctx) => Object.values(ctx.REGIONS || require('../tools/load-context').loadData().REGIONS).flatMap(r => r.routes);

test('M2: a tabela de multiplicadores é exatamente a que o script deriva da tabela de E guardada (44 rotas, 1 por rota com lendário misto)', () => {
    const { ctx } = cal(), rows = tableRows(ctx);
    assert.ok(configSource().includes(tool().tableSource(rows)), 'js/game-config.js desatualizado: rode "node tools/calibrate-f910.js legtable --write"');
    assert.deepEqual(Object.keys(ctx.LEGENDARY_ROUTE_MULT).sort(), rows.map(r => r.id).sort());
    assert.equal(rows.length, 44);
    assert.equal(rows.filter(r => r.da_lista).length, 9, '9 das 10 rotas da lista são normalizáveis (alola_route13 só tem restritos)');
    for (const r of rows) assert.ok(r.m > 0 && r.m < 1, `${r.id}: m = ${r.m}`);
});

test('M2: o E guardado bate com a medição real (Fast Driver, janela de 10 h) em 3 rotas de amostra; a regeneração completa das 44 é opt-in (F910_REGEN=1)', () => {
    const { ctx } = cal();
    for (const id of ['kanto_route10', 'hoenn_sealed_chamber', 'sinnoh_hall_of_origin'])
        assert.equal(Math.round(tool().measureEncounterRate(id).encounters * 10) / 10, ctx.LEGENDARY_ROUTE_E[id], id);
    if (process.env.F910_REGEN) assert.ok(configSource().includes(tool().tableSource(tool().buildLegendaryTable().rows)), 'regeneração completa difere da tabela');
});

test('M2: chance efetiva de lendário por encontro = p_alvo = ln2/(E·H) (±5%) em TODAS as rotas da tabela, pelo caminho real', () => {
    const on = cal({ seed: 3 }), rows = tableRows(on.ctx);
    for (const r of rows) {
        const route = on.game.getRoute(r.id), probs = speciesProbs(on.game, route);
        const eff = probs.reduce((a, p, i) => a + (on.ctx.isLegendaryOrMythic(route.pokemon[i].id) ? p : 0), 0);
        assert.ok(Math.abs(eff / r.pAlvo - 1) < 0.05, `${r.id}: efetivo ${eff} × alvo ${r.pAlvo}`);
        assert.equal(on.ctx.legendaryRouteMult(r.id), r.m);
    }
});

test('M2: só o peso dos restritos muda — comuns mantêm as proporções entre si e restritos também (diferença < 1e-9), todas as rotas da tabela', () => {
    const on = cal({ seed: 3 }), off = newGame({ seed: 3, balls: true });
    for (const id of Object.keys(on.ctx.LEGENDARY_ROUTE_MULT)) {
        const route = on.game.getRoute(id), rOff = off.game.getRoute(id);
        const pOn = speciesProbs(on.game, route), pOff = speciesProbs(off.game, rOff);
        const isLeg = route.pokemon.map(p => on.ctx.isLegendaryOrMythic(p.id));
        const sum = (a, flag) => a.reduce((s, p, i) => s + (isLeg[i] === flag ? p : 0), 0);
        const [cOn, cOff, lOn, lOff] = [sum(pOn, false), sum(pOff, false), sum(pOn, true), sum(pOff, true)];
        assert.ok(lOn < lOff, id);
        route.pokemon.forEach((p, i) => {
            const [a, b] = isLeg[i] ? [lOn, lOff] : [cOn, cOff];
            assert.ok(Math.abs(pOn[i] / a - pOff[i] / b) < 1e-9, `${id} #${p.id}: proporção dentro do grupo`);
        });
    }
});

test('M2: mesmo nº de sorteios do RNG por encontro, com a flag ligada ou desligada (rotas mistas, só-restritos e sem restritos)', () => {
    const count = (opts, id) => {
        const g = opts.on ? cal({ seed: 3 }) : newGame({ seed: 3, balls: true });
        let n = 0;
        g.game.rng = () => { n++; return 0.37; };
        const route = g.game.getRoute(id);
        for (let i = 0; i < 20; i++) g.game.generateWildPokemon(route);
        return n;
    };
    for (const id of ['kanto_route10', 'hoenn_sealed_chamber', 'paldea_route14', 'alola_route13', 'kanto_route1'])
        assert.equal(count({ on: true }, id), count({ on: false }, id), id);
});

test('M2: rotas sem lendário ou SÓ com lendários/míticos ficam fora da tabela e inalteradas', () => {
    const on = cal({ seed: 3 }), off = newGame({ seed: 3, balls: true });
    const table = on.ctx.LEGENDARY_ROUTE_MULT;
    let onlyRestricted = 0, none = 0;
    for (const r of allRoutes(on.ctx)) {
        const leg = r.pokemon.filter(p => on.ctx.isLegendaryOrMythic(p.id)).length;
        if (leg === 0) { none++; assert.equal(table[r.id], undefined, r.id); }
        else if (leg === r.pokemon.length) { onlyRestricted++; assert.equal(table[r.id], undefined, r.id); }
        else assert.ok(table[r.id] > 0, `${r.id} tem lendário e precisa de multiplicador`);
    }
    assert.deepEqual(onlyRestricted, 4, 'alola_route12/13/14 e galar_route13');
    assert.ok(none > 100);
    for (const id of ['alola_route12', 'alola_route13', 'alola_route14', 'galar_route13']) {
        const a = speciesProbs(on.game, on.game.getRoute(id)), b = speciesProbs(off.game, off.game.getRoute(id));
        a.forEach((p, i) => assert.ok(Math.abs(p - b[i]) < 1e-9, `${id}[${i}]`));
    }
});

test('M2: sem a flag, os pesos são os dos dados', () => {
    const { game, ctx } = cal({ seed: 3 });
    flag(ctx, 'LEGENDARY_WEIGHT_ENABLED', false);
    const route = game.getRoute('kanto_route10'), p = speciesProbs(game, route), tw = route.pokemon.reduce((a, x) => a + x.weight, 0);
    route.pokemon.forEach((x, i) => assert.ok(Math.abs(p[i] - x.weight / tw) < 1e-9));
});

// Medição pelo Fast Driver (mediana de N caças por rota nas 9 rotas normalizáveis da lista, sementes 500+): ~30 min de CPU, por isso só com F910_MEASURE=1
// (ou F910_MEASURE=<N>). O mesmo cálculo roda por "node tools/calibrate-f910.js legendary 100".
test('M2: medição real (opt-in F910_MEASURE) — mediana de CADA rota da lista em 7–14 h', { skip: !process.env.F910_MEASURE }, () => {
    const tool = require('../tools/calibrate-f910'), N = Math.max(100, Number(process.env.F910_MEASURE) || 100);
    for (const r of tool.measureLegendary({ n: N, routes: tool.AUDITED_ROUTES.filter(id => id !== 'alola_route13') }))
        assert.ok(r.medianaHoras >= 7 && r.medianaHoras <= 14, `${r.rota}: mediana ${r.medianaHoras} h (N=${r.N})`);
});

// =============================================================== M3 · bolas premium
const IVS = { hp: 1, atk: 1, def: 1, spAtk: 1, spDef: 1, speed: 1 };
function vip(opts = {}) {
    const g = cal({ seed: 6, ...opts });
    g.game.gameState.account = { benefits: ['autoRestock'] };
    g.game.ensureInventory().ballsGranted = true; g.game.ensureInventory().balls = {};
    return g;
}
const ultraPrice = (g) => g.ctx.ballPrice(g.ctx.getBallType('ultraball'), g.game.getBallPricingLevel());

test('M3: shiny, lendário e mítico usam a melhor bola NÃO-Master disponível; os comuns usam a mais barata; a Master nunca é escolhida sozinha', () => {
    const { ctx } = cal();
    const balls = { pokeball: 3, greatball: 2, ultraball: 1, masterball: 1 };
    assert.equal(ctx.chooseBall(balls, true).id, 'ultraball');
    assert.equal(ctx.chooseBall(balls, false).id, 'pokeball');
    assert.equal(ctx.chooseBall({ pokeball: 3, masterball: 5 }, true).id, 'pokeball', 'sem Great/Ultra: a melhor não-Master');
    assert.equal(ctx.chooseBall({ masterball: 5 }, true), null, 'só Master: nenhuma bola automática');
    const g = vip();
    g.game.dispatchAutomationAction({ type: 'START_HUNT' }); g.game.stopBattle();
    const used = (id, shiny) => {
        g.game.ensureInventory().balls = { pokeball: 5, ultraball: 5 };
        const r = g.game._ballCaptureAttempt({ id, level: 50, isShiny: shiny, ivs: IVS });
        return r.ball ? r.ball.id : null;
    };
    assert.equal(used(150, false), 'ultraball', 'lendário (Mewtwo)');
    assert.equal(used(151, false), 'ultraball', 'mítico (Mew)');
    assert.equal(used(25, true), 'ultraball', 'shiny comum');
    assert.equal(used(16, false), 'pokeball', 'comum não shiny');
    flag(g.ctx, 'PREMIUM_BALL_ENABLED', false);
    assert.equal(used(150, false), 'pokeball', 'sem a flag, lendário volta a usar a mais barata');
    assert.equal(used(25, true), 'ultraball', 'sem a flag, shiny segue usando a melhor (comportamento anterior)');
});

test('M3: reposição premium — COM reserva não compra; SEM reserva e SEM ouro não compra (um aviso); SEM reserva e COM ouro compra até 5 Ultra Bolas', () => {
    const R = 5;
    // com reserva
    let g = vip(); g.game.ensureInventory().balls = { ultraball: R }; g.game.gameState.gold = 1e6;
    assert.equal(g.game._restockPremiumBalls(), null);
    assert.equal(g.game.getMoney(), 1e6); assert.equal(g.game.getBallCount('ultraball'), R);
    // sem reserva e sem ouro (abaixo da reserva de ouro da política + 1 bola)
    g = vip(); const price = ultraPrice(g), gold = g.game.getAutomationPolicy().ballPolicy.restock.goldReserve + price - 1;
    g.game.gameState.gold = gold;
    const failed = []; g.game.bus.on('balls_restock_failed', (e) => failed.push(e));
    assert.equal(g.game._restockPremiumBalls(), null); assert.equal(g.game._restockPremiumBalls(), null);
    assert.equal(g.game.getBallCount('ultraball'), 0); assert.equal(g.game.getMoney(), gold, 'nenhum ouro gasto');
    assert.equal(failed.length, 1, 'um aviso por episódio'); assert.equal(failed[0].item, 'ultraball'); assert.equal(failed[0].reason, 'no_gold'); assert.equal(failed[0].premium, true);
    // sem reserva e com ouro: compra a reserva inteira
    g = vip(); const p2 = ultraPrice(g); g.game.gameState.gold = 1e6;
    const bought = []; g.game.bus.on('balls_restocked', (e) => bought.push(e));
    const out = g.game._restockPremiumBalls();
    assert.deepEqual(plain(out), { qty: R, total: R * p2 });
    assert.equal(g.game.getBallCount('ultraball'), R); assert.equal(g.game.getMoney(), 1e6 - R * p2);
    assert.equal(bought.length, 1); assert.equal(bought[0].premium, true);
    // reserva parcial: repõe só a diferença; ouro parcial: compra o que o ouro acima da reserva paga
    g = vip(); g.game.ensureInventory().balls = { ultraball: 3 }; g.game.gameState.gold = 1e6;
    assert.equal(g.game._restockPremiumBalls().qty, 2);
    g = vip(); const p3 = ultraPrice(g); g.game.gameState.gold = g.game.getAutomationPolicy().ballPolicy.restock.goldReserve + 2 * p3 + 1;
    assert.equal(g.game._restockPremiumBalls().qty, 2, 'ouro para 2 das 5');
});

test('M3: a reposição premium respeita o benefício VIP, a política de reposição e a flag', () => {
    const base = () => { const g = vip(); g.game.gameState.gold = 1e6; return g; };
    let g = base(); g.game.gameState.account = { benefits: [] };
    assert.equal(g.game._restockPremiumBalls(), null, 'sem o benefício autoRestock');
    g = base(); const pol = g.game.getAutomationPolicy(); pol.ballPolicy.restock.enabled = false; g.game.setAutomationPolicy(pol);
    assert.equal(g.game._restockPremiumBalls(), null, 'política com a reposição desligada');
    g = base(); flag(g.ctx, 'PREMIUM_BALL_ENABLED', false);
    assert.equal(g.game._restockPremiumBalls(), null, 'PREMIUM_BALL_ENABLED = false');
    g = base(); flag(g.ctx, 'BALL_RESTOCK_ENABLED', false);
    assert.equal(g.game._restockPremiumBalls(), null, 'BALL_RESTOCK_ENABLED = false');
    assert.equal(g.ctx.PREMIUM_BALL_RESERVE, 5); assert.equal(g.ctx.PREMIUM_BALL_ITEM, 'ultraball');
});

test('M3: quanto o shiny perde com a Poké Bola contra a Ultra Bola em BST 680 (Mewtwo): 36,7% contra 73,3%', () => {
    const { ctx } = cal();
    const rate = ctx.speciesCatchRate(ctx.POKEMON_DATA[150]);
    const chance = (id) => ctx.captureChance(rate, ctx.getBallType(id));
    assert.ok(Math.abs(rate - (1 - 380 / 600)) < 1e-12, `taxa da espécie ${rate}`);
    assert.ok(Math.abs(chance('pokeball') - 0.36667) < 1e-4);
    assert.ok(Math.abs(chance('greatball') - 0.55) < 1e-4);
    assert.ok(Math.abs(chance('ultraball') - 0.73333) < 1e-4);
    assert.ok(Math.abs(chance('ultraball') / chance('pokeball') - 2) < 1e-9, 'a Poké Bola captura a METADE do que a Ultra captura');
});

// =============================================================== M5 · preço das bolas
test('M5: preço = max(piso, ceil(winsPerBall × BALL_PRICE_MULT × ouro por vitória)); Master não é comprável; pisos e pilha não mudam', () => {
    const { ctx } = cal(), legacy = newGame().ctx;
    const gw = (l) => ctx.baseGoldPerWin(l);
    for (const l of [1, 5, 30, 100, 400, 1000, 5000]) for (const b of ctx.BALL_TYPES.filter(x => x.buyable)) {
        assert.equal(ctx.ballPrice(b, l), Math.max(b.basePrice, Math.ceil(b.winsPerBall * ctx.BALL_PRICE_MULT * gw(l))), `${b.id} @${l}`);
        assert.equal(legacy.ballPrice(b, l), Math.max(b.basePrice, Math.ceil(b.winsPerBall * gw(l))), `${b.id} @${l} sem a flag`);
        assert.ok(ctx.ballPrice(b, l) >= legacy.ballPrice(b, l));
    }
    assert.equal(ctx.ballPrice(ctx.getBallType('masterball'), 100), null);
    assert.deepEqual(plain(ctx.BALL_TYPES.filter(b => b.buyable).map(b => b.basePrice)), [1, 3, 6]);
    assert.equal(ctx.BALL_STACK_MAX, 99);
    assert.ok(ctx.BALL_PRICE_MULT > 5 && ctx.BALL_PRICE_MULT <= 12, `×${ctx.BALL_PRICE_MULT} (ponto de partida ×5, ajustado pelas medições)`);
});

test('M5: em rotas compatíveis do nível 30 as bolas custam 6–10% do ouro (mediana do conjunto, 1 h do Fast Driver)', () => {
    const tool = require('../tools/calibrate-f910');
    const rows = tool.compatibleSet(30), b = rows.map(r => r.ballPct).sort((x, y) => x - y);
    assert.ok(rows.length >= 3, `${rows.length} rotas`);
    const med = b[b.length >> 1];
    assert.ok(med >= 6 && med <= 10, `mediana ${med.toFixed(1)}% (min ${b[0].toFixed(1)}, max ${b[b.length - 1].toFixed(1)})`);
});

// =============================================================== saves
test('saves: nenhum campo novo no save (schema inalterado) — um save de antes da fase carrega com a calibração ligada', () => {
    const { ctx, game } = cal();
    assert.equal(ctx.SAVE_SCHEMA_VERSION, 3);
    const text = game.exportSave();
    const again = cal().game.importSave(text);
    assert.equal(again.success, true);
    const legacy = newGame().game;
    assert.deepEqual(Object.keys(game.gameState), Object.keys(legacy.gameState), 'as mesmas chaves do save, com a calibração ligada ou desligada');
});
