'use strict';
// F8.3: fidelidade visual dos Pokémon no mapa — espécie↔arquivo, variante shiny, proporção, âncora no ponto, fallback, limpeza e desempenho.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ROOT, shown, tick } = require('./helpers/world-env');

const K = 0.375;                                                  // WorldView.ENCOUNTER_SPRITE_SCALE
const wild = (id, isShiny) => ({ id, isShiny: !!isShiny });
const enc = (speciesId, state = 'arrived', extra = {}) => ({ id: `hunt_${speciesId}#1`, sequence: 1, mapId: `hunt_${speciesId}`, speciesId, state, point: { x: 6, y: 6 }, ...extra });
const urlsLoaded = (env) => env.images.map(i => i._src).filter(u => /\/pokemon\//.test(u));          // ignora tileset e personagem
const spriteImages = (env) => urlsLoaded(env).length;

// Desenha só o encontro (a câmera/medidas são as do último quadro real)
async function drawOne(opts, c, setupEnv) {
    const r = await shown(opts);
    if (setupEnv) setupEnv(r);
    const before = r.env.draws.length;
    r.view._drawEncounter(r.env.ctx, c, r.view.lastCamera, r.view.lastMetrics);
    await tick();
    r.view._drawEncounter(r.env.ctx, c, r.view.lastCamera, r.view.lastMetrics);   // segunda passada: já com a imagem carregada
    return { ...r, drawn: r.env.draws.slice(before) };
}
const globalsUrls = { getPokemonSpriteUrl: (id) => `sprites/pokemon/${id}.png`, getShinyPokemonSpriteUrl: (id) => `sprites/pokemon/shiny/${id}.png` };
const withMap = { route: 'kanto_route1', globals: globalsUrls };
async function openHunt(opts) {
    const r = await shown({ ...withMap, ...opts, game: { currentBattle: null, gameState: { currentRoute: 'kanto_route1', currentEnemy: null } } });
    return r;
}

test('F8.3 mapeamento: todo id da Pokédex tem PNG normal e shiny existentes, com URLs distintas por espécie e variante', () => {
    const ctx = vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/pokemon-data.js'), 'utf8') + ';({ POKEMON_DATA, getPokemonSpriteUrl, getShinyPokemonSpriteUrl })');
    const ids = Object.keys(ctx.POKEMON_DATA).map(Number);
    assert.equal(ids.length, 1073);
    const urls = new Set();
    for (const id of ids) {
        const n = ctx.getPokemonSpriteUrl(id), s = ctx.getShinyPokemonSpriteUrl(id);
        assert.equal(n, `sprites/pokemon/${id}.png`);
        assert.equal(s, `sprites/pokemon/shiny/${id}.png`);
        assert.ok(fs.existsSync(path.join(ROOT, n)), n);
        assert.ok(fs.existsSync(path.join(ROOT, s)), s);
        urls.add(n); urls.add(s);
    }
    assert.equal(urls.size, ids.length * 2, 'nenhuma URL repetida entre espécies/variantes');
});

test('F8.3 amostra real: PNGs são válidos, com canal alpha e dimensões conhecidas (96x96, exceções documentadas)', () => {
    const read = (f) => { const b = fs.readFileSync(path.join(ROOT, f)); assert.equal(b.readUInt32BE(12), 0x49484452); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), ct: b[25] }; };
    const sample = [1, 4, 14, 25, 94, 150, 249, 493, 693, 716, 910, 1000, 1066, 1073];
    for (const id of sample) for (const dir of ['sprites/pokemon', 'sprites/pokemon/shiny']) {
        const { w, h, ct } = read(`${dir}/${id}.png`);
        const expected = (dir.endsWith('shiny') && id === 693) ? [128, 128] : id === 910 ? [96, 95] : [96, 96];
        assert.deepEqual([w, h], expected, `${dir}/${id}`);
        assert.ok(ct === 3 || ct === 6, `${dir}/${id}: paleta/RGBA (ambos com transparência)`);
    }
});

