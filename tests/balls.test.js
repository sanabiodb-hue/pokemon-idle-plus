'use strict';
// F9.4: inventário e loja de Poké Bolas. As bolas ainda NÃO influenciam a captura: catálogo, inventário salvo (campo aditivo), compra atômica pela
// loja existente e a prova de que captura, combate e RNG ficaram idênticos ao código de antes da fase.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { newGame, createMemoryStorage } = require('./helpers/game');
const { makeFakeDom, makeUi } = require('./helpers/fake-dom');
const { runOnline, runFast, digest } = require('./helpers/capture-golden');

const plain = (o) => JSON.parse(JSON.stringify(o));
const IDS = ['pokeball', 'greatball', 'ultraball'];
const goldPerWin = (lvl) => Math.max(1, Math.floor(Math.sqrt(Math.max(1, lvl)) * 2));          // fórmula independente (ouro base por vitória)

// Estado observável de uma compra: dinheiro, inventário, livro-caixa e eventos (para provar atomicidade)
function snap(game, ev) { const gs = game.gameState; return JSON.stringify({ gold: gs.gold, inv: gs.inventory, eco: gs.economy, totalGold: gs.stats.totalGold, events: ev.length }); }
function boot(opts = {}) {
    const g = newGame({ seed: opts.seed ?? 5, storage: opts.storage, load: opts.load });
    const ev = [];
    g.game.bus.on('*', (e) => ev.push(e));
    return { ...g, ev };
}

// =============================================================== A. catálogo
test('F9.4 A: catálogo — 4 bolas, ids únicos, preços positivos, multiplicadores guardados, Master Bola não comprável', () => {
    const { ctx } = newGame();
    const B = ctx.BALL_TYPES;
    assert.equal(B.length, 4);
    assert.equal(JSON.stringify(B.map(b => b.id)), JSON.stringify(['pokeball', 'greatball', 'ultraball', 'masterball']));
    assert.equal(new Set(B.map(b => b.id)).size, 4);
    for (const b of B) {
        assert.ok(typeof b.name === 'string' && b.name.length > 0 && typeof b.icon === 'string');
        assert.ok(Number.isFinite(b.catchMultiplier) && b.catchMultiplier >= 1, `${b.id}: multiplicador guardado`);
        assert.equal(typeof b.buyable, 'boolean');
    }
    for (const b of B.filter(b => b.buyable)) assert.ok(Number.isInteger(b.basePrice) && b.basePrice > 0 && b.winsPerBall > 0, `${b.id}: preço positivo`);
    const master = B.find(b => b.id === 'masterball');
    assert.equal(master.buyable, false);
    assert.equal(ctx.ballPrice(master, 5), null, 'Master Bola não tem preço de loja');
    assert.equal(JSON.stringify(B.filter(b => b.buyable).map(b => b.basePrice)), JSON.stringify([1, 3, 6]), 'pisos recalibrados na F9.5 (~10% do ouro por vitória)');
    assert.deepEqual(plain(B.map(b => b.catchMultiplier)), [1, 1.5, 2, 255]);
    assert.equal(ctx.BALL_STACK_MAX, 99);
    for (const [n, id] of [['Poké Bola', 'pokeball'], ['Great Bola', 'greatball'], ['Ultra Bola', 'ultraball'], ['Master Bola', 'masterball']]) assert.equal(B.find(b => b.id === id).name, n);
});

test('F9.4 A: a loja lista só as bolas compráveis (a Master Bola não aparece) junto da poção, com pacotes 1 e 10', () => {
    const { game } = boot();
    const items = game.getShopItems();
    assert.equal(JSON.stringify(items.map(i => i.id)), JSON.stringify(['potion', ...IDS]));
    for (const id of IDS) {
        const it = items.find(i => i.id === id);
        assert.equal(JSON.stringify(it.packs), JSON.stringify([1, 10]));
        assert.equal(it.capacity, 99); assert.equal(it.stock, 0); assert.equal(it.room, 99);
    }
    assert.equal(items.find(i => i.id === 'potion').packs.length, 3, 'a poção mantém seus pacotes 1/5/10');
});

