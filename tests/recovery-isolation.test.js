'use strict';
// F7.8: (1) recuperação após derrota — a duração lógica ONLINE (ticks reais de startHealingAfterDefeat) é a mesma que a
// definição oficial defeatHealMs usada pelo Fast Driver offline; (2) a simulação offline é isolada da UI: o mesmo estado
// inicial e o mesmo intervalo dão o mesmo resultado com ou sem observadores, e nenhum evento/DOM/quadro é tocado no laço.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, dispose, ivs, plain, runOffline } = require('./helpers/game');

function onlineHealMs(game, maxHp, currentHp = 0) {
    let tick = null, ticks = 0;
    game._workerSetInterval = (fn) => { tick = fn; return 1; };
    game._clearHealTimer = () => { tick = null; };
    game.currentBattle = { playerMaxHp: maxHp, playerCurrentHp: currentHp };
    game.gameState.currentEnemy = null;
    game.startBattle = () => true;
    game.save = () => {};
    game.startHealingAfterDefeat();
    while (tick && ticks < 10000) { ticks++; tick(); }
    return ticks * 1000;
}

test('F7.8 recuperação: duração online (ticks reais) == defeatHealMs, para vários HP máximos', () => {
    const { game, ctx } = newGame({ seed: 1 });
    for (const maxHp of [1, 4, 5, 10, 33, 50, 99, 100, 137, 250, 999, 4000]) {
        assert.equal(onlineHealMs(game, maxHp), ctx.defeatHealMs(maxHp, 0), `maxHp ${maxHp}`);
    }
    dispose(game);
});

test('F7.8 recuperação: defeatHealMs é monotônico, nunca negativo, e 0 sem HP máximo', () => {
    const { game, ctx } = newGame({ seed: 1 });
    assert.equal(ctx.defeatHealMs(0, 0), 0);
    assert.equal(ctx.defeatHealMs(-5, 0), 0);
    assert.equal(ctx.defeatHealMs(100, 100), 0, 'cheio: nada a curar');
    assert.equal(ctx.defeatHealMs(100, 500), 0, 'HP acima do máximo não vira tempo negativo');
    let prev = 0;
    for (let hp = 0; hp <= 100; hp += 10) { const v = ctx.defeatHealMs(100, 100 - hp); assert.ok(v >= prev); prev = v; }
    assert.equal(ctx.defeatHealMs(100, 0), 5000, '20%/s → 5 s');
    dispose(game);
});

test('F7.8 recuperação: com HP parcial o online também coincide com a definição', () => {
    const { game, ctx } = newGame({ seed: 1 });
    for (const [maxHp, hp] of [[100, 40], [137, 1], [250, 249]]) assert.equal(onlineHealMs(game, maxHp, hp), ctx.defeatHealMs(maxHp, hp));
    dispose(game);
});

function prepared(seed, withObservers) {
    const { game, ctx } = newGame({ seed });
    game.catchPokemonWithIvs(4, 12, ivs(10));
    game.gameState.team = [4];
    game.gameState.activePokemonIndex = 0;
    game._invalidateAllCaches();
    const spy = { events: 0 };
    if (withObservers) {
        game.bus.on('*', () => { spy.events++; });
        game.encounterHook = null;
    }
    return { game, ctx, spy };
}
const outcome = (g, data) => JSON.stringify({ battles: data.battles, summary: plain(data.summary), exp: plain(g.gameState.caughtPokemon[4]), money: g.gameState.money, hp: data.battleHpAtEnd });

test('F7.8 isolamento offline: mesmo estado e mesmo intervalo => mesmo resultado, com ou sem observadores montados', async () => {
    const A = prepared(7, false), B = prepared(7, true), C = prepared(7, false);
    const [a, b, c] = [await runOffline(A.game, 10 * 60 * 1000), await runOffline(B.game, 10 * 60 * 1000), await runOffline(C.game, 10 * 60 * 1000)];
    assert.ok(a.battles > 10);
    assert.equal(outcome(A.game, a), outcome(B.game, b), 'observadores não mudam o resultado');
    assert.equal(outcome(A.game, a), outcome(C.game, c), 'repetível');
    [A, B, C].forEach(x => dispose(x.game));
});

test('F7.8 isolamento offline: o laço não emite eventos de interface (nenhum callback com o laço rodando)', async () => {
    const { game } = prepared(9, false);
    const seen = [];
    const prev = game.onBattleEvent;
    game.onBattleEvent = (event, data) => { if (game._isOfflineSimulating) seen.push(event); return prev && prev.call(game, event, data); };
    await runOffline(game, 5 * 60 * 1000);
    assert.deepEqual(seen, [], `eventos de UI durante o laço offline: ${seen.slice(0, 5)}`);
    dispose(game);
});

test('F7.8 isolamento offline: sem ouvintes no barramento, os eventos do laço nem são emitidos', async () => {
    const { game } = prepared(11, false);
    let emitted = 0;
    const orig = game.bus.emit.bind(game.bus);
    game.bus.emit = (...a) => { if (game._isOfflineSimulating) emitted++; return orig(...a); };
    await runOffline(game, 5 * 60 * 1000);
    assert.equal(emitted, 0, 'durante o laço, sem observadores o _emit curto-circuita');
    dispose(game);
});

test('F7.8 recuperação offline (Fast Driver): cada derrota gasta exatamente defeatHealMs e o tempo simulado fecha com o intervalo', async () => {
    const { game, ctx } = newGame({ seed: 3 });
    game.catchPokemonWithIvs(4, 15, ivs(10));
    game.gameState.caughtPokemon[4].exp = ctx.getExpForLevel('mediumSlow', 15);
    game.gameState.team = [4];
    game.gameState.activePokemonIndex = 0;
    game._invalidateAllCaches();
    const spends = [], heals = [];
    const spend = game._fastSpend.bind(game);
    game._fastSpend = (s, ms) => { spends.push(ms); return spend(s, ms); };
    const step = game._fastBattleStep.bind(game);
    game._fastBattleStep = (s) => {
        const inst = game._partyInstance(0), faints = inst.stats.faints, maxHp = s.playerStats.hp, n = spends.length;
        const r = step(s);
        if (inst.stats.faints > faints) heals.push({ spent: spends[spends.length - 1], expected: ctx.defeatHealMs(maxHp, 0), calls: spends.length - n });
        return r;
    };
    const total = 10 * 60 * 1000;
    await runOffline(game, total);
    assert.ok(heals.length >= 10, `o cenário precisa ter derrotas de verdade (${heals.length})`);
    for (const h of heals) assert.equal(h.spent, h.expected, 'a espera da derrota é a duração oficial');
    const sum = spends.reduce((a, b) => a + b, 0);
    assert.ok(sum >= total && sum < total + 20000, `o tempo gasto (${sum} ms) fecha com o intervalo (${total} ms) mais, no máximo, o último passo`);
    dispose(game);
});
