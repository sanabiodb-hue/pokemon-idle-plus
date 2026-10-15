'use strict';
// F9.2: Pokémon líder seguindo o treinador no mapa (só visual). Rastro por distância percorrida, atraso em passos, parada junto com o treinador,
// ordem de desenho por profundidade, sprite próprio (cache, troca de líder sem piscar, shiny, falha) e limpeza. Sem timers; sem quadros ociosos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { newGame } = require('./helpers/game');
const { shown, tick } = require('./helpers/world-env');

const globals = { getPokemonSpriteUrl: (id) => `sprites/pokemon/${id}.png`, getShinyPokemonSpriteUrl: (id) => `sprites/pokemon/shiny/${id}.png` };
const LAG = 2 * 16;                                              // WORLD_FOLLOWER.lagSteps × tile
const K = 0.25;                                                  // WORLD_FOLLOWER.scale
const dispatch = (game, type, extra = {}) => game.dispatchAutomationAction({ type, ...extra });

async function boot(opts = {}) {
    const { game, ctx } = newGame({ seed: opts.seed ?? 11 });
    game.clock = new ctx.ManualClock(2_000_000);
    if (opts.shiny) game.gameState.ownedPokemon[game.gameState.party[0]].shiny = true;
    const r = await shown({ gameObject: game, encounters: true, globals, ...opts.shown });
    r.game = game; r.ctx = ctx;
    r.redraw = () => { r.view.requestRedraw(true); r.env.flush(); };
    r.clear = () => { r.env.draws.length = 0; };
    r.leaderUrl = () => { const g = game.gameState, u = g.ownedPokemon[g.party[g.activePokemonIndex]]; return `sprites/pokemon/${u.shiny ? 'shiny/' : ''}${u.speciesId}.png`; };
    r.folDraws = (url) => r.env.draws.filter(a => a.length === 5 && a[0]._src === (url || r.leaderUrl()));
    r.spriteImages = (re) => r.env.images.filter(i => re.test(i._src || '')).length;
    r.addMember = (speciesId) => { const x = game.roster.create({ speciesId, level: 5, place: 'party' }); assert.ok(x.ok); return x.instance; };
    await tick(); r.redraw();
    return r;
}
const city = (r) => r.view.currentScene().map;

// =============================================================== A. rastro e atraso (determinístico, sem canvas)
test('F9.2 A: o seguidor fica exatamente N passos atrás ao longo do CAMINHO (inclusive nas curvas) e para junto com o treinador', async () => {
    const r = await boot();
    const map = { id: 'm1' };
    const P = (x, y, d, dir = 'right') => ({ x, y, distance: d, dir, moving: true });
    const fp = (p) => r.view._followerPoint(map, p);
    let f = fp(P(100, 100, 0));
    assert.deepEqual([f.x, f.y], [100 - LAG, 100], 'parado no início: fica atrás, no sentido oposto ao do olhar');
    for (let d = 1; d <= 50; d++) { f = fp(P(100 + d, 100, d)); assert.ok(Math.abs(f.x - (100 + d - LAG)) < 1e-9 && f.y === 100, `reta d=${d}`); }
    for (let d = 51; d <= 100; d++) fp(P(150, 100 + (d - 50), d, 'down'));
    f = fp(P(150, 130, 80, 'down'));                              // (mesma posição que o passo d=80: não move a posição)
    assert.ok(Math.abs(f.x - 150) < 1e-9, 'depois da curva o seguidor ainda passa pelo canto (x=150)');
    f = fp(P(150, 150, 100, 'down'));
    assert.ok(Math.abs(f.x - 150) < 1e-9 && Math.abs(f.y - (150 - LAG)) < 1e-9, `na reta final: ${JSON.stringify(f)}`);
    const walk = (d) => fp(P(150, 100 + (d - 50), d, 'down'));
    const at40 = (() => { const t = { id: 'm2' }; let q; for (let d = 0; d <= 40; d++) q = r.view._followerPoint(t, P(100 + d, 100, d)); return q; })();
    assert.ok(Math.abs(at40.x - (140 - LAG)) < 1e-9);
    // curva exata: hero a 20 px depois do canto → seguidor ainda 12 px ANTES do canto, sobre o primeiro trecho
    const t3 = { id: 'm3' };
    for (let d = 0; d <= 50; d++) r.view._followerPoint(t3, P(100 + d, 100, d));
    let q; for (let d = 51; d <= 70; d++) q = r.view._followerPoint(t3, P(150, 100 + (d - 50), d, 'down'));
    assert.ok(Math.abs(q.x - 138) < 1e-9 && q.y === 100, `no trecho antigo (d=${70 - LAG}): ${JSON.stringify(q)}`);
    // parou: nenhuma amostra nova, o seguidor não se move
    const s1 = r.view._followerPoint(t3, P(150, 120, 70, 'down')), s2 = r.view._followerPoint(t3, P(150, 120, 70, 'down'));
    assert.deepEqual(s1, s2, 'treinador parado → seguidor parado (não alcança)');
    assert.ok(r.view._trail.pts.length <= LAG + 4, `o rastro é podado: só guarda ~N passos (${r.view._trail.pts.length} amostras)`);
    assert.ok(walk);
});