// =============================================================== B. funções puras e preço
test('F9.4 B: preço = max(piso, ⌈vitórias × ouro por vitória⌉) — piso no começo, acompanha o progresso depois (fórmula independente)', () => {
    const { ctx } = newGame();
    const [pk, gr, ul] = ctx.BALL_TYPES;
    for (const lvl of [1, 5, 25, 50, 100, 400, 1000, 5000, 9999]) {
        assert.equal(ctx.ballPrice(pk, lvl), Math.max(1, Math.ceil(0.1 * goldPerWin(lvl))), `Poké Lv${lvl}`);
        assert.equal(ctx.ballPrice(gr, lvl), Math.max(3, Math.ceil(0.3 * goldPerWin(lvl))), `Great Lv${lvl}`);
        assert.equal(ctx.ballPrice(ul, lvl), Math.max(6, Math.ceil(0.6 * goldPerWin(lvl))), `Ultra Lv${lvl}`);
    }
    assert.deepEqual([ctx.ballPrice(pk, 5), ctx.ballPrice(gr, 5), ctx.ballPrice(ul, 5)], [1, 3, 6], 'começo: preços recalibrados');
    assert.ok(ctx.ballPrice(pk, 5000) > 1 && ctx.ballPrice(ul, 5000) > 6, 'tarde: acompanha o progresso (nunca vira de graça)');
    assert.equal(ctx.ballPrice(null, 5), null);
});

test('F9.4 B: adicionar respeita o limite; consumir nunca fica abaixo de 0; as funções não alteram o objeto recebido', () => {
    const { ctx } = newGame();
    const add = ctx.ballInventoryAdd, use = ctx.ballInventoryConsume;
    const base = Object.freeze({ pokeball: 95 });
    let r = add(base, 'pokeball', 10);
    assert.deepEqual([r.ok, r.added, r.count, r.balls.pokeball], [true, 4, 99, 99], 'só cabem 4');
    assert.equal(base.pokeball, 95, 'o recebido não muda');
    r = add({ pokeball: 99 }, 'pokeball', 1); assert.deepEqual([r.ok, r.added, r.count], [true, 0, 99]);
    r = add(undefined, 'greatball', 3); assert.deepEqual([r.ok, r.count, JSON.stringify(r.balls)], [true, 3, '{"greatball":3}']);
    for (const bad of [0, -1, 1.5, '3', NaN, null, undefined, Infinity]) assert.equal(add({}, 'pokeball', bad).code, 'invalid_quantity', String(bad));
    for (const id of ['xball', '', null, 7, 'constructor', '__proto__']) assert.equal(add({}, id, 1).code, 'unknown_ball', String(id));
    r = use({ pokeball: 3 }, 'pokeball', 2); assert.deepEqual([r.ok, r.consumed, r.count], [true, 2, 1]);
    r = use({ pokeball: 3 }, 'pokeball', 3); assert.deepEqual([r.ok, r.count], [true, 0]);
    r = use({ pokeball: 2 }, 'pokeball', 3); assert.deepEqual([r.ok, r.code, r.have], [false, 'insufficient_balls', 2], 'tudo ou nada');
    r = use({}, 'pokeball'); assert.equal(r.ok, false);
    assert.equal(use({ pokeball: 5 }, 'pokeball').count, 4, 'consumo padrão = 1');
    for (const bad of [0, -2, 0.5, '1']) assert.equal(use({ pokeball: 5 }, 'pokeball', bad).code, 'invalid_quantity', String(bad));
});

test('F9.4 B: pelo jogo — inventário só ganha a chave "balls" na primeira bola e a perde ao zerar (saves sem bolas ficam idênticos)', () => {
    const { game } = boot();
    assert.equal('balls' in game.gameState.inventory, false);
    assert.deepEqual(plain(game.getBalls()), {});
    assert.equal(game.addBalls('pokeball', 5).added, 5);
    assert.equal(game.getBallCount('pokeball'), 5);
    assert.equal(game.consumeBall('pokeball', 5).ok, true);
    assert.equal('balls' in game.gameState.inventory, false, 'zerou: a chave some');
    assert.equal(game.consumeBall('pokeball', 1).ok, false);
    assert.equal(game.getBallCount('pokeball'), 0, 'nunca abaixo de 0');
    assert.equal(game.addBalls('foo', 1).ok, false);
});

