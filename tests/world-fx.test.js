'use strict';
// F8.4: transições e indicadores do encontro no mapa (entrada, alerta, combate, saída com desfecho, shiny, movimento reduzido, limpeza),
// mais o sprite da espécie-alvo na Central de Caça. GameCore REAL + ManualClock; efeitos guiados pelo relógio do jogo, sem timers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame } = require('./helpers/game');
const { shown, tick } = require('./helpers/world-env');

const RING = 'rgba(229,72,77,0.85)', GOLD = '#ffd23f';
const FX = { enter: 300, alert: 400, flash: 240, exit: 400, label: 900 };
const globals = { getPokemonSpriteUrl: (id) => `sprites/pokemon/${id}.png`, getShinyPokemonSpriteUrl: (id) => `sprites/pokemon/shiny/${id}.png` };

function kill(game) {
    const b = game.currentBattle;
    b.wildCurrentHp = 1; b.playerTimer = b.playerNextAttack; b.enemyTimer = 0;
    const saved = game.rng; game.rng = () => 0.99; game.battleTick(); game.rng = saved;
}
function lose(game) {
    const b = game.currentBattle;
    b.playerCurrentHp = 1; b.wildCurrentHp = b.wildMaxHp; b.enemyTimer = b.enemyNextAttack; b.playerTimer = 0;
    const saved = game.rng; game.rng = () => 0.5; game.battleTick(); game.rng = saved;
}
function chain(game) {
    if (game._nextBattleTimeout) { clearTimeout(game._nextBattleTimeout); game._nextBattleTimeout = null; game._nextBattleScheduledAt = null; }
    if (game.healTimer) { clearTimeout(game.healTimer); game.healTimer = null; }
    return game.startBattle();
}

async function boot(opts = {}) {
    const { game, ctx } = newGame({ seed: opts.seed ?? 11 });
    game.clock = new ctx.ManualClock(2_000_000);
    const r = await shown({ gameObject: game, encounters: true, globals, ...opts.shown });
    if (opts.reduced) r.env.reduced = true;
    r.view.openHuntMap(25); r.env.flush();
    r.game = game; r.ctx = ctx;
    r.redraw = () => { r.view.requestRedraw(true); r.env.flush(); };
    r.clear = () => { r.env.texts.length = 0; r.env.rects.length = 0; r.env.alphas.length = 0; r.env.draws.length = 0; };
    r.sprite = () => r.env.draws.filter(a => a.length === 5);
    r.alphas = () => r.env.draws.map((d, i) => (d.length === 5 ? r.env.alphas[i] : null)).filter(a => a !== null);   // opacidade de cada desenho de Pokémon (tiles e treinador têm 9 argumentos)
    r.hold = (on) => { if (on) { if (!r._sb) r._sb = game.startBattle; game.startBattle = () => null; } else if (r._sb) { game.startBattle = r._sb; r._sb = null; } };
    r.start = async () => { r.env.encounterBtn.fire('click'); r.env.flush(); await tick(); r.redraw(); };      // espera as imagens falsas carregarem
    r.toArrived = () => { r.hold(true); for (let i = 0; i < 80 && r.encounters.current.state === 'approaching'; i++) { game.clock.advance(1000); r.redraw(); } assert.equal(r.encounters.current.state, 'arrived'); };
    r.toBattle = () => { r.hold(false); chain(game); r.redraw(); assert.equal(r.encounters.current.state, 'battling'); };
    return r;
}
const ringCount = (r) => r.env.rects.filter(x => x[0] === RING).length;
const goldCount = (r) => r.env.rects.filter(x => x[0] === GOLD).length;
// cada rótulo é desenhado duas vezes (sombra + texto): pega só o texto principal
const subs = (game) => game.bus._listenerCount;
const mainTexts = (r) => r.env.texts.filter((t, i) => i % 2 === 1);
const labels = (r) => r.env.texts.filter((t, i) => i % 2 === 1).map(t => t[0]);

