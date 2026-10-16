'use strict';
// F9.4: cenário determinístico (captura, combate e RNG, online e Fast Driver) usado para provar que uma mudança NÃO tocou a captura nem a sequência
// do RNG: o resumo (hash) calculado no código de antes da fase tem de ser igual ao de agora. `newGame` vem do helper da árvore que se quer medir.
const crypto = require('node:crypto');

function scenario(newGame, { seed, balls = null } = {}) {
    const g = newGame({ seed });
    const { game, ctx } = g;
    game.clock = new ctx.ManualClock(10_000_000);
    const route = { id: 'kanto_route1', name: 'Golden', levelRange: [3, 3], pokemon: [{ id: 19, weight: 10, levelRange: [3, 3] }, { id: 16, weight: 6, levelRange: [3, 3] }, { id: 150, weight: 1, levelRange: [3000, 3000] }] };
    game.getRoute = () => route;
    game.getShinyRate = () => 0.08;                                 // taxa alta: shinies e capturas variadas
    const lead = game._partyInstance(0); lead.level = 400; game._touchInstance(lead);
    if (balls) { const inv = game.ensureInventory(); inv.balls = { ...balls }; }       // com bolas no inventário (F9.4): nada pode mudar
    const pol = game.getAutomationPolicy(); pol.heal = { ...pol.heal, enabled: false }; game.setAutomationPolicy(pol);
    game.dispatchAutomationAction({ type: 'START_HUNT' });
    game.stopBattle(); game.gameState.currentEnemy = null; delete game.gameState.battleHp;
    if (game._nextBattleTimeout) { clearTimeout(game._nextBattleTimeout); game._nextBattleTimeout = null; game._nextBattleScheduledAt = null; }
    if (game.healTimer) { clearTimeout(game.healTimer); clearInterval(game.healTimer); game.healTimer = null; }
    const log = { rng: [], enemies: [], results: [], captures: [] };
    const baseRng = game.rng; game.rng = () => { const v = baseRng.call(game); log.rng.push(v); return v; };
    const make = game.createWildPokemon.bind(game);
    game.createWildPokemon = (...a) => { const w = make(...a); log.enemies.push([w.id, w.level, !!w.isShiny, JSON.stringify(w.ivs)]); return w; };
    game.bus.on('battle_completed', (e) => log.results.push(e.result));
    game.bus.on('capture_attempted', (e) => log.captures.push(['attempt', e.id, e.decision, e.reason, e.grade]));
    game.bus.on('pokemon_captured', (e) => log.captures.push(['captured', e.id, e.newIndividual, e.firstCatch]));
    game.bus.on('capture_skipped', (e) => log.captures.push(['skipped', e.id, e.reason]));
    return { game, ctx, log };
}

function digest(t) {
    const gs = t.game.gameState;
    const state = { catches: gs.stats.totalCatches, battles: gs.stats.totalBattles, gold: gs.gold, owned: Object.keys(gs.ownedPokemon).length, pokedex: gs.pokedex, shinyDex: gs.shinyDex };
    return crypto.createHash('sha1').update(JSON.stringify({ log: t.log, state })).digest('hex');
}

function runOnline(newGame, opts) {
    const t = scenario(newGame, opts), { game, log } = t;
    for (let i = 0; i < 80; i++) {
        if (!game.startBattle()) throw new Error('startBattle recusado');
        game._stopBattleTimer(); game.currentBattle.lastTick = game.now();
        const before = log.results.length;
        for (let k = 0; k < 200000 && log.results.length === before; k++) { game.clock.advance(50); game.battleTick(); }
        if (game._nextBattleTimeout) { clearTimeout(game._nextBattleTimeout); game._nextBattleTimeout = null; game._nextBattleScheduledAt = null; }
        if (game.healTimer) { clearTimeout(game.healTimer); clearInterval(game.healTimer); game.healTimer = null; }
        game.stopBattle(); game.gameState.currentEnemy = null; delete game.gameState.battleHp;
    }
    return t;
}

function runFast(newGame, opts) {
    const t = scenario(newGame, opts), { game } = t;
    const total = 24 * 3600 * 1000, s = game._buildFastSimState(total, total);
    game._getNextBattleDelay = () => 0;
    for (let i = 0; i < 80; i++) if (!game._fastBattleStep(s)) throw new Error('passo recusado');
    return t;
}

module.exports = { runOnline, runFast, digest };