// =============================================================== C. compra (loja existente)
test('F9.4 C: compra com sucesso — debita exatamente preço × qtd, entrega, registra no livro-caixa e emite money_spent + ball_bought', () => {
    const { game, ev } = boot();
    game.earnMoney(10_000, 'reward');
    const price = game.getShopItems().find(i => i.id === 'greatball').price;
    const before = game.getMoney(), evBefore = ev.length;
    const r = game.buyShopItem('greatball', 10);
    assert.deepEqual([r.ok, r.qty, r.unitPrice, r.total, r.stock, r.clamped], [true, 10, price, price * 10, 10, false]);
    assert.equal(game.getMoney(), before - price * 10);
    assert.equal(game.getBallCount('greatball'), 10);
    assert.equal(game.gameState.economy.byReason.ball_purchase.spent, price * 10);
    const fresh = ev.slice(evBefore);
    assert.deepEqual(fresh.map(e => e.type), ['money_spent', 'ball_bought']);
    assert.deepEqual([fresh[0].reason, fresh[0].amount, fresh[0].item, fresh[0].qty], ['ball_purchase', price * 10, 'greatball', 10]);
    assert.deepEqual([fresh[1].item, fresh[1].qty, fresh[1].unitPrice, fresh[1].total, fresh[1].stock], ['greatball', 10, price, price * 10, 10]);
    assert.equal(game.buyShopItem('pokeball', 1).ok, true);
});

test('F9.4 C: toda recusa é atômica — o estado fica IDÊNTICO (dinheiro, inventário, livro-caixa, eventos)', () => {
    const { game, ev } = boot();
    game.earnMoney(30, 'reward');
    game.addBalls('pokeball', 99);
    game.getProgressLevel();       // aquece o cache derivado economy.progressLevel (máximo já alcançado; é escrito na 1ª consulta de preço, com ou sem compra)
    const cases = [
        ['saldo insuficiente', () => game.buyShopItem('ultraball', 10), 'insufficient_funds'],
        ['estoque cheio', () => game.buyShopItem('pokeball', 1), 'capacity_full'],
        ['id inexistente', () => game.buyShopItem('xball', 1), 'unknown_item'],
        ['"bola"', () => game.buyShopItem('bola', 1), 'unknown_item'],
        ['constructor', () => game.buyShopItem('constructor', 1), 'unknown_item'],
        ['__proto__', () => game.buyShopItem('__proto__', 1), 'unknown_item'],
        ['Master Bola', () => game.buyShopItem('masterball', 1), 'not_buyable'],
        ['quantidade 0', () => game.buyShopItem('greatball', 0), 'invalid_quantity'],
        ['quantidade negativa', () => game.buyShopItem('greatball', -3), 'invalid_quantity'],
        ['quantidade fracionária', () => game.buyShopItem('greatball', 2.5), 'invalid_quantity'],
        ['quantidade texto', () => game.buyShopItem('greatball', '5'), 'invalid_quantity'],
        ['quantidade NaN', () => game.buyShopItem('greatball', NaN), 'invalid_quantity'],
        ['quantidade nula', () => game.buyShopItem('greatball', null), 'invalid_quantity'],
        ['quantidade enorme', () => game.buyShopItem('greatball', 1001), 'invalid_quantity'],
        ['id numérico', () => game.buyShopItem(7, 1), 'unknown_item'],
    ];
    for (const [name, run, code] of cases) {
        const before = snap(game, ev);
        const r = run();
        assert.equal(r.ok, false, name); assert.equal(r.code, code, name);
        assert.equal(snap(game, ev), before, `${name}: estado idêntico depois da falha`);
    }
    game._isOfflineSimulating = true;
    const before = snap(game, ev);
    assert.equal(game.buyShopItem('greatball', 1).code, 'busy');
    assert.equal(snap(game, ev), before);
    game._isOfflineSimulating = false;
});

test('F9.4 C: limite por item — compra além do espaço leva só o que cabe (e paga só isso); no limite recusa', () => {
    const { game } = boot();
    game.earnMoney(100_000, 'reward');
    game.addBalls('pokeball', 95);
    const price = game.getShopItems().find(i => i.id === 'pokeball').price, money = game.getMoney();
    const r = game.buyShopItem('pokeball', 10);
    assert.deepEqual([r.ok, r.qty, r.clamped, r.stock, r.total], [true, 4, true, 99, price * 4]);
    assert.equal(game.getMoney(), money - price * 4, 'paga só as 4 que couberam');
    assert.equal(game.getBallCount('pokeball'), 99);
    assert.equal(game.buyShopItem('pokeball', 1).code, 'capacity_full');
    for (let i = 0; i < 5; i++) game.buyShopItem('greatball', 99);
    assert.equal(game.getBallCount('greatball'), 99, 'nunca passa do limite');
});

