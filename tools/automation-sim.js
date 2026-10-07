'use strict';
// Monta partidas "sem cabeça" para o simulador de caça (testes e benchmark). Só Node.
// Nada de timers reais, nada de escrita em save: o jogo roda inteiro pelo driver rápido.
const { loadGameContext, createMemoryStorage } = require('./load-context');

let sharedCtx = null;
function getContext() {
    if (!sharedCtx) sharedCtx = loadGameContext({ storage: createMemoryStorage() });
    return sharedCtx;
}

// opts: { ctx, seed, startTime, policy, routeId, starterLevel, party:[{speciesId, level, ivs}], potions, shinyRate, start }
function createSimGame(opts = {}) {
    const ctx = opts.ctx || getContext();
    const game = new ctx.GameCore();
    game._simMode = true;
    game.guideAutoUpdate = false;
    game.rng = ctx.createSimulationRng(opts.seed ?? 1);
    game.clock = new ctx.SimulationClock(opts.startTime ?? 1_700_000_000_000);
    game.initNewGame();
    game.stopBattle();

    const setLevel = (inst, lv) => {
        inst.level = lv;
        inst.exp = ctx.getExpForLevel(ctx.POKEMON_DATA[inst.speciesId].expGroup, lv);
        game._touchSpecies(inst.speciesId);
    };
    if (opts.starterLevel) setLevel(game.roster.primaryOf(25), opts.starterLevel);
    for (const m of opts.party || []) {
        const iv = m.ivs || { hp: 15, atk: 15, def: 15, spAtk: 15, spDef: 15, speed: 15 };
        game.catchPokemonWithIvs(m.speciesId, 1, iv);
        setLevel(game.roster.primaryOf(m.speciesId), m.level || 5);
        game.addToTeamFromPokedex(m.speciesId);
    }
    if (opts.routeId) game.gameState.currentRoute = opts.routeId;
    if (opts.potions !== undefined) game.gameState.inventory.potions = opts.potions;
    if (opts.shinyRate !== undefined) game.getShinyRate = () => opts.shinyRate;
    if (opts.policy) {
        const r = game.setAutomationPolicy(opts.policy);
        if (!r.ok) throw new Error('política inválida: ' + JSON.stringify(r.errors));
    }
    if (opts.start !== false) {
        const r = game.dispatchAutomationAction({ type: 'START_HUNT' });
        if (!r.ok) throw new Error('START_HUNT falhou: ' + JSON.stringify(r));
    }
    return { ctx, game };
}

module.exports = { createSimGame, getContext };