test('F9.2 A: teletransporte, nova caçada (distância recomeça) e troca de mapa recomeçam o rastro atrás do treinador', async () => {
    const r = await boot();
    const P = (x, y, d, dir = 'down') => ({ x, y, distance: d, dir, moving: true });
    const m = { id: 'a' };
    for (let d = 0; d <= 60; d++) r.view._followerPoint(m, P(10, 10 + d, d));
    let f = r.view._followerPoint(m, P(400, 300, 61));                // salto de ~300 px com 1 px de distância
    assert.deepEqual([f.x, f.y], [400, 300 - LAG], 'teletransporte: recomeça atrás');
    for (let d = 62; d <= 100; d++) r.view._followerPoint(m, P(400, 300 + (d - 61), d));
    f = r.view._followerPoint(m, P(400, 330, 0));                      // a distância voltou a 0 (novo ciclo de caçada)
    assert.deepEqual([f.x, f.y], [400, 330 - LAG], 'distância menor que a anterior: novo rastro');
    const lastA = r.view._trail.pts.at(-1);
    r.view._followerPoint({ id: 'c' }, P(lastA.x, lastA.y + 1, lastA.d + 1));       // mesma continuidade de posição/distância, mas OUTRO mapa
    assert.equal(r.view._trail.mapId, 'c', 'o rastro não atravessa mapas');
    assert.equal(r.view._trail.pts.length, 2);
    r.view._followerPoint({ id: 'b' }, P(5, 5, 3));
    assert.equal(r.view._trail.mapId, 'b', 'outro mapa: outro rastro');
    assert.equal(r.view._trail.pts.length, 2);
});

// =============================================================== B. desenho: sprite, proporção, âncora
test('F9.2 B: desenha o sprite do líder com o fator próprio, proporção preservada e a base do conteúdo opaco no ponto do seguidor', async () => {
    for (const [w, h, box] of [[96, 96, { x0: 20, y0: 30, x1: 75, y1: 70 }], [128, 128, { x0: 0, y0: 0, x1: 127, y1: 127 }], [96, 95, { x0: 30, y0: 10, x1: 60, y1: 94 }]]) {
        const r = await boot();
        r.env.imageSize = { w, h }; r.env.alpha = box;
        r.view._clearFollower(); r.env.images.length = 0;
        r.redraw(); await tick(); r.clear(); r.redraw();
        const d = r.folDraws();
        assert.equal(d.length, 1, `${w}x${h}: um desenho do seguidor`);
        const z = r.view.lastMetrics.zoom, pt = r.view._followerPoint(city(r), r.view._player(city(r)));
        assert.equal(d[0][3], Math.round(w * K * z)); assert.equal(d[0][4], Math.round(h * K * z));
        const at = r.world.worldToScreen(r.view.lastCamera, r.view.lastMetrics, pt.x, pt.y);
        const cx = d[0][1] + (box.x0 + box.x1 + 1) / 2 * K * z, by = d[0][2] + (box.y1 + 1) * K * z;
        assert.ok(Math.abs(cx - at.x) <= 1.01 && Math.abs(by - at.y) <= 1.01, `âncora: (${cx},${by}) vs (${at.x},${at.y})`);
        for (const v of d[0].slice(1)) assert.ok(Number.isInteger(v), 'coordenadas inteiras');
    }
});

test('F9.2 B: sprite normal ou shiny conforme a instância do líder', async () => {
    let r = await boot({ shiny: false });
    assert.equal(r.folDraws('sprites/pokemon/25.png').length > 0 || r.spriteImages(/\/pokemon\/25\.png$/) > 0, true);
    assert.equal(r.spriteImages(/shiny/), 0);
    r = await boot({ shiny: true });
    assert.ok(r.spriteImages(/shiny\/25\.png$/) >= 1, 'líder shiny usa o PNG shiny');
    assert.equal(r.spriteImages(/\/pokemon\/25\.png$/), 0, 'e não o normal');
});