test('F9.4 C: compra exata no saldo e saldo de 1 a menos', () => {
    const { game } = boot();
    const price = game.getShopItems().find(i => i.id === 'pokeball').price;
    game.earnMoney(price - 1, 'reward');
    assert.equal(game.buyShopItem('pokeball', 1).code, 'insufficient_funds');
    game.earnMoney(1, 'reward');
    assert.equal(game.buyShopItem('pokeball', 1).ok, true);
    assert.equal(game.getMoney(), 0);
});

// =============================================================== D. save
const KEY = 'pokemon_idle_save';
function rewrite(a, mutate) {
    a.game.saveNow();
    const raw = a.ctx.SaveCodec.decodePayload(a.storage.getItem(KEY));
    mutate(raw);
    a.storage.setItem(KEY, a.ctx.SaveCodec.encodePayload(JSON.stringify(raw)));
    return newGame({ seed: 9, load: true, storage: a.storage });
}

test('F9.4 D: ida e volta no save; versão do save segue 3; sem bolas o inventário salvo é idêntico ao de antes (sem a chave)', () => {
    const a = boot();
    a.game.earnMoney(5000, 'reward');
    a.game.buyShopItem('pokeball', 7); a.game.buyShopItem('ultraball', 2);
    a.game.saveNow();
    const b = newGame({ seed: 4, load: true, storage: a.storage });
    assert.deepEqual(plain(b.game.getBalls()), { pokeball: 7, ultraball: 2 });
    assert.equal(b.game.getPotions(), a.game.getPotions());
    assert.equal(b.ctx.SAVE_SCHEMA_VERSION, 3);
    const c = boot(); c.game.saveNow();
    const raw = c.ctx.SaveCodec.decodePayload(c.storage.getItem(KEY));
    assert.equal(JSON.stringify(raw.inventory), JSON.stringify({ potions: 10 }), 'save sem bolas: inventário idêntico ao de antes');
});

test('F9.4 D: inventário ausente, malformado, com ids desconhecidos e com quantidades inválidas é sanitizado sem erro', () => {
    const cases = [
        ['sem o campo', (r) => { delete r.inventory.balls; }, {}],
        ['texto', (r) => { r.inventory.balls = 'x'; }, {}],
        ['lista', (r) => { r.inventory.balls = [1, 2]; }, {}],
        ['número', (r) => { r.inventory.balls = 7; }, {}],
        ['nulo', (r) => { r.inventory.balls = null; }, {}],
        ['ids desconhecidos', (r) => { r.inventory.balls = { fooball: 5, pokeball: 3, constructor: 4, __proto__: 6 }; }, { pokeball: 3 }],
        ['quantidades inválidas', (r) => { r.inventory.balls = { pokeball: -1, greatball: 2.5, ultraball: '7', masterball: NaN }; }, {}],
        ['acima do limite', (r) => { r.inventory.balls = { pokeball: 1000, greatball: 99, ultraball: 100 }; }, { pokeball: 99, greatball: 99, ultraball: 99 }],
        ['zero omitido e Master conhecida', (r) => { r.inventory.balls = { pokeball: 0, masterball: 1 }; }, { masterball: 1 }],
        ['infinito', (r) => { r.inventory.balls = { pokeball: 1e999 }; }, {}],
    ];
    for (const [name, mutate, expected] of cases) {
        const a = boot();
        const b = rewrite(a, mutate);
        assert.equal(b.game.loadReport.ok, true, `${name}: carrega`);
        assert.equal(b.game.loadReport.source, 'main', `${name}: leu o save principal (não um backup)`);
        assert.deepEqual(plain(b.game.getBalls()), expected, name);
        assert.deepEqual(plain(b.game.gameState.inventory.balls || {}), expected, `${name}: o valor SALVO no estado (não só o lido) já está limpo`);
        assert.equal(b.game.getPotions(), 10, `${name}: poções intactas`);
    }
});

test('F9.4 D: saves antigos (v1 e v2) carregam com inventário de bolas vazio e sem a chave', () => {
    const FIX = path.join(__dirname, 'fixtures');
    for (const f of ['legacy-localstorage.txt', 'legacy-v2-localstorage.txt']) {
        const storage = createMemoryStorage({ pokemon_idle_save: fs.readFileSync(path.join(FIX, f), 'utf8') });
        const g = newGame({ storage, load: true });
        assert.equal(g.game.loadReport.ok, true, f);
        assert.deepEqual(plain(g.game.getBalls()), {}, f);
        assert.equal(g.game.gameState.inventory.balls, undefined, f);
        assert.ok(g.game.getPotions() >= 0);
    }
});

