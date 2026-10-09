'use strict';
// F7.8: a simulação offline da caçada do mundo não depende da view. Mesmo estado inicial + mesmo intervalo, em quatro configurações:
// sem view (só a lógica), view montada e visível, view escondida (onHide) e view montada com quadros pendentes.
// GameCore REAL + ManualClock + WorldView REAL sobre DOM/Canvas falsos (helpers/world-env). Não existe "destruir" a view: o ciclo de vida
// real é onShow/onHide, então "escondida" (onHide) é a configuração inativa que a arquitetura permite.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame, runOffline, plain } = require('./helpers/game');
const { loadWorld, shown } = require('./helpers/world-env');

const SPECIES = 25, OFFLINE_MS = 15 * 60 * 1000;

// Conta escritas na DOM falsa (textContent/hidden/style/atributos) para provar que o laço offline não toca a interface
function instrumentDom(env) {
    const writes = { n: 0, log: [] };
    for (const [name, el] of Object.entries({ status: env.encounterStatus, caption: env.caption, message: env.message, hint: env.hint, box: env.encounterBox, btn: env.encounterBtn, bar: env.encounterBar, destination: env.destination })) {
        for (const prop of ['textContent', 'hidden', 'disabled', 'value']) {
            let v = el[prop];
            Object.defineProperty(el, prop, { get() { return v; }, set(x) { if (x !== v) { writes.n++; writes.log.push(`${name}.${prop}`); } v = x; }, configurable: true });
        }
        const orig = el.setAttribute;
        el.setAttribute = function (k, x) { writes.n++; writes.log.push(`${name}@${k}`); return orig ? orig.call(this, k, x) : undefined; };
    }
    return writes;
}

async function scenario(kind) {
    const { game, ctx } = newGame({ seed: 21 });
    game.clock = new ctx.ManualClock(3_000_000);
    let env = null, view = null, enc, writes = null;
    if (kind === 'absent') {
        enc = new (loadWorld().WorldEncounters)(game);
    } else {
        const r = await shown({ gameObject: game, encounters: true, globals: { getPokemonSpriteUrl: (id) => `sprites/pokemon/${id}.png` } });
        ({ env, view } = r); enc = r.encounters;
        view.openHuntMap(SPECIES); env.flush();
    }
    enc.begin(SPECIES);
    game.clock.advance(4000);
    if (env) { view.requestRedraw(true); env.flush(); }
    if (kind === 'hidden') { view.onHide(); }
    let notified = 0;
    // mesmo canal que a view usa para pedir quadros. Só conta avisos com o laço offline em curso (enc._offline): o aviso único de
    // onOfflineEnd (retomada, depois do laço) e o battle_started pós-restart são legítimos e acontecem fora dele.
    enc.onChange(() => { if (enc._offline) notified++; });
    let counters = null;
    if (env) {
        writes = instrumentDom(env);
        counters = { draws: env.draws.length, fills: env.fills, frames: env.frames.length };
    }
    const data = await runOffline(game, OFFLINE_MS);
    const notifiedDuring = notified;
    // frames = pedidos de quadro registrados (sem flush no meio, o vetor só cresce); notified = avisos que a view receberia
    const during = env ? { draws: env.draws.length - counters.draws, fills: env.fills - counters.fills, frames: env.frames.length - counters.frames,
        dom: writes.n, domLog: writes.log.slice(0, 5), notified: notifiedDuring } : null;
    const session = game.getHuntSession();
    const logical = JSON.stringify({
        battles: data.battles, summary: plain(data.summary), money: game.gameState.money,
        exp: plain(game.gameState.caughtPokemon[25] || null), hp: data.battleHpAtEnd,
        session: plain(session && { state: session.state, activeMs: session.activeMs, stats: session.stats, world: session.world }),
        now: game.now(),
    });
    return { logical, during, data, view, env, game, enc };
}

test('F7.8 isolamento offline (UI real): mesmo estado e mesmo intervalo dão o mesmo resultado lógico sem view, com view visível e com view escondida', async () => {
    const absent = await scenario('absent'), mounted = await scenario('mounted'), hidden = await scenario('hidden');
    assert.ok(absent.data.battles > 10, `a caçada offline precisa ter rodado de verdade (${absent.data.battles} batalhas)`);
    assert.equal(mounted.logical, absent.logical, 'view visível não muda o resultado');
    assert.equal(hidden.logical, absent.logical, 'view escondida não muda o resultado');
    const again = await scenario('absent');
    assert.equal(again.logical, absent.logical, 'repetível');
});

test('F7.8 isolamento offline (UI real): durante o laço offline nenhum quadro é pedido, nada é desenhado e a DOM não é escrita', async () => {
    for (const kind of ['mounted', 'hidden']) {
        const { during } = await scenario(kind);
        assert.deepEqual(during, { draws: 0, fills: 0, frames: 0, dom: 0, domLog: [], notified: 0 }, kind);
    }
});
