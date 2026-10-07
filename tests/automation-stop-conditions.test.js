'use strict';
// Fase 5A · B8: condições de parada e política de rota
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, ivs, plain } = require('./helpers/game');

const hunt = (game, policy, extra = {}) => {
    if (policy) assert.equal(game.setAutomationPolicy(policy).ok, true);
    assert.equal(game.dispatchAutomationAction({ type: 'START_HUNT', ...extra }).ok, true);
    return game.getHuntSession();
};
const win = (game, id = 19, level = 3, shiny = false) => game._processVictoryRewards(Object.assign(game.createWildPokemon(id, level, 0), { isShiny: shiny }), 25, 100, 100);
const completeRoute = (game, routeId) => {
    for (const p of game.getRoute(routeId).pokemon) {
        if (!game.gameState.caughtPokemon[p.id]) game.catchPokemonWithIvs(p.id, 1, ivs(31));
        game.gameState.caughtPokemon[p.id].ivs = ivs(31);
        game.gameState.shinyDex[p.id] = true;
    }
};

test('battleLimit: para exatamente na batalha N com motivo e mensagem', () => {
    const { game } = newGame({ seed: 51 });
    const s = hunt(game, { stopConditions: { battleLimit: 7 } });
    for (let i = 0; i < 12; i++) win(game);
    assert.equal(s.state, 'stopped');
    assert.equal(s.stats.battles, 7);
    assert.equal(game.getHuntSession().stopReason, 'battle_limit');
});

test('timeLimit: usa o relógio da sessão e ignora o tempo em pausa', () => {
    const { game, ctx } = newGame({ seed: 52 });
    const clock = new ctx.ManualClock(1_000_000);
    game.clock = clock;
    const s = hunt(game, { stopConditions: { timeLimitMinutes: 10 } });
    clock.advance(9 * 60_000);
    win(game);
    assert.equal(s.state, 'running');
    clock.advance(61_000);
    win(game);
    assert.equal(s.state, 'stopped');
    assert.equal(s.stopReason, 'time_limit');
    assert.equal(ctx.huntStopMessage(s), 'Caça encerrada: limite de 10 minutos atingido.');
});

test('shinyFound: ligado, a caçada para ao derrotar/capturar um shiny; desligado, continua', () => {
    for (const on of [true, false]) {
        const { game, ctx } = newGame({ seed: 53 });
        const s = hunt(game, { stopConditions: { shinyFound: on } });
        win(game); win(game);
        assert.equal(s.state, 'running');
        win(game, 16, 3, true);
        if (on) {
            assert.equal(s.state, 'stopped');
            assert.equal(s.stopReason, 'shiny_found');
            assert.equal(ctx.huntStopMessage(s), 'Caça encerrada: Shiny encontrado.');
            assert.equal(s.stats.shinies, 1, 'o shiny foi capturado antes de parar');
            assert.equal(game.roster.primaryOf(16).shiny, true);
        } else {
            assert.equal(s.state, 'running');
            assert.equal(s.stats.shinies, 1);
        }
    }
});

test('shinyFound: só vale para o shiny desta caçada (sem caçada, nada acontece)', () => {
    const { game } = newGame({ seed: 54 });
    win(game, 16, 3, true);                         // sem caçada: modo antigo
    const s = hunt(game, { stopConditions: { shinyFound: true } });
    win(game);
    assert.equal(s.state, 'running', 'o shiny de antes da caçada não conta');
});

test('routeComplete: via stopConditions.routeComplete ou route.mode=stopWhenComplete; rota incompleta não para', () => {
    for (const policy of [{ stopConditions: { routeComplete: true } }, { route: { mode: 'stopWhenComplete' } }]) {
        const { game, ctx } = newGame({ seed: 55 });
        const s = hunt(game, policy);
        win(game);
        assert.equal(s.state, 'running', 'rota ainda incompleta');
        completeRoute(game, 'kanto_route1');
        win(game);
        assert.equal(s.state, 'stopped');
        assert.equal(s.stopReason, 'route_complete');
        assert.equal(ctx.huntStopMessage(s), 'Caça encerrada: rota concluída.');
    }
});

test('routeComplete tem precedência sobre switchWhenComplete quando a condição está ligada', () => {
    const { game } = newGame({ seed: 56 });
    completeRoute(game, 'kanto_route1');
    const s = hunt(game, { route: { mode: 'switchWhenComplete' }, stopConditions: { routeComplete: true } });
    win(game);
    assert.equal(s.stopReason, 'route_complete');
    assert.equal(game.gameState.currentRoute, 'kanto_route1');
});

test('switchWhenComplete: usa findNextIncompleteRoute, troca pelo núcleo e continua caçando na nova rota', () => {
    const { game } = newGame({ seed: 57 });
    completeRoute(game, 'kanto_route1');
    const expected = game.findNextIncompleteRoute().routeId;
    const changes = [];
    game.bus.on('route_changed', (e) => changes.push(e));
    const s = hunt(game, { route: { mode: 'switchWhenComplete' } });
    win(game);
    assert.equal(game.gameState.currentRoute, expected);
    assert.equal(s.routeId, expected);
    assert.equal(s.state, 'running');
    assert.equal(changes.at(-1).reason, 'automation');
});

test('switchWhenComplete sem rota seguinte: para com route_complete', () => {
    const { game } = newGame({ seed: 58 });
    const s = hunt(game, { route: { mode: 'switchWhenComplete' } });
    game._isRouteCompleteByCondition = () => true;
    game.findNextIncompleteRoute = () => null;
    win(game);
    assert.equal(s.state, 'stopped');
    assert.equal(s.stopReason, 'route_complete');
});

test('stay: continua na rota mesmo concluída; as opções antigas não interferem durante a caçada e voltam depois', () => {
    const { game } = newGame({ seed: 59 });
    completeRoute(game, 'kanto_route1');
    game.gameState.settings.autoRouteSwitch = true;
    const s = hunt(game, { route: { mode: 'stay' } });
    win(game); win(game);
    assert.equal(game.gameState.currentRoute, 'kanto_route1');
    assert.equal(s.state, 'running');
    game.dispatchAutomationAction({ type: 'STOP_HUNT' });
    win(game);
    assert.notEqual(game.gameState.currentRoute, 'kanto_route1');
});

test('várias condições: a primeira satisfeita define o motivo; depois de parar nada mais é contado', () => {
    const { game } = newGame({ seed: 60 });
    const s = hunt(game, { stopConditions: { battleLimit: 3, shinyFound: true } });
    win(game, 16, 3, true);
    assert.equal(s.stopReason, 'shiny_found');
    win(game); win(game); win(game);
    assert.equal(s.stats.battles, 1);
});

test('política: condições desconhecidas/inválidas são recusadas; padrões desligados', () => {
    const { ctx } = newGame();
    const d = ctx.defaultAutomationPolicy();
    assert.deepEqual(plain(d.stopConditions), { timeLimitMinutes: 0, battleLimit: 0, shinyFound: false, routeComplete: false });
    assert.equal(ctx.validateAutomationPolicy({ stopConditions: { moneyTarget: 5 } }).errors[0].code, 'unknown_field');
    assert.equal(ctx.validateAutomationPolicy({ stopConditions: { shinyFound: 'sim' } }).errors[0].code, 'not_boolean');
    assert.equal(ctx.validateAutomationPolicy({ stopConditions: { timeLimitMinutes: -1 } }).ok, false);
    assert.equal(ctx.validateAutomationPolicy({ route: { mode: 'stop' } }).ok, false, "o nome antigo 'stop' virou stopWhenComplete");
});