// =============================================================== C. troca de líder, cache e limpeza
test('F9.2 C: troca de líder sem piscar (o anterior fica até o novo carregar), uma imagem por líder e nada de entrada antiga', async () => {
    const r = await boot();
    const second = r.addMember(4);
    const urlA = 'sprites/pokemon/25.png', urlB = 'sprites/pokemon/4.png';
    r.clear(); for (let i = 0; i < 30; i++) r.redraw();
    assert.equal(r.spriteImages(/\/pokemon\/25\.png$/), 1, 'repetir quadros não recarrega o sprite');
    r.game.gameState.activePokemonIndex = r.game.gameState.party.indexOf(second.uid);
    r.game._emit('pokemon_switched', { index: 1 });                  // o evento oficial agenda o redesenho
    r.clear(); r.redraw();                                            // antes de a imagem nova carregar
    assert.equal(r.folDraws(urlA).length, 1, 'sem piscar: o líder anterior continua sendo desenhado');
    assert.equal(r.folDraws(urlB).length, 0);
    await tick(); r.clear(); r.redraw();
    assert.equal(r.folDraws(urlB).length, 1, 'o novo líder aparece');
    assert.equal(r.folDraws(urlA).length, 0, 'e o antigo some');
    assert.equal(r.view._fol.prev, null, 'nenhuma entrada antiga retida');
    for (let i = 0; i < 20; i++) r.redraw();
    assert.equal(r.spriteImages(/\/pokemon\/4\.png$/), 1);
    assert.equal(r.spriteImages(/\/pokemon\/25\.png$/), 1, 'o antigo não foi pedido de novo');
});

test('F9.2 C: falha ao carregar o novo líder não deixa a espécie antiga na tela nem desenha outra', async () => {
    const r = await boot();
    const second = r.addMember(4);
    r.env.failUrls.add('sprites/pokemon/4.png');
    r.game.gameState.activePokemonIndex = r.game.gameState.party.indexOf(second.uid);
    r.game._emit('pokemon_switched', {});
    r.env.flush(); await tick(); r.clear(); r.redraw();
    assert.equal(r.folDraws().length, 0, 'sem imagem do líder: nada desenhado');
    assert.equal(r.folDraws('sprites/pokemon/25.png').length, 0, 'nunca a espécie antiga');
    assert.equal(r.view._fol.prev, null);
});

test('F9.2 C: evolução do líder (evento evolution) atualiza o seguidor; sem líder ou sem time nada é desenhado e nada quebra', async () => {
    const r = await boot();
    const inst = r.game.gameState.ownedPokemon[r.game.gameState.party[0]];
    inst.speciesId = 26;                                              // Raichu
    r.game._emit('evolution', { uid: inst.uid, from: 25, to: 26 });
    r.env.flush(); await tick(); r.clear(); r.redraw();
    assert.equal(r.folDraws('sprites/pokemon/26.png').length, 1);
    r.game.gameState.party = []; r.game.gameState.team = [];
    r.clear(); r.redraw();
    assert.equal(r.folDraws('sprites/pokemon/26.png').length, 0, 'sem líder: sem seguidor');
    assert.equal(r.view._fol, null, 'e sem entrada retida');
});

test('F9.2 C: esconder a aba, remontar, trocar de mapa e parar a caçada limpam o seguidor e o rastro', async () => {
    const r = await boot();
    assert.ok(r.view._fol && r.view._trail, 'seguidor e rastro existem');
    r.view.onHide();
    assert.equal(r.view._fol, null); assert.equal(r.view._trail, null);
    r.env.images.length = 0;
    r.view.onShow(); r.env.flush(); await tick(); r.redraw();
    assert.equal(r.spriteImages(/\/pokemon\/25\.png$/), 1, 'remontar pede o sprite uma vez');
    // trocar de mapa → outro rastro
    const before = r.view._trail;
    r.view.openHuntMap(150); r.env.flush();
    assert.notEqual(r.view._trail, before); assert.equal(r.view._trail.mapId, r.view.currentScene().map.id);
    // parar a caçada: o rastro recomeça junto do treinador
    r.env.encounterBtn.fire('click'); r.env.flush();
    assert.ok(r.encounters.cycle);
    for (let i = 0; i < 6; i++) { r.game.clock.advance(1500); r.redraw(); }
    const trailDuring = r.view._trail;
    dispatch(r.game, 'STOP_HUNT'); r.encounters.cancel('hunt_stopped'); r.redraw();
    assert.notEqual(r.view._trail, trailDuring, 'rastro novo depois de parar');
    // aba do navegador escondida
    r.env.document.hidden = true;
    for (const f of [...(r.env.listeners.visibilitychange || [])]) f();
    assert.equal(r.view._fol, null); assert.equal(r.view._trail, null);
});

