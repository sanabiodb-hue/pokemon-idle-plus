'use strict';
// F7.8: o estado da caçada mostrado na UI vem só do estado autoritativo (WorldEncounters.status()), é somente leitura e não
// mexe na lógica nem no offline. GameCore REAL + ManualClock.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame } = require('./helpers/game');
const { loadWorld } = require('./helpers/world-env');

const SPECIES = 25;
function setup() {
    const { game, ctx } = newGame({ seed: 7 });
    game.clock = new ctx.ManualClock(1_000_000);
    const world = loadWorld();
    return { game, world, enc: new world.WorldEncounters(game) };
}

test('F7.8 status: sem ciclo é neutro; com ciclo reflete espécie, sessão e fase da caminhada', () => {
    const { game, enc } = setup();
    let s = enc.status();
    assert.equal(s.active, false); assert.equal(s.speciesId, null); assert.equal(s.phase, 'none'); assert.equal(s.offline, false);
    enc.begin(SPECIES);
    s = enc.status();
    assert.equal(s.active, true); assert.equal(s.speciesId, SPECIES); assert.equal(s.sessionState, 'running'); assert.equal(s.phase, 'approaching');
    assert.ok(s.lengthPx > 0 && s.progressPx >= 0 && s.progressPx <= s.lengthPx);
    game.clock.advance(1000);
    const t = enc.status();
    assert.ok(t.progressPx >= s.progressPx, 'o progresso nunca anda para trás');
});

test('F7.8 status: é somente leitura — chamar muitas vezes não altera o ciclo, o relógio nem os timers', () => {
    const { game, enc } = setup();
    enc.begin(SPECIES);
    game.clock.advance(1500);
    const before = JSON.stringify({ c: enc.current, leg: enc.cycle.leg, timers: game.clock.pendingTimers(), now: game.now() });
    const first = JSON.stringify(enc.status());
    for (let i = 0; i < 50; i++) enc.status();
    assert.equal(JSON.stringify(enc.status()), first);
    assert.equal(JSON.stringify({ c: enc.current, leg: enc.cycle.leg, timers: game.clock.pendingTimers(), now: game.now() }), before);
});

test('F7.8 status: sessão pausada aparece como pausada e o progresso congela', () => {
    const { game, enc } = setup();
    enc.begin(SPECIES);
    game.clock.advance(1000);
    game.dispatchAutomationAction({ type: 'PAUSE_HUNT' });
    const a = enc.status();
    assert.equal(a.sessionState, 'paused');
    game.clock.advance(5000);
    assert.equal(enc.status().progressPx, a.progressPx);
});

test('F7.8 status: durante o modo offline reporta offline e o ciclo não é conduzido pela UI', () => {
    const { game, enc } = setup();
    enc.begin(SPECIES);
    game._isOfflineSimulating = true;
    assert.equal(enc.status().offline, true);
    game._isOfflineSimulating = false;
});