test('F8.3 proporção: o sprite nunca é esticado para um quadrado; largura e altura usam o mesmo fator, com o zoom do mundo', async () => {
    for (const [w, h] of [[96, 96], [96, 95], [128, 128], [40, 80], [100, 30]]) {
        const { drawn, view } = await drawOne({ ...withMap, setup: undefined }, enc(25), ({ env }) => { env.imageSize = { w, h }; });
        const d = drawn.filter(a => a.length === 5);
        assert.equal(d.length, 1, `${w}x${h}: um único desenho do sprite`);
        const z = view.lastMetrics.zoom;
        assert.equal(d[0][3], Math.round(w * K * z), `${w}x${h}: largura`);
        assert.equal(d[0][4], Math.round(h * K * z), `${w}x${h}: altura`);
        assert.ok(Math.abs(d[0][3] / d[0][4] - w / h) < 0.05, `${w}x${h}: razão de aspecto preservada`);
    }
});

test('F8.3 posição: o centro e a base do conteúdo opaco caem exatamente no ponto do mundo (qualquer margem do PNG)', async () => {
    for (const box of [{ x0: 20, y0: 30, x1: 75, y1: 70 }, { x0: 0, y0: 0, x1: 95, y1: 95 }, { x0: 40, y0: 60, x1: 55, y1: 95 }]) {
        const r = await drawOne(withMap, enc(25), ({ env }) => { env.alpha = box; });
        const d = r.drawn.filter(a => a.length === 5)[0];
        const m = r.view.lastMetrics, cam = r.view.lastCamera, ts = m.tileSize, z = m.zoom;
        const feet = r.world.worldToScreen(cam, m, 6.5 * ts, 6.5 * ts + 6);
        const cx = d[1] + (box.x0 + box.x1 + 1) / 2 * K * z, by = d[2] + (box.y1 + 1) * K * z;
        assert.ok(Math.abs(cx - feet.x) <= 1.01, `centro x ${JSON.stringify(box)}: ${cx} vs ${feet.x}`);
        assert.ok(Math.abs(by - feet.y) <= 1.01, `base y ${JSON.stringify(box)}: ${by} vs ${feet.y}`);
        assert.equal(r.env.alphaReads, 1, 'a caixa é lida uma vez por sprite carregado');
    }
});

test('F8.3 canvas sem leitura de pixels: ancora na borda do PNG e continua desenhando', async () => {
    const r = await drawOne(withMap, enc(25));       // env.alpha nulo → getContext inexistente no canvas falso
    assert.equal(r.drawn.filter(a => a.length === 5).length, 1);
});

test('F8.3 nitidez: o canvas do mundo continua sem suavização e o sprite é desenhado em pixels inteiros', async () => {
    const r = await drawOne(withMap, enc(25));
    assert.equal(r.env.ctx.imageSmoothingEnabled, false);
    const d = r.drawn.find(a => a.length === 5);
    for (const v of d.slice(1)) assert.ok(Number.isInteger(v), `coordenada inteira: ${v}`);
});

test('F8.3 zoom: o tamanho do sprite acompanha o zoom inteiro em celular e desktop, e permanece dentro do buffer ao redor do ponto', async () => {
    for (const [wpx, hpx, dpr] of [[360, 640, 3], [374, 374, 1], [1280, 720, 1], [1280, 720, 2], [200, 120, 2]]) {
        const r = await drawOne({ ...withMap, width: wpx, height: hpx, dpr }, enc(25));
        const m = r.view.lastMetrics, d = r.drawn.find(a => a.length === 5);
        assert.equal(d[3], Math.round(96 * K * m.zoom));
        assert.ok(Number.isInteger(m.zoom) && m.zoom >= 1);
    }
});