test('F8.4 entrada: o Pokémon surge com opacidade crescente por ~300 ms e depois fica opaco; sem efeito, sem quadros pendentes', async () => {
    const r = await boot();
    r.clear(); await r.start();
        await new Promise(res => setTimeout(res, 0)); r.redraw();
    r.clear(); r.redraw();
    assert.ok(r.alphas().length > 0 && r.alphas().at(-1) < 1, `início da entrada: alpha ${r.alphas().at(-1)}`);
    r.game.clock.advance(FX.enter / 2); r.clear(); r.redraw();
    assert.ok(r.alphas().at(-1) > 0 && r.alphas().at(-1) < 1, 'meio da entrada');
    r.game.clock.advance(FX.enter); r.clear(); r.redraw();
    assert.equal(r.alphas().at(-1), 1, 'fim: opaco');
    assert.equal(r.view._fx, null, 'efeito encerrado e descartado');
    assert.equal(r.view._fxRunning(), false, 'nenhum efeito em andamento');
});

test('F8.4 chegada e combate: "!" por ~400 ms na chegada; piscar na entrada em batalha; anel de combate estático enquanto durar', async () => {
    const r = await boot();
    await r.start(); r.toArrived();
    assert.ok(labels(r).includes('!'), 'alerta na chegada');
    assert.equal(ringCount(r), 0, 'sem anel antes da batalha');
    r.game.clock.advance(FX.alert + 50); r.clear(); r.redraw();
    assert.ok(!labels(r).includes('!'), 'alerta some');
    r.toBattle();
    assert.ok(ringCount(r) >= 1, 'anel de combate');
    assert.ok(r.alphas().some(a => a < 1), 'piscar ao começar');
    r.game.clock.advance(FX.flash + 50); r.clear(); r.redraw();
    assert.equal(r.alphas().at(-1), 1);
    assert.ok(ringCount(r) >= 1, 'anel continua (estático) durante a batalha');
    assert.equal(r.view._fxRunning(), false, 'combate em curso não mantém efeito/laço de quadros');
    assert.equal(r.env.pending(), 0, 'e nenhum quadro agendado (o treinador está parado)');
    assert.equal(r.view._fx, null);
});

test('F8.4 vitória: o Pokémon sobe e some por ~400 ms com o rótulo do desfecho por ~900 ms; depois nada sobra', async () => {
    const r = await boot();
    await r.start(); r.toArrived(); r.toBattle();
    r.game.clock.advance(1000); r.redraw();
    r.view._capture = null;
    const lastId = r.encounters.current.id;
    kill(r.game);
    r.clear(); r.redraw();
    assert.notEqual(r.encounters.current.id, lastId, 'o ciclo já escolheu o próximo ponto');
    const exitLabels = labels(r).filter(t => t === 'Vitória' || t === 'Capturado!');
    assert.equal(exitLabels.length, 1, `rótulo de desfecho: ${labels(r)}`);
    assert.ok(r.view._fx && r.view._fx.exit, 'efeito de saída ativo');
    r.game.clock.advance(FX.exit / 2); r.clear(); r.redraw();
    const ex = r.alphas().filter(a => a < 1);
    assert.ok(ex.length >= 1, 'sprite saindo com opacidade parcial');
    assert.ok(r.sprite().every(d => d.slice(1).every(Number.isInteger)), 'coordenadas inteiras também durante a transição');
    r.game.clock.advance(FX.exit); r.clear(); r.redraw();
    assert.equal(labels(r).filter(t => t === 'Vitória' || t === 'Capturado!').length, 1, 'rótulo continua até ~900 ms');
    r.game.clock.advance(FX.label); r.clear(); r.redraw();
    assert.deepEqual(labels(r).filter(t => t === 'Vitória' || t === 'Capturado!'), []);
    assert.ok(!(r.view._fx && r.view._fx.exit), 'sem saída ativa');
    assert.equal(r.view._fxRunning(), false, 'nenhum efeito em andamento');
});