// =============================================================== D. ordem de desenho por profundidade
test('F9.2 D: o seguidor nunca cobre o treinador nem o Pokémon do encontro: ordem por profundidade (pés), com as regras da F8.4 preservadas', async () => {
    const r = await boot({ shown: { follower: undefined } });
    r.view.openHuntMap(150); r.env.flush();
    r.env.encounterBtn.fire('click'); r.env.flush(); await tick(); r.redraw();
    const hold = r.game.startBattle; r.game.startBattle = () => null;
    for (let i = 0; i < 80 && r.encounters.current.state === 'approaching'; i++) { r.game.clock.advance(1000); r.redraw(); }
    r.game.startBattle = hold;
    assert.equal(r.encounters.current.state, 'arrived');
    await tick(); r.redraw();
    const map = city(r), player = r.view._player(map), hy = player.y;
    const enc = r.encounters.current, off = r.view._encounterOffset(enc);
    const encY = (enc.point.y + 0.5) * 16 + 6 + off.dy;
    const real = r.view._followerPoint.bind(r.view);
    const orderFor = (fy) => {
        r.view._followerPoint = () => ({ x: player.x - 20, y: fy });
        r.clear(); r.redraw();
        const seq = [];
        for (const a of r.env.draws) {
            if (a.length === 5 && a[0]._src === r.leaderUrl()) seq.push('F');
            else if (a.length === 5 && a[0]._src === 'sprites/pokemon/150.png') seq.push('E');
            else if (a.length === 9 && a[0] === r.world.WorldView.images.hero) seq.push('H');
        }
        return seq.join('');
    };
    assert.equal(orderFor(hy - 60).indexOf('F'), 0, 'bem acima: antes de tudo');
    assert.equal(orderFor(hy + 60).indexOf('F'), 2, 'bem abaixo: por último');
    const s1 = orderFor(hy - 1), s2 = orderFor(hy + 1);
    assert.ok(s1.indexOf('F') < s1.indexOf('H'), `pés acima do treinador: atrás dele (${s1})`);
    assert.ok(s2.indexOf('F') > s2.indexOf('H'), `pés abaixo do treinador: à frente dele (${s2})`);
    // com o Pokémon do encontro: a ordem relativa dos dois segue os pés reais quando estão do mesmo lado do treinador
    // seguidor acima/abaixo dos pés do Pokémon do encontro: a ordem relativa dos dois acompanha a profundidade
    const sAbove = orderFor(encY - 0.5), sBelow = orderFor(encY + 0.5);
    assert.equal(sAbove.length, 3); assert.equal(sBelow.length, 3);
    assert.ok(sAbove.indexOf('F') < sAbove.indexOf('E'), `pés acima dos do encontro: atrás dele (${sAbove}, encY=${encY}, hy=${hy})`);
    assert.ok(sBelow.indexOf('F') > sBelow.indexOf('E'), `pés abaixo dos do encontro: à frente dele (${sBelow})`);
    r.view._followerPoint = real;
});

// =============================================================== E. custo ocioso, timers e quadros
test('F9.2 E: sem timers próprios e sem quadros em ociosidade; o seguidor só gera quadros enquanto o treinador anda', async () => {
    let timers = 0;
    const counting = { ...globals, setTimeout: (...a) => { timers++; return setTimeout(...a); }, setInterval: (...a) => { timers++; return setInterval(...a); } };
    const r = await boot({ shown: { globals: counting } });
    const t0 = timers;
    for (let i = 0; i < 40; i++) r.redraw();
    assert.equal(r.env.pending(), 0, 'treinador parado: nenhum quadro agendado');
    r.view.openHuntMap(150); r.env.flush();
    r.env.encounterBtn.fire('click'); r.env.flush();
    for (let i = 0; i < 4; i++) { r.game.clock.advance(1000); r.view.requestRedraw(true); r.env.flush(); }
    assert.ok(r.env.pending() >= 1, 'andando: há quadros (movimento)');
    dispatch(r.game, 'STOP_HUNT'); r.encounters.cancel('hunt_stopped'); r.env.flush();
    r.game.clock.advance(2000);                                       // o efeito de saída da F8.4 (cancelado) termina pelo relógio do jogo
    for (let i = 0; i < 30 && r.env.pending(); i++) r.env.flush();
    assert.equal(r.env.pending(), 0, 'parou: o laço termina');
    assert.equal(timers - t0, 0, `timers criados pela view: ${timers - t0}`);
    const draws = r.env.draws.length;
    for (let i = 0; i < 10; i++) r.env.flush();
    assert.equal(r.env.draws.length, draws, 'ocioso não desenha');
});

test('F9.2 E: o desenho do seguidor é barato (milhares de quadros sem alocar imagens)', async () => {
    const r = await boot();
    const imgs = r.env.images.length, t0 = process.hrtime.bigint();
    for (let i = 0; i < 3000; i++) r.redraw();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.equal(r.env.images.length, imgs, 'nenhuma imagem nova');
    assert.ok(ms < 3000, `3000 quadros em ${ms.toFixed(0)} ms`);
});