test('F8.3 shiny: a variante vem do inimigo real da espécie do encontro; durante a aproximação e para outra espécie, é a normal', async () => {
    const cases = [
        ['aproximando, mesmo shiny pendente', 'approaching', wild(25, true), 'sprites/pokemon/25.png'],
        ['chegou, inimigo shiny', 'arrived', wild(25, true), 'sprites/pokemon/shiny/25.png'],
        ['batalhando, inimigo normal', 'battling', wild(25, false), 'sprites/pokemon/25.png'],
        ['batalhando, shiny de OUTRA espécie', 'battling', wild(4, true), 'sprites/pokemon/25.png'],
        ['batalhando, sem inimigo', 'battling', null, 'sprites/pokemon/25.png'],
    ];
    for (const [name, state, w, expected] of cases) {
        const r = await shown({ ...withMap });
        r.view.game.currentBattle = w ? { wild: w } : null;
        r.view._drawEncounter(r.env.ctx, enc(25, state), r.view.lastCamera, r.view.lastMetrics);
        assert.deepEqual(urlsLoaded(r.env).slice(-1), [expected], name);
    }
    // inimigo entregue mas sem batalha ainda (gameState.currentEnemy) também define a variante
    const r = await shown({ ...withMap });
    r.view.game.gameState.currentEnemy = wild(25, true);
    r.view._drawEncounter(r.env.ctx, enc(25, 'arrived'), r.view.lastCamera, r.view.lastMetrics);
    assert.equal(urlsLoaded(r.env).at(-1), 'sprites/pokemon/shiny/25.png');
});

test('F8.3 espécie nunca é trocada em silêncio: só a imagem da espécie do encontro é pedida, e imagens antigas são soltas ao mudar de espécie', async () => {
    const r = await shown({ ...withMap });
    const draw = (c) => r.view._drawEncounter(r.env.ctx, c, r.view.lastCamera, r.view.lastMetrics);
    draw(enc(25)); await tick();
    assert.deepEqual([...r.view._enc.values()].map(e => e.id), [25]);
    draw(enc(25, 'battling')); draw(enc(25, 'battling')); await tick();
    assert.equal(spriteImages(r.env), 1, 'mesma espécie e variante: uma só imagem, sem recarregar a cada quadro');
    r.view.game.currentBattle = { wild: wild(25, true) };
    draw(enc(25, 'battling')); await tick();
    assert.deepEqual([...r.view._enc.keys()].sort(), ['25', '25s'], 'normal + shiny da espécie atual, no máximo');
    draw(enc(150)); await tick();
    assert.deepEqual([...r.view._enc.keys()], ['150'], 'espécie nova: as anteriores foram soltas');
    assert.ok(urlsLoaded(r.env).every(u => /\/(25|150)\.png$/.test(u)), urlsLoaded(r.env).join());
});

test('F8.3 carregamento tardio de uma espécie antiga não redesenha nem sobrescreve a atual', async () => {
    const r = await shown({ ...withMap });
    let redraws = 0; const orig = r.view.requestRedraw.bind(r.view);
    r.view.requestRedraw = (f) => { redraws++; return orig(f); };
    r.view._drawEncounter(r.env.ctx, enc(25), r.view.lastCamera, r.view.lastMetrics);       // onload de 25 fica pendente (microtask)
    r.view._drawEncounter(r.env.ctx, enc(150), r.view.lastCamera, r.view.lastMetrics);      // troca antes de carregar
    await tick();
    assert.equal(redraws, 1, 'só a imagem atual pede quadro');
    assert.deepEqual([...r.view._enc.keys()], ['150']);
    assert.equal(r.view._enc.get('150').ready, true);
});

test('F8.3 fallback: carregando = caixa vazada sem texto; falha = caixa com o número da espécie; nunca outra imagem', async () => {
    const r = await shown({ ...withMap });
    r.env.failUrls.add('sprites/pokemon/25.png');
    const draw = () => r.view._drawEncounter(r.env.ctx, enc(25), r.view.lastCamera, r.view.lastMetrics);
    const s0 = r.env.strokes, d0 = r.env.draws.length;
    draw();                                                      // ainda carregando
    assert.equal(r.env.strokes, s0 + 1);
    assert.deepEqual(r.env.texts, []);
    await tick(); draw();                                        // falhou
    assert.equal(r.env.strokes, s0 + 2);
    assert.deepEqual(r.env.texts.map(t => t[0]), ['#25']);
    assert.equal(r.env.draws.length, d0, 'nenhuma imagem (de nenhuma espécie) foi desenhada no lugar');
    assert.equal(r.view._enc.get('25').failed, true);
});