test('F8.4 desfecho vem de eventos reais: captura → "Capturado!", vitória sem captura → "Vitória", derrota → "Derrota", parar → sem rótulo', async () => {
    // captura real (modo legado captura sempre)
    let r = await boot();
    await r.start(); r.toArrived(); r.toBattle();
    kill(r.game); r.clear(); r.redraw();
    assert.deepEqual(labels(r).filter(t => /Vitória|Capturado|Derrota/.test(t)), ['Capturado!'], 'pokemon_captured precede battle_completed');
    // vitória sem captura: o evento de captura não existe para esta espécie
    r = await boot();
    await r.start(); r.toArrived(); r.toBattle();
    r.game.bus.on('pokemon_defeated', () => { r.view._capture = null; });
    kill(r.game); r.view._capture = null; r.clear(); r.redraw();
    assert.deepEqual(labels(r).filter(t => /Vitória|Capturado|Derrota/.test(t)), ['Vitória']);
    // derrota
    r = await boot();
    await r.start(); r.toArrived(); r.toBattle();
    lose(r.game); r.clear(); r.redraw();
    assert.deepEqual(labels(r).filter(t => /Vitória|Capturado|Derrota/.test(t)), ['Derrota']);
    // parar a caçada: saída sem rótulo
    r = await boot();
    await r.start(); r.toArrived();
    r.game.dispatchAutomationAction({ type: 'STOP_HUNT' });
    r.encounters.cancel('hunt_stopped'); r.clear(); r.redraw();
    assert.deepEqual(labels(r).filter(t => /Vitória|Capturado|Derrota/.test(t)), []);
    assert.ok(r.view._fx && r.view._fx.exit && r.view._fx.exit.label === null, 'saída sem rótulo');
});

test('F8.4 shiny: brilho dourado e "Shiny!" no status só com inimigo shiny da espécie do encontro (inclusive com movimento reduzido)', async () => {
    for (const reduced of [false, true]) {
        const r = await boot({ reduced });
        await r.start(); r.toArrived();
        r.game.currentBattle = null; r.game.gameState.currentEnemy = { id: 25, isShiny: false };
        r.game.clock.advance(1000); r.clear(); r.redraw();
        assert.equal(goldCount(r), 0, 'normal: sem brilho');
        assert.doesNotMatch(r.env.encounterStatus.textContent, /Shiny/);
        r.game.gameState.currentEnemy = { id: 25, isShiny: true };
        r.clear(); r.redraw();
        assert.ok(goldCount(r) >= 2, `shiny: brilho desenhado (reduced=${reduced})`);
        assert.match(r.env.encounterStatus.textContent, /Shiny!/);
        r.game.gameState.currentEnemy = { id: 4, isShiny: true };      // shiny de OUTRA espécie não conta
        r.clear(); r.redraw();
        assert.equal(goldCount(r), 0);
    }
});

test('F8.4 movimento reduzido: sem fade, sem piscar, sem "!"; saída instantânea com rótulo estático; anel e desfecho continuam', async () => {
    const r = await boot({ reduced: true });
    r.clear(); await r.start();
    r.clear(); r.redraw();
    assert.ok(r.alphas().length > 0 && r.alphas().every(a => a === 1), 'entrada sem fade');
    assert.ok(!(r.view._fx && r.view._fx.enter), 'sem entrada animada');
    r.toArrived();
    assert.ok(!labels(r).includes('!'), 'sem alerta animado');
    r.toBattle();
    assert.ok(r.alphas().every(a => a === 1), 'sem piscar');
    assert.ok(ringCount(r) >= 1, 'o indicador de combate continua');
    r.view._capture = null;
    kill(r.game); r.clear(); r.redraw();
    const first = mainTexts(r).filter(t => /Vitória|Capturado|Derrota/.test(t[0]));
    assert.equal(first.length, 1, 'rótulo de desfecho presente');
    const nSprites = r.sprite().length;                 // só o Pokémon do próximo encontro; o que saiu não é desenhado
    r.game.clock.advance(FX.exit / 2); r.clear(); r.redraw();
    const mid = mainTexts(r).filter(t => /Vitória|Capturado|Derrota/.test(t[0]));
    assert.equal(mid.length, 1);
    assert.equal(mid[0][2], first[0][2], 'rótulo parado (sem subir)');
    assert.ok(r.sprite().length <= nSprites);
    r.game.clock.advance(FX.label); r.clear(); r.redraw();
    assert.equal(mainTexts(r).filter(t => /Vitória|Capturado|Derrota/.test(t[0])).length, 0);
});