// =============================================================== E. captura, combate e RNG intactos
// Referência: resumos calculados no código do HEAD ANTERIOR à fase (árvore extraída do commit 0858cfd) para 3 sementes, online e Fast Driver.
const GOLDEN = {
    online1: '5be083f13ab14b8b0cd31bd7260d19f41ad96c50', fast1: '9db1fd2246c27bb02135acdb8ca1cb02659f9ae8',
    online2: '8e4cd176886f02df3c31b370a91e95ddb095dc5b', fast2: '3a22fe8030d6c5849e723b1dd59e1d6ea70af4a7',
    online3: 'de00a7fcdf25b91c590de138322b9bc889d3c0df', fast3: 'e1025f80fc028bcdd2512d7bf570cb515c97b85b',
};
test('F9.4 E: captura, taxa de shiny, combate e a sequência do RNG são idênticos ao baseline (online e Fast Driver, 3 sementes, 80 batalhas cada)', () => {
    for (const seed of [1, 2, 3]) {
        assert.equal(digest(runOnline(newGame, { seed })), GOLDEN['online' + seed], `online, semente ${seed}`);
        assert.equal(digest(runFast(newGame, { seed })), GOLDEN['fast' + seed], `Fast Driver, semente ${seed}`);
    }
});

test('F9.4 E: ter bolas no inventário não muda nada na captura nem no RNG (as bolas ainda não são consumidas)', () => {
    const balls = { pokeball: 50, greatball: 20, ultraball: 5, masterball: 1 };
    for (const seed of [1, 2]) {
        const on = runOnline(newGame, { seed, balls }), fast = runFast(newGame, { seed, balls });
        assert.equal(digest(on), GOLDEN['online' + seed], `online ${seed}`);
        assert.equal(digest(fast), GOLDEN['fast' + seed], `fast ${seed}`);
        assert.deepEqual(plain(on.game.getBalls()), balls, 'nada foi consumido (online)');
        assert.deepEqual(plain(fast.game.getBalls()), balls, 'nada foi consumido (offline)');
    }
});

// =============================================================== F. interface (loja existente da aba Caça)
function setupUi() {
    const g = newGame({ seed: 3 });
    const dom = makeFakeDom(g.ctx);
    const ui = makeUi(g.game);
    const view = new g.ctx.HuntView(ui);
    view.render();
    return { ...g, dom, ui, view };
}

test('F9.4 F: a loja mostra as 3 bolas (sem Master), preço, quantidade possuída e "Saldo insuficiente"; comprar atualiza quantidade e saldo', () => {
    const { dom, game, view, ui } = setupUi();
    view.showSection('shop');
    const t = () => dom.text('hunt-shop');
    for (const n of ['Poké Bola', 'Great Bola', 'Ultra Bola']) assert.match(t(), new RegExp(n));
    assert.doesNotMatch(t(), /Master Bola/);
    assert.match(t(), /Estoque: 0 ?\/99/);
    assert.match(t(), /Saldo insuficiente: faltam/);
    assert.match(dom.html('hunt-shop'), /data-item="pokeball" data-qty="1" disabled/, 'sem saldo: desabilitado');
    assert.match(t(), /Cada tentativa de captura gasta uma bola/i);
    game.earnMoney(1000, 'reward');
    view.renderSection();
    assert.doesNotMatch(dom.html('hunt-shop'), /data-item="pokeball" data-qty="1" disabled/);
    const price = game.getShopItems().find(i => i.id === 'pokeball').price;
    view.eco.handleAction('buy-item', { item: 'pokeball', qty: '10' });
    assert.equal(game.getBallCount('pokeball'), 10);
    assert.equal(game.getMoney(), 1000 - price * 10);
    assert.match(t(), /Estoque: 10 ?\/99/);
    view.eco.handleAction('buy-item', { item: 'masterball', qty: '1' });
    assert.equal(game.getBallCount('masterball'), 0, 'Master Bola não é comprável');
    assert.ok(ui.toasts.length >= 2);
});

test('F9.4 F: com o estoque cheio a loja mostra "Estoque cheio" e desabilita a compra', () => {
    const { dom, game, view } = setupUi();
    game.earnMoney(1_000_000, 'reward');
    game.addBalls('greatball', 99);
    view.showSection('shop');
    assert.match(dom.text('hunt-shop'), /Estoque cheio/);
    assert.match(dom.html('hunt-shop'), /data-item="greatball" data-qty="1" disabled/);
});