test('F8.3 imagem com dimensão zero conta como falha (não desenha 0x0 nem corta)', async () => {
    const r = await shown({ ...withMap });
    r.env.imageSize = { w: 0, h: 0 };
    r.view._drawEncounter(r.env.ctx, enc(25), r.view.lastCamera, r.view.lastMetrics);
    await tick();
    const d0 = r.env.draws.length;
    r.view._drawEncounter(r.env.ctx, enc(25), r.view.lastCamera, r.view.lastMetrics);
    assert.equal(r.env.draws.length, d0);
    assert.deepEqual(r.env.texts.map(t => t[0]), ['#25']);
});

test('F8.3 estados que não mostram o Pokémon não desenham nem carregam nada', async () => {
    const r = await shown({ ...withMap });
    for (const state of ['resolved', 'cancelled', 'idle', null]) r.view._drawEncounter(r.env.ctx, enc(25, state), r.view.lastCamera, r.view.lastMetrics);
    r.view._drawEncounter(r.env.ctx, null, r.view.lastCamera, r.view.lastMetrics);
    assert.equal(spriteImages(r.env), 0);
});

test('F8.3 sem timers próprios: carregar e redesenhar o sprite não cria setTimeout/setInterval', async () => {
    let timers = 0;
    const counting = { ...withMap.globals, setTimeout: (...a) => { timers++; return setTimeout(...a); }, setInterval: (...a) => { timers++; return setInterval(...a); } };
    const r = await shown({ ...withMap, globals: counting });
    const t0 = timers;
    for (let i = 0; i < 50; i++) r.view._drawEncounter(r.env.ctx, enc(25, i % 2 ? 'arrived' : 'battling'), r.view.lastCamera, r.view.lastMetrics);
    await tick();
    assert.equal(timers - t0, 0);
});

test('F8.3 desempenho: milhares de quadros com o mesmo sprite não alocam imagens nem releem pixels', async () => {
    const r = await shown({ ...withMap });
    r.env.alpha = { x0: 10, y0: 10, x1: 80, y1: 90 };
    const c = enc(25, 'battling');
    r.view._drawEncounter(r.env.ctx, c, r.view.lastCamera, r.view.lastMetrics); await tick();
    const imgs = spriteImages(r.env), reads = r.env.alphaReads, t0 = process.hrtime.bigint();
    for (let i = 0; i < 20000; i++) r.view._drawEncounter(r.env.ctx, c, r.view.lastCamera, r.view.lastMetrics);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.equal(spriteImages(r.env), imgs);
    assert.equal(r.env.alphaReads, reads);
    assert.ok(ms < 1000, `20000 desenhos em ${ms.toFixed(1)}ms`);
});