test('F8.4 limpeza: esconder a aba, trocar de mapa, parar e remontar descartam efeitos, observação e quadro agendado', async () => {
    // esconder a aba no meio da saída
    let r = await boot();
    await r.start(); r.toArrived(); r.toBattle(); kill(r.game); r.redraw();
    assert.ok(r.view._fx);
    const withView = subs(r.game);
    r.view.onHide();
    assert.equal(r.view._fx, null); assert.equal(r.view._seen, null); assert.equal(r.view._raf, null);
    assert.equal(withView - subs(r.game), 2, 'as duas assinaturas da view (route_changed e pokemon_captured) foram soltas');
    r.env.flush(); assert.equal(r.env.pending(), 0);
    // remontar: primeira observação só ressincroniza (nenhum efeito, mesmo com o encontro em curso)
    r.view.onShow(); r.env.flush();
    assert.equal(r.view._fx, null, 'sem efeitos ao reabrir');
    assert.equal(subs(r.game), withView, 'sem assinaturas duplicadas');
    r.view.onShow(); r.view.onShow();
    assert.equal(subs(r.game), withView);
    // aba do navegador escondida (pode ter havido offline): sem efeitos ao voltar
    r = await boot();
    await r.start(); r.toArrived();
    r.view.requestRedraw(true); r.env.flush();
    r.env.document.hidden = true; r.env.fire && 0;
    for (const f of [...(r.env.listeners.visibilitychange || [])]) f();
    assert.equal(r.view._seen, null);
    r.toBattle();
    r.env.document.hidden = false;
    for (const f of [...(r.env.listeners.visibilitychange || [])]) f();
    r.env.flush();
    assert.equal(r.view._fx, null, 'transições durante a ausência não viram animação');
    // trocar de mapa no meio do efeito
    r = await boot();
    await r.start(); r.toArrived(); r.toBattle(); kill(r.game); r.redraw();
    assert.ok(r.view._fx && r.view._fx.exit);
    r.view.openHuntMap(150); r.env.flush();
    assert.equal(r.view._fx, null, 'outro mapa: efeito descartado');
});

test('F8.4 sem timers próprios nem laço ocioso: um ciclo completo não cria setTimeout/setInterval na view e termina sem quadros pendentes', async () => {
    let timers = 0;
    const counting = { ...globals, setTimeout: (...a) => { timers++; return setTimeout(...a); }, setInterval: (...a) => { timers++; return setInterval(...a); } };
    const r = await boot({ shown: { globals: counting } });
    const t0 = timers;
    await r.start(); r.toArrived(); r.toBattle(); kill(r.game); r.redraw();
    r.game.clock.advance(FX.label + 100); r.redraw();
    r.game.clock.advance(5000); r.redraw();
    assert.equal(r.view._fx, null);
    assert.equal(r.view._fxRunning(), false);
    assert.equal(timers - t0, 0, `timers criados pela view: ${timers - t0}`);
});

test('F8.4 o motor não muda: a sequência de eventos e o resultado são idênticos com a view visível e sem ela', async () => {
    const run = async (withView) => {
        const { game, ctx } = newGame({ seed: 11 });
        game.clock = new ctx.ManualClock(2_000_000);
        const ev = []; game.bus.on('*', (e) => ev.push(e.type + (e.result ? ':' + e.result : '')));
        let r;
        if (withView) { r = await shown({ gameObject: game, encounters: true, globals }); r.view.openHuntMap(25); r.env.flush(); r.env.encounterBtn.fire('click'); r.env.flush(); }
        else { const world = require('./helpers/world-env').loadWorld(); r = { encounters: new world.WorldEncounters(game) }; r.encounters.begin(25); }
        for (let i = 0; i < 80 && r.encounters.current.state === 'approaching'; i++) { game.clock.advance(1000); if (withView) { r.view.requestRedraw(true); r.env.flush(); } else r.encounters.hunterState({ id: 'hunt_25' }); r.encounters._advance(game.now()); }
        chain(game); kill(game);
        return { ev, outcome: r.encounters.lastResult && r.encounters.lastResult.outcome };
    };
    const a = await run(true), b = await run(false);
    assert.deepEqual(a.ev, b.ev);
    assert.equal(a.outcome, b.outcome);
});

// ---- Central de Caça: sprite da espécie-alvo
test('F8.4 Central: mostra o sprite da espécie-alvo (nunca outra), só reescreve ao mudar a espécie e cai para "#id" se a imagem falhar', () => {
    const { makeFakeDom, makeUi } = require('./helpers/fake-dom');
    const { loadWorld } = require('./helpers/world-env');
    const g = newGame({ seed: 5 });
    g.game.clock = new g.ctx.ManualClock(10_000_000);
    const dom = makeFakeDom(g.ctx);
    const ui = makeUi(g.game);
    ui.worldEncounters = new (loadWorld().WorldEncounters)(g.game);
    ui.worldView = { openHuntMap: () => ({ ok: true }) };
    const view = new g.ctx.HuntView(ui);
    view.render();
    assert.equal(dom.html('hunt-target-sprite'), '', 'sem alvo: sem imagem');
    view._targetId = 25; view.render();
    const html = dom.html('hunt-target-sprite');
    assert.match(html, /src="sprites\/pokemon\/25\.png"/);
    assert.doesNotMatch(html, /pokemon\/(?!25\.png)/);
    assert.match(html, /textContent='#25'/, 'fallback visível com o número');
    dom.node('hunt-target-sprite').innerHTML = html + '<!--marca-->';
    view.renderTarget(); view.renderTarget(); view.renderLive();
    assert.match(dom.html('hunt-target-sprite'), /<!--marca-->/, 'repetir a renderização não recria a imagem');
    view._targetId = 150; view.renderTarget();
    assert.match(dom.html('hunt-target-sprite'), /pokemon\/150\.png/);
    assert.doesNotMatch(dom.html('hunt-target-sprite'), /marca|pokemon\/25\.png/);
    view.onHide(); view.onShow();
    assert.match(dom.html('hunt-target-sprite'), /pokemon\/150\.png/, 'remontar mostra a espécie correta');
});

test('F8.4 o último quadro: se o efeito acaba entre o desenho e a decisão de continuar, ainda sai um quadro que limpa o resíduo e o laço termina', async () => {
    const r = await boot();
    await r.start();
    r.game.clock.advance(100); r.redraw();
    assert.ok(r.view._fx && r.view._fx.enter, 'entrada em andamento');
    const orig = r.view.draw.bind(r.view);
    r.view.draw = function () { orig(); r.game.clock.advance(5000); };      // o relógio passa do fim do efeito logo depois do desenho
    r.view._raf = null;
    r.view._frame(0);
    r.view.draw = orig;
    assert.equal(r.view._fx, null, 'efeito descartado');
    assert.ok(r.env.pending() >= 1, 'um quadro final foi agendado');
    r.clear(); r.env.flush();
    assert.equal(r.alphas().at(-1), 1, 'o quadro final desenha opaco (sem resíduo de fade)');
});

test('F8.4 encontro cancelado: a saída não tem rótulo e termina em ~400 ms', async () => {
    const r = await boot();
    await r.start(); r.toArrived();
    r.game.dispatchAutomationAction({ type: 'STOP_HUNT' });
    r.encounters.cancel('hunt_stopped'); r.redraw();
    assert.ok(r.view._fx && r.view._fx.exit && r.view._fx.exit.label === null);
    r.game.clock.advance(FX.exit + 10); r.redraw();
    assert.equal(r.view._fx, null);
});