// ---- integração com o ciclo real (GameCore + ManualClock): caminhada → chegada → batalha → fim, parada e reinício
test('F8.3 ciclo real: o sprite acompanha caminhada/chegada/batalha; ao parar ou reiniciar não sobra imagem velha nem duplicada', async () => {
    const { newGame } = require('./helpers/game');
    const { game, ctx } = newGame({ seed: 11 });
    game.clock = new ctx.ManualClock(2_000_000);
    const r = await shown({ gameObject: game, encounters: true, globals: globalsUrls, follower: false });
    const { env, view, encounters } = r;
    const sprites = () => urlsLoaded(env);
    view.openHuntMap(25); env.flush();
    assert.deepEqual(sprites(), [], 'abrir o mapa não carrega o sprite do Pokémon');
    env.encounterBtn.fire('click'); env.flush();
    assert.equal(encounters.current.state, 'approaching');
    assert.deepEqual(sprites(), ['sprites/pokemon/25.png'], 'a espécie do ciclo é a do alvo');
    for (let i = 0; i < 40 && encounters.current.state === 'approaching'; i++) { game.clock.advance(1000); view.requestRedraw(true); env.flush(); }
    assert.notEqual(encounters.current.state, 'approaching');
    for (let i = 0; i < 6; i++) { view.requestRedraw(true); env.flush(); }
    assert.equal(sprites().filter(u => u === 'sprites/pokemon/25.png').length, 1, 'uma imagem por espécie, mesmo após vários quadros');
    assert.equal(encounters.current.speciesId, 25);
    // parar: o ciclo termina e a próxima pintura solta as imagens
    encounters.cancel('test');
    view.requestRedraw(true); env.flush();
    assert.equal(view._enc, null, 'sem ciclo, sem imagem retida');
    // reiniciar: uma nova entrada limpa, sem reaproveitar estado de falha antigo
    view.openHuntMap(25); env.flush();
    env.encounterBtn.fire('click'); env.flush();
    assert.equal(encounters.current.state, 'approaching');
    assert.equal(view._enc.size, 1);
    assert.ok(![...view._enc.values()][0].failed);
    // outra espécie no mesmo mapa de caça: apenas a nova permanece
    encounters.cancel('test'); view.requestRedraw(true); env.flush();
    view.openHuntMap(150); env.flush();
    env.encounterBtn.fire('click'); env.flush();
    assert.deepEqual([...view._enc.keys()], ['150']);
    assert.equal(encounters.status().speciesId, 150, 'a Central de Caça lê a mesma espécie do ciclo');
});

test('F8.3 visibilidade: o Pokémon fica um passo à frente do treinador (sentido do último trecho), fixo durante a perna, e à frente na ordem de desenho só quando fica abaixo', async () => {
    const { newGame } = require('./helpers/game');
    const { game, ctx } = newGame({ seed: 11 });
    game.clock = new ctx.ManualClock(2_000_000);
    const r = await shown({ gameObject: game, encounters: true, globals: globalsUrls, follower: false });
    const { env, view, encounters } = r;
    view.openHuntMap(25); env.flush();
    env.encounterBtn.fire('click'); env.flush();
    const w = encounters.cycle.leg.waypoints;
    const off0 = view._encounterOffset(encounters.current);
    let a = null, b = null;
    for (let i = w.length - 1; i > 0 && !a; i--) if (w[i].x !== w[i - 1].x || w[i].y !== w[i - 1].y) { a = w[i - 1]; b = w[i]; }
    const so = view.constructor.ENCOUNTER_STAND_OFF, sx = Math.sign(b.x - a.x), sy = Math.sign(b.y - a.y);
    assert.equal(JSON.stringify(off0), JSON.stringify({ dx: sx * so.side, dy: sy < 0 ? -so.up : sy * so.down }));
    assert.ok(Math.abs(off0.dx) + Math.abs(off0.dy) > 0 && (off0.dx === 0 || off0.dy === 0), 'um passo, em um só eixo');
    assert.ok(so.up >= 24, 'acima do treinador (quadro de 24px) o Pokémon não fica escondido');
    for (let i = 0; i < 3; i++) { game.clock.advance(1500); view.requestRedraw(true); env.flush(); assert.equal(JSON.stringify(view._encounterOffset(encounters.current)), JSON.stringify(off0), 'não muda durante a caminhada'); }
    // ordem de desenho: abaixo do treinador → só na passagem da frente; nos demais casos → só na de trás; nunca nas duas
    const m = view.lastMetrics, cam = view.lastCamera;
    for (const [dy, backExpected] of [[-14, 1], [0, 1], [14, 0]]) {
        view._encounterOffset = () => ({ dx: 0, dy });
        let s0 = env.strokes;
        view._drawEncounter(env.ctx, encounters.current, cam, m, false);
        const back = env.strokes - s0;
        s0 = env.strokes;
        view._drawEncounter(env.ctx, encounters.current, cam, m, true);
        const front = env.strokes - s0;
        assert.deepEqual([back, front], [backExpected, 1 - backExpected], `dy=${dy}`);
    }
});
